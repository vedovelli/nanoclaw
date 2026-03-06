import fs from 'fs';
import path from 'path';
import { ChildProcess, exec, execSync } from 'child_process';
import { runContainerAgent } from './container-runner.js';
import { stopContainer } from './container-runtime.js';
import {
  DEVTEAM_UPSTREAM_REPO,
  DEVTEAM_FAST_MODE,
  DEVTEAM_PM_GITHUB_TOKEN,
  DEVTEAM_PM_GITHUB_USER,
  DEVTEAM_SENIOR_GITHUB_TOKEN,
  DEVTEAM_SENIOR_GITHUB_USER,
  DEVTEAM_JUNIOR_GITHUB_TOKEN,
  DEVTEAM_JUNIOR_GITHUB_USER,
} from './config.js';
import { RegisteredGroup } from './types.js';
import { logger } from './logger.js';

// Linear project used for all sprint/issue tracking
const LINEAR_PROJECT = 'ai-dev-team-simulation';
const LINEAR_TEAM = 'Fabio Vedovelli';

// launchd restricts PATH to /usr/bin:/bin:/usr/sbin:/sbin — extend it so gh is found
const EXTENDED_PATH = `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? '/usr/bin:/bin'}`;

export interface SprintTask {
  issue: string | null;  // Linear issue identifier, e.g. "FAB-1"
  assignee: 'senior' | 'junior';
  pr: number | null;
  status: 'pending' | 'dev' | 'pr_created' | 'in_review' | 'changes_requested' | 'approved' | 'merged' | 'skipped_dysfunction';
  branch: string | null;
  merge_attempts?: number;  // count of failed merge attempts; pauses sprint after 3
}

export interface SprintState {
  sprint_number: number;
  state: 'IDLE' | 'PLANNING' | 'DEBATE' | 'TASKING' | 'DEV' | 'REVIEW' | 'AUTHOR_FIXES' | 'MERGE' | 'COMPLETE';
  paused: boolean;
  started_at: string | null;
  planning_issue: string | null;  // Linear issue identifier, e.g. "FAB-1"
  tasks: SprintTask[];
  next_action_at: string | null;
  upstream_repo: string;
  senior_fork: string;
  junior_fork: string;
  debate_round: number;
  review_round: number;
  task_under_review: string | null;  // Linear issue identifier
  dysfunctionMode: boolean;
}

const STATE_FILE = path.join(process.cwd(), 'data', 'dev-team', 'sprint-state.json');
const PROMPTS_DIR = path.join(process.cwd(), 'data', 'dev-team');

export function readState(): SprintState {
  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  state.task_under_review = state.task_under_review ?? null;
  state.dysfunctionMode = state.dysfunctionMode ?? false;
  return state;
}

function writeState(state: SprintState): void {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function randomDelay(minMinutes: number, maxMinutes: number): string {
  // DEVTEAM_FAST_MODE=true: treat "minutes" as seconds for rapid debugging
  const multiplier = DEVTEAM_FAST_MODE ? 1000 : 60 * 1000;
  const delayMs = (minMinutes + Math.random() * (maxMinutes - minMinutes)) * multiplier;
  return new Date(Date.now() + delayMs).toISOString();
}

function readPrompt(filename: string): string {
  return fs.readFileSync(path.join(PROMPTS_DIR, filename), 'utf-8');
}

function agentConfig(agent: 'senior' | 'junior') {
  return agent === 'senior'
    ? { token: DEVTEAM_SENIOR_GITHUB_TOKEN, user: DEVTEAM_SENIOR_GITHUB_USER }
    : { token: DEVTEAM_JUNIOR_GITHUB_TOKEN, user: DEVTEAM_JUNIOR_GITHUB_USER };
}

/**
 * Main orchestrator entry point. Called by the scheduler every 5 minutes.
 * Reads state, checks if next_action_at has passed, executes the next action.
 */
export async function runDevTeamOrchestrator(
  group: RegisteredGroup,
  chatJid: string,
  onProcess: (proc: ChildProcess, containerName: string) => void,
): Promise<string> {
  const state = readState();

  if (state.paused) {
    return 'Dev team is paused.';
  }

  // Check if it's time for the next action
  if (state.next_action_at && new Date(state.next_action_at) > new Date()) {
    return `Next action at ${state.next_action_at}. Waiting.`;
  }

  // One-time setup: fork the upstream repo from each agent account if not done yet
  if (!state.senior_fork || !state.junior_fork) {
    return await setupForks(state, group, chatJid, onProcess);
  }

  logger.info({ state: state.state, sprint: state.sprint_number }, 'DevTeam orchestrator tick');

  switch (state.state) {
    case 'IDLE':
      return await startNewSprint(state, group, chatJid, onProcess);
    case 'PLANNING':
      return await startDebate(state, group, chatJid, onProcess);
    case 'DEBATE':
      return await continueDebate(state, group, chatJid, onProcess);
    case 'TASKING':
      return await startDev(state, group, chatJid, onProcess);
    case 'DEV':
      return await checkDevProgress(state, group, chatJid, onProcess);
    case 'REVIEW':
      return await processReview(state, group, chatJid, onProcess);
    case 'AUTHOR_FIXES':
      return await authorFixTask(state, group, chatJid, onProcess);
    case 'MERGE':
      return await processMerge(state, group, chatJid, onProcess);
    case 'COMPLETE':
      return await finishSprint(state, group, chatJid, onProcess);
    default:
      return `Unknown state: ${state.state}`;
  }
}

export async function runAgent(
  agent: 'senior' | 'junior' | 'orchestrator',
  prompt: string,
  group: RegisteredGroup,
  chatJid: string,
  onProcess: (proc: ChildProcess, containerName: string) => void,
  dysfunctionMode = false,
): Promise<string> {
  const config = agent === 'orchestrator'
    ? { token: DEVTEAM_PM_GITHUB_TOKEN, user: DEVTEAM_PM_GITHUB_USER }
    : agentConfig(agent);

  const systemPrompt = agent === 'orchestrator'
    ? readPrompt('orchestrator-prompt.md')
    : readPrompt(
        agent === 'senior'
          ? 'carlos-prompt.md'
          : dysfunctionMode
            ? 'ana-dysfunction-prompt.md'
            : 'ana-prompt.md',
      );

  const fullPrompt = `${systemPrompt}\n\n---\n\n## Current Task\n\n${prompt}`;

  const model = agent === 'orchestrator' ? 'sonnet' : 'haiku';

  // Capture result early via streaming output callback, then kill the container.
  // Agents keep their process alive after printing results (MCP connections etc),
  // which would block the orchestrator indefinitely waiting for container.on('close').
  let capturedResult: string | null = null;
  let capturedContainerName: string | undefined;
  let capturedProc: ChildProcess | undefined;

  const wrappedOnProcess = (proc: ChildProcess, containerName: string) => {
    capturedProc = proc;
    capturedContainerName = containerName;
    onProcess(proc, containerName);
  };

  const output = await runContainerAgent(
    group,
    {
      prompt: fullPrompt,
      groupFolder: group.folder,
      chatJid,
      isMain: false,
      isScheduledTask: true,
      assistantName: agent === 'senior' ? 'Carlos' : agent === 'junior' ? 'Ana' : 'Orchestrator',
      model,
      secrets: {
        GITHUB_TOKEN: config.token,
        GH_TOKEN: config.token,
      },
    },
    wrappedOnProcess,
    async (streamOutput) => {
      if (streamOutput.result !== null && capturedResult === null) {
        capturedResult = streamOutput.result;
        // Kill the container immediately — we have the result we need
        if (capturedContainerName) {
          exec(stopContainer(capturedContainerName), { timeout: 5000 }, () => {
            capturedProc?.kill('SIGKILL');
          });
        }
      }
    },
  );

  return capturedResult ?? output.result ?? output.error ?? 'No output';
}


function provisionRepoFiles(): void {
  const prTemplate = `## Summary

<!-- One or two sentences describing what this PR does -->

## Changes

<!-- List the main changes made -->

## Testing

<!-- Describe how this was tested or verified -->

## Review notes

<!-- Anything the reviewer should pay attention to -->
`;

  const ciWorkflow = `name: CI

on:
  pull_request:
    branches: [master, main]

jobs:
  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run typecheck
        continue-on-error: true

  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run lint
        continue-on-error: true
`;

  const filesToProvision: Array<{ path: string; content: string; message: string }> = [
    {
      path: '.github/pull_request_template.md',
      content: prTemplate,
      message: 'chore: add PR template',
    },
    {
      path: '.github/workflows/ci.yml',
      content: ciWorkflow,
      message: 'chore: add CI workflow',
    },
  ];

  for (const file of filesToProvision) {
    try {
      const encoded = Buffer.from(file.content).toString('base64');
      execSync(
        `gh api repos/${DEVTEAM_UPSTREAM_REPO}/contents/${file.path} \
--method PUT \
--field message=${JSON.stringify(file.message)} \
--field content=${JSON.stringify(encoded)}`,
        {
          encoding: 'utf8',
          timeout: 15000,
          env: { ...process.env, PATH: EXTENDED_PATH, GH_TOKEN: DEVTEAM_PM_GITHUB_TOKEN },
        },
      );
      logger.info({ path: file.path }, 'DevTeam: provisioned repo file');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // HTTP 422 = file already exists; skip silently
      if (msg.includes('422') || msg.includes('sha') || msg.includes('already exists')) {
        logger.info({ path: file.path }, 'DevTeam: repo file already exists, skipping');
      } else {
        logger.warn({ path: file.path, err }, 'DevTeam: failed to provision repo file');
      }
    }
  }
}

async function setupForks(
  state: SprintState,
  group: RegisteredGroup,
  chatJid: string,
  onProcess: (proc: ChildProcess, containerName: string) => void,
): Promise<string> {
  const repoBaseName = DEVTEAM_UPSTREAM_REPO.split('/')[1];
  logger.info('DevTeam: setting up forks for senior and junior agents');

  if (!state.senior_fork) {
    const result = await runAgent('senior', `
Fork the upstream repo ${DEVTEAM_UPSTREAM_REPO} into your account if it doesn't exist yet:
  gh repo fork ${DEVTEAM_UPSTREAM_REPO} --clone=false --remote=false

Then confirm the fork URL by running:
  gh repo view ${DEVTEAM_SENIOR_GITHUB_USER}/${repoBaseName} --json url -q .url

Output the fork URL as: FORK_URL=<url>
`, group, chatJid, onProcess);

    const match = result.match(/FORK_URL=(https?:\/\/\S+)/);
    if (!match) {
      logger.error({ result }, 'DevTeam: senior fork setup failed — no FORK_URL in output');
      throw new Error(`Senior fork setup failed. Output: ${result.slice(0, 500)}`);
    }
    state.senior_fork = match[1].trim();
  }

  if (!state.junior_fork) {
    const result = await runAgent('junior', `
Fork the upstream repo ${DEVTEAM_UPSTREAM_REPO} into your account if it doesn't exist yet:
  gh repo fork ${DEVTEAM_UPSTREAM_REPO} --clone=false --remote=false

Then confirm the fork URL by running:
  gh repo view ${DEVTEAM_JUNIOR_GITHUB_USER}/${repoBaseName} --json url -q .url

Output the fork URL as: FORK_URL=<url>
`, group, chatJid, onProcess);

    const match = result.match(/FORK_URL=(https?:\/\/\S+)/);
    if (!match) {
      logger.error({ result }, 'DevTeam: junior fork setup failed — no FORK_URL in output');
      throw new Error(`Junior fork setup failed. Output: ${result.slice(0, 500)}`);
    }
    state.junior_fork = match[1].trim();
  }

  provisionRepoFiles();

  state.next_action_at = randomDelay(1, 2);
  writeState(state);
  return `Forks ready — senior: ${state.senior_fork} | junior: ${state.junior_fork}`;
}

async function startNewSprint(
  state: SprintState,
  group: RegisteredGroup,
  chatJid: string,
  onProcess: (proc: ChildProcess, containerName: string) => void,
): Promise<string> {
  state.sprint_number++;
  state.state = 'PLANNING';
  state.started_at = new Date().toISOString();
  state.tasks = [];
  state.debate_round = 0;
  state.review_round = 0;

  // Use orchestrator (Sonnet) to create the planning issue in Linear
  const result = await runAgent('orchestrator', `
Create a new issue in the Linear project "${LINEAR_PROJECT}" (team: "${LINEAR_TEAM}") for Sprint #${state.sprint_number} planning.

Title: "Sprint #${state.sprint_number} Planning"

Description should include:
- A brief summary of what the team should focus on this sprint
- A call for Carlos (senior) and Ana (junior) to propose features
- Reference to previous sprints if sprint_number > 1

Use the Linear MCP to create the issue (save_issue tool). Set:
- title: "Sprint #${state.sprint_number} Planning"
- project: "${LINEAR_PROJECT}"
- team: "${LINEAR_TEAM}"
- description: <the body text above>

Return the issue identifier in your response as: ISSUE_ID=<identifier>
(e.g., ISSUE_ID=FAB-1)
`, group, chatJid, onProcess);

  // Parse Linear issue identifier from result
  const match = result.match(/ISSUE_ID=([A-Z]+-\d+)/);
  if (match) {
    state.planning_issue = match[1];
  }

  state.next_action_at = randomDelay(3, 8);
  writeState(state);

  return `Sprint #${state.sprint_number} started. Planning issue: ${state.planning_issue}`;
}

async function startDebate(
  state: SprintState,
  group: RegisteredGroup,
  chatJid: string,
  onProcess: (proc: ChildProcess, containerName: string) => void,
): Promise<string> {
  state.state = 'DEBATE';
  state.debate_round = 1;

  // Carlos proposes first
  await runAgent('senior', `
You're participating in Sprint #${state.sprint_number} planning.
Post a comment on Linear issue ${state.planning_issue} (project: "${LINEAR_PROJECT}", team: "${LINEAR_TEAM}").

Propose 2-3 features for this sprint. Consider:
- What the app needs architecturally
- TanStack features that could be leveraged (Router, Query, Table, Form, Virtual)
- MSW mocks that need to be set up

Use the Linear MCP create_comment tool to post your proposal on issue ${state.planning_issue}.
`, group, chatJid, onProcess);

  state.next_action_at = randomDelay(3, 8);
  writeState(state);

  return `Carlos proposed features for Sprint #${state.sprint_number}`;
}

async function continueDebate(
  state: SprintState,
  group: RegisteredGroup,
  chatJid: string,
  onProcess: (proc: ChildProcess, containerName: string) => void,
): Promise<string> {
  state.debate_round++;

  if (state.debate_round > 4) {
    // Force move to tasking after 4 rounds
    state.state = 'TASKING';
    state.next_action_at = randomDelay(2, 5);
    writeState(state);
    return 'Debate concluded (max rounds). Moving to tasking.';
  }

  // Alternate between Ana and Carlos
  // Carlos opens debate in round 1 (startDebate). Round 2 = Ana, 3 = Carlos, 4 = Ana.
  // Even rounds → junior (Ana), odd rounds → senior (Carlos).
  const agent: 'senior' | 'junior' = state.debate_round % 2 === 0 ? 'junior' : 'senior';

  // Junior can engage but CANNOT declare consensus — only PM or senior can close the debate
  const seniorPrompt = `
You're participating in Sprint #${state.sprint_number} planning.
First read the existing comments on Linear issue ${state.planning_issue}:
  Use the Linear MCP list_comments tool on issue ${state.planning_issue}.

Then add your response as a new comment using the Linear MCP create_comment tool on issue ${state.planning_issue}.
You can:
- Agree with proposals and add detail
- Counter-propose simpler/different approaches
- Suggest modifications

If Ana hasn't commented yet, acknowledge it briefly in your comment (e.g. "Ana hasn't weighed in yet — moving forward based on what we have.") and proceed.

If you feel there's enough agreement on 2-4 tasks, end your comment with: CONSENSUS_REACHED
`;

  const juniorPrompt = `
You're participating in Sprint #${state.sprint_number} planning.
First read the existing comments on Linear issue ${state.planning_issue}:
  Use the Linear MCP list_comments tool on issue ${state.planning_issue}.

Then add your response as a new comment using the Linear MCP create_comment tool on issue ${state.planning_issue}.
You can:
- Agree with proposals and add detail
- Counter-propose simpler/different approaches
- Raise concerns or ask questions
- Suggest modifications

Note: the final call on when the team has reached consensus belongs to the senior dev or PM — not to you.
Do NOT end your comment with CONSENSUS_REACHED.
`;

  // Skip Ana's debate turn with 60% probability when dysfunction mode is active
  if (state.dysfunctionMode && agent === 'junior' && Math.random() < 0.6) {
    state.next_action_at = randomDelay(3, 8);
    writeState(state);
    return `Ana skipped debate round ${state.debate_round} (dysfunction mode)`;
  }

  await runAgent(agent, agent === 'senior' ? seniorPrompt : juniorPrompt, group, chatJid, onProcess, state.dysfunctionMode);

  // Check if orchestrator detects consensus
  const orchestratorResult = await runAgent('orchestrator', `
Read the comments on Linear issue ${state.planning_issue}:
  Use the Linear MCP list_comments tool on issue ${state.planning_issue}.

Ana may not have commented — if only Carlos has responded, that is sufficient to detect consensus if his proposals are clear.

Analyze whether the team has reached consensus on sprint tasks.
If yes, respond with: CONSENSUS=true
If no, respond with: CONSENSUS=false
`, group, chatJid, onProcess);

  if (orchestratorResult.includes('CONSENSUS=true') || state.debate_round >= 3) {
    state.state = 'TASKING';
    state.next_action_at = randomDelay(2, 5);
  } else {
    state.next_action_at = randomDelay(3, 8);
  }

  writeState(state);
  return `Debate round ${state.debate_round} complete.`;
}

async function startDev(
  state: SprintState,
  group: RegisteredGroup,
  chatJid: string,
  onProcess: (proc: ChildProcess, containerName: string) => void,
): Promise<string> {
  // Orchestrator creates individual issues from the planning discussion
  const result = await runAgent('orchestrator', `
Read the planning issue ${state.planning_issue} and its comments from Linear:
  Use the Linear MCP get_issue tool on ${state.planning_issue}, then list_comments.

Based on the discussion, create 2-4 individual task issues in Linear. For each task:
1. Create the issue in project "${LINEAR_PROJECT}" (team: "${LINEAR_TEAM}") using save_issue
2. Set the title clearly describing the feature
3. Set the description with implementation details
4. Label with "senior" or "junior" based on complexity (senior gets architectural tasks, junior gets UI tasks)
5. Immediately after creating each issue, set its status to "Todo" using save_issue with stateName "Todo"

After creating all task issues, post a comment on the planning issue ${state.planning_issue} with a table summarizing all tasks created.

For each issue created, output a line:
TASK|<identifier>|<senior|junior>|<branch_name>
(e.g., TASK|FAB-2|senior|feature/data-table)
`, group, chatJid, onProcess);

  // Parse tasks from orchestrator output
  const taskLines = result.split('\n').filter(l => l.startsWith('TASK|'));
  state.tasks = taskLines.map(line => {
    const [, issue, assignee, branch] = line.split('|');
    return {
      issue: issue?.trim() || null,
      assignee: assignee?.trim() as 'senior' | 'junior',
      pr: null,
      status: 'pending' as const,
      branch: branch?.trim() || null,
    };
  });

  // If no tasks were parsed, create defaults
  if (state.tasks.length === 0) {
    state.tasks = [
      { issue: null, assignee: 'senior', pr: null, status: 'pending', branch: null },
      { issue: null, assignee: 'junior', pr: null, status: 'pending', branch: null },
    ];
  }

  state.state = 'DEV';
  state.next_action_at = randomDelay(2, 5);
  writeState(state);

  return `Tasking complete. ${state.tasks.length} tasks created.`;
}

async function checkDevProgress(
  state: SprintState,
  group: RegisteredGroup,
  chatJid: string,
  onProcess: (proc: ChildProcess, containerName: string) => void,
): Promise<string> {
  // Find a pending task and dispatch the agent
  // Skip malformed tasks (issue: null or invalid assignee) that may result from
  // the orchestrator agent outputting example/template lines in its TASK| output
  const pendingTask = state.tasks.find(
    t => t.status === 'pending' && t.issue !== null && t.issue !== '' && (t.assignee === 'senior' || t.assignee === 'junior'),
  );

  if (pendingTask) {
    if (state.dysfunctionMode && pendingTask.assignee === 'junior' && Math.random() < 0.6) {
      pendingTask.status = 'skipped_dysfunction';
      state.next_action_at = randomDelay(5, 15);
      writeState(state);
      return `Ana skipped task ${pendingTask.issue} (dysfunction mode)`;
    }

    const agent = pendingTask.assignee;
    const config = agentConfig(agent);
    const reviewerUser = agent === 'senior' ? DEVTEAM_JUNIOR_GITHUB_USER : DEVTEAM_SENIOR_GITHUB_USER;

    const devResult = await runAgent(agent, `
You need to implement ONLY the feature described in Linear issue ${pendingTask.issue}.
Do NOT implement any other issues or features beyond what issue ${pendingTask.issue} describes.

Steps:
1. Mark Linear issue ${pendingTask.issue} as "In Progress" using the Linear MCP save_issue tool with stateName "In Progress"
2. Sync your fork: gh repo sync ${config.user}/${DEVTEAM_UPSTREAM_REPO.split('/')[1]} --force
3. Clone or cd into your fork working directory
4. Read the issue from Linear: use the Linear MCP get_issue tool on ${pendingTask.issue}
5. Create a feature branch: ${pendingTask.branch || `feature/issue-${pendingTask.issue}`}
6. Implement ONLY what Linear issue ${pendingTask.issue} describes, with multiple atomic commits
7. Push to your fork
8. Create a PR to upstream: gh pr create --repo ${DEVTEAM_UPSTREAM_REPO} --head ${config.user}:${pendingTask.branch || `feature/issue-${pendingTask.issue}`} --title "..." --body "Implements Linear ${pendingTask.issue}\\n\\n..."
9. Request a review from your teammate: gh pr edit <pr-number> --repo ${DEVTEAM_UPSTREAM_REPO} --add-reviewer ${reviewerUser}
10. Post a comment on Linear issue ${pendingTask.issue} saying the PR is open (use Linear MCP create_comment)
11. Post a comment on Linear planning issue ${state.planning_issue} noting PR created for ${pendingTask.issue} (use Linear MCP create_comment)

When done, output: PR_CREATED=<number>
// dysfunctionMode passed so senior agent uses the normal carlos-prompt (flag is ignored for senior).
    `, group, chatJid, onProcess, state.dysfunctionMode);

    // Parse PR number from agent output and validate it exists on upstream
    const prMatch = devResult.match(/PR_CREATED=(\d+)/);
    const candidatePr = prMatch ? parseInt(prMatch[1], 10) : null;

    let confirmedPr: number | null = null;
    if (candidatePr !== null) {
      // Verify the PR actually exists on the upstream repo
      try {
        execSync(
          `gh pr view ${candidatePr} --repo ${DEVTEAM_UPSTREAM_REPO} --json number`,
          { encoding: 'utf8', timeout: 15000, env: { ...process.env, PATH: EXTENDED_PATH, GH_TOKEN: DEVTEAM_PM_GITHUB_TOKEN } },
        );
        confirmedPr = candidatePr;
      } catch {
        logger.warn({ pr: candidatePr, repo: DEVTEAM_UPSTREAM_REPO }, 'checkDevProgress: PR not found on upstream — searching by branch');
      }
    }

    // Fallback: search for an open PR by branch name on upstream
    if (confirmedPr === null && pendingTask.branch) {
      try {
        const branchName = pendingTask.branch.split('/').pop() ?? pendingTask.branch;
        const found = execSync(
          `gh pr list --repo ${DEVTEAM_UPSTREAM_REPO} --state open --json number,headRefName --jq '[.[] | select(.headRefName | test("${branchName}"))] | first | .number // empty'`,
          { encoding: 'utf8', timeout: 15000, env: { ...process.env, PATH: EXTENDED_PATH, GH_TOKEN: DEVTEAM_PM_GITHUB_TOKEN } },
        ).trim();
        if (found && /^\d+$/.test(found)) {
          confirmedPr = parseInt(found, 10);
          logger.info({ pr: confirmedPr, branch: branchName }, 'checkDevProgress: found PR on upstream by branch name');
        }
      } catch (err) {
        logger.warn({ err }, 'checkDevProgress: branch search failed');
      }
    }

    if (confirmedPr !== null) {
      pendingTask.pr = confirmedPr;
      pendingTask.status = 'pr_created';
      logger.info({ pr: confirmedPr, issue: pendingTask.issue }, 'checkDevProgress: PR confirmed on upstream');
    } else {
      // PR not found on upstream — reset to pending so it retries next tick
      logger.warn({ candidatePr, issue: pendingTask.issue }, 'checkDevProgress: could not confirm PR on upstream — resetting to pending');
      pendingTask.status = 'pending';
    }

    state.next_action_at = randomDelay(10, 30);
    writeState(state);

    return confirmedPr !== null
      ? `${agent} created PR #${confirmedPr} for Linear issue ${pendingTask.issue}`
      : `${agent} finished work on ${pendingTask.issue} but PR not found on upstream — will retry`;
  }

  // Check if all tasks have PRs — move to review
  const allHavePRs = state.tasks.every(t => t.status !== 'pending');
  if (allHavePRs) {
    state.state = 'REVIEW';
    state.review_round = 0;
    state.next_action_at = randomDelay(15, 45);
    writeState(state);
    return 'All tasks have PRs. Moving to review.';
  }

  state.next_action_at = randomDelay(5, 15);
  writeState(state);
  return 'Waiting for tasks to complete.';
}

async function processReview(
  state: SprintState,
  group: RegisteredGroup,
  chatJid: string,
  onProcess: (proc: ChildProcess, containerName: string) => void,
): Promise<string> {
  // Find a task that needs review — must have a real PR number
  const needsReview = state.tasks.find(
    t => (t.status === 'pr_created' || t.status === 'changes_requested') && t.pr !== null
  );

  if (!needsReview) {
    // Check if all approved
    const allApproved = state.tasks.every(
      t => t.status === 'approved' || t.status === 'merged' || t.status === 'skipped_dysfunction'
    );
    if (allApproved) {
      state.state = 'MERGE';
      state.next_action_at = randomDelay(3, 5);
      writeState(state);
      return 'All PRs approved. Moving to merge.';
    }
    // Check for tasks stuck with pr_created but no PR number — reset to pending
    const stuck = state.tasks.filter(t => t.status === 'pr_created' && t.pr === null);
    if (stuck.length > 0) {
      logger.warn({ stuck: stuck.map(t => t.issue) }, 'processReview: tasks have pr_created status but no PR number — resetting to pending');
      for (const t of stuck) { t.status = 'pending'; }
      state.state = 'DEV';
      state.next_action_at = randomDelay(2, 5);
      writeState(state);
      return `Reset ${stuck.length} stuck task(s) to pending. Returning to DEV.`;
    }
    state.next_action_at = randomDelay(5, 15);
    writeState(state);
    return 'Waiting for PRs to review.';
  }

  // Cross-review: the other agent reviews
  const reviewer = needsReview.assignee === 'senior' ? 'junior' : 'senior';

  if (state.dysfunctionMode && reviewer === 'junior' && Math.random() < 0.6) {
    // Skip review — Ana is disengaged. Do NOT increment review_round (no real review happened).
    // NOTE: We set sprint-internal status to 'approved' so the sprint can advance to MERGE.
    // This does NOT reflect GitHub state — gh pr review --approve is never called, so Ana's
    // review count on the actual PR remains zero. That's the DevVis signal: PR with no review from Ana.
    needsReview.status = 'approved';
    state.task_under_review = null;
    const allApproved = state.tasks.every(
      t => t.status === 'approved' || t.status === 'merged' || t.status === 'skipped_dysfunction'
    );
    if (allApproved) state.state = 'MERGE';
    state.next_action_at = randomDelay(3, 5);
    writeState(state);
    return `Review skipped for PR #${needsReview.pr} — Ana is in dysfunction mode. Auto-advanced.`;
  }

  // Only increment review_round when an actual review is dispatched
  state.review_round++;

  // Decide review outcome based on probability
  const rand = Math.random();
  const shouldApprove = (state.review_round === 1 && rand < 0.2) ||
                        (state.review_round === 2 && rand < 0.7) ||
                        (state.review_round >= 3);

  await runAgent(reviewer, `
Review PR #${needsReview.pr} on repo ${DEVTEAM_UPSTREAM_REPO}.

Steps:
1. Read the PR: gh pr view ${needsReview.pr} --repo ${DEVTEAM_UPSTREAM_REPO}
2. Read the diff: gh pr diff ${needsReview.pr} --repo ${DEVTEAM_UPSTREAM_REPO}
3. Read any existing review comments: gh api repos/${DEVTEAM_UPSTREAM_REPO}/pulls/${needsReview.pr}/comments

Write a substantive code review. Comment on:
- Code quality and patterns
- TypeScript types usage
- Component structure
- Potential bugs or edge cases
- Performance considerations

${shouldApprove
  ? 'After your review, APPROVE the PR: gh pr review ' + needsReview.pr + ' --repo ' + DEVTEAM_UPSTREAM_REPO + ' --approve --body \"...\"'
  : 'After your review, REQUEST CHANGES: gh pr review ' + needsReview.pr + ' --repo ' + DEVTEAM_UPSTREAM_REPO + ' --request-changes --body \"...\"'
}

Also leave 1-3 inline comments on specific lines using:
gh api repos/${DEVTEAM_UPSTREAM_REPO}/pulls/${needsReview.pr}/comments -f body="..." -f commit_id="..." -f path="..." -F line=N

Finally, post a comment on Linear planning issue ${state.planning_issue} with your review outcome:
- PR #${needsReview.pr} reviewing Linear issue ${needsReview.issue}
- Whether you approved or requested changes
Use the Linear MCP create_comment tool on issue ${state.planning_issue}.

Output: REVIEW_RESULT=${shouldApprove ? 'approved' : 'changes_requested'}
`, group, chatJid, onProcess, state.dysfunctionMode);

  needsReview.status = shouldApprove ? 'approved' : 'changes_requested';
  const reviewerUser = agentConfig(reviewer).user;

  if (!shouldApprove) {
    // Route to AUTHOR_FIXES so the author can address the review feedback
    state.state = 'AUTHOR_FIXES';
    state.task_under_review = needsReview.issue;
    state.next_action_at = randomDelay(5, 15);
    writeState(state);
    return `Review round ${state.review_round} for PR #${needsReview.pr}: changes_requested. Routing to author for fixes.`;
  }

  // Reviewer approved
  state.task_under_review = null;
  state.next_action_at = randomDelay(3, 5);

  // Check if all tasks are approved
  const allApproved = state.tasks.every(
    t => t.status === 'approved' || t.status === 'merged' || t.status === 'skipped_dysfunction'
  );
  if (allApproved) {
    state.state = 'MERGE';
  }

  writeState(state);
  return `Review round ${state.review_round} for PR #${needsReview.pr}: ${needsReview.status}. Reviewed by @${reviewerUser}.`;
}

async function authorFixTask(
  state: SprintState,
  group: RegisteredGroup,
  chatJid: string,
  onProcess: (proc: ChildProcess, containerName: string) => void,
): Promise<string> {
  // Find the task currently under review — null guard prevents wrong match when both are null
  const task = state.tasks.find(t => t.issue !== null && t.issue === state.task_under_review);

  if (!task || !task.pr) {
    // Nothing to fix — fall back to REVIEW
    logger.warn({ task_under_review: state.task_under_review }, 'DevTeam: authorFixTask — no task/PR found; falling back to REVIEW');
    state.state = 'REVIEW';
    state.task_under_review = null;
    state.next_action_at = randomDelay(3, 5);
    writeState(state);
    return 'No task or PR found to fix; returned to REVIEW.';
  }

  // The PR author is the task's assignee
  const author = task.assignee;
  const config = agentConfig(author);

  let fixResult: string;
  try {
    fixResult = await runAgent(author, `
You are the author of PR #${task.pr} for Linear issue ${task.issue} on repo ${DEVTEAM_UPSTREAM_REPO}.

A reviewer has requested changes on your PR. Your job is to read their feedback and push fixes.

Steps:
1. Read the review comments: gh pr view ${task.pr} --repo ${DEVTEAM_UPSTREAM_REPO} --comments
2. Read the inline review comments: gh api repos/${DEVTEAM_UPSTREAM_REPO}/pulls/${task.pr}/comments
3. Read the current diff to understand your code: gh pr diff ${task.pr} --repo ${DEVTEAM_UPSTREAM_REPO}
4. Sync your fork and check out your branch:
   gh repo sync ${config.user}/${DEVTEAM_UPSTREAM_REPO.split('/')[1]} --force
5. Address ALL the review feedback by pushing additional commits to the same branch.
6. After pushing your fixes, add a comment on the PR summarising what you changed:
   gh pr comment ${task.pr} --repo ${DEVTEAM_UPSTREAM_REPO} --body "..."
7. Post a comment on Linear planning issue ${state.planning_issue} saying fixes were pushed for PR #${task.pr} (Linear issue ${task.issue}).
   Use the Linear MCP create_comment tool on issue ${state.planning_issue}.

End your response with exactly: FIXES_PUSHED=true
`, group, chatJid, onProcess);
  } catch (err) {
    logger.error({ pr: task.pr, err }, 'DevTeam: authorFixTask — runAgent failed; will retry');
    // Retry after a short delay rather than leaving state stuck in AUTHOR_FIXES
    state.next_action_at = randomDelay(5, 15);
    writeState(state);
    return `Author fix agent failed for PR #${task.pr}; will retry.`;
  }

  // Verify the agent actually pushed fixes before advancing state
  if (!fixResult.includes('FIXES_PUSHED=true')) {
    logger.warn({ pr: task.pr }, 'DevTeam: authorFixTask — FIXES_PUSHED not confirmed; will retry');
    state.next_action_at = randomDelay(5, 15);
    writeState(state);
    return `Author fix output did not confirm FIXES_PUSHED for PR #${task.pr}; will retry.`;
  }

  // Transition back to REVIEW so the reviewer can re-evaluate
  // Note: review_round is NOT reset here — it must keep escalating so the
  // approval probability increases with each review cycle (prevents infinite loops)
  state.state = 'REVIEW';
  state.task_under_review = null;
  state.next_action_at = randomDelay(5, 15);
  writeState(state);

  return `Author pushed fixes for PR #${task.pr}; returning to REVIEW.`;
}

async function processMerge(
  state: SprintState,
  group: RegisteredGroup,
  chatJid: string,
  onProcess: (proc: ChildProcess, containerName: string) => void,
): Promise<string> {
  const approvedTasks = state.tasks.filter(t => t.status === 'approved' && t.pr !== null);

  if (approvedTasks.length === 0) {
    state.state = 'COMPLETE';
    state.next_action_at = randomDelay(1, 2);
    writeState(state);
    return 'All tasks merged. Sprint complete.';
  }

  // Pre-check every approved PR before attempting any merge
  const readyToMerge: SprintTask[] = [];
  const tickResults: string[] = [];

  for (const task of approvedTasks) {
    let reviewDecision = '';
    let mergeable = '';
    let prState = '';
    try {
      const prInfo = execSync(
        `gh pr view ${task.pr} --repo ${DEVTEAM_UPSTREAM_REPO} --json reviewDecision,mergeable,state --jq '"REVIEW="+.reviewDecision+" MERGE="+.mergeable+" STATE="+.state'`,
        { encoding: 'utf8', timeout: 15000, env: { ...process.env, PATH: EXTENDED_PATH, GH_TOKEN: DEVTEAM_PM_GITHUB_TOKEN } },
      ).trim();
      const reviewMatch = prInfo.match(/REVIEW=(\w+)/);
      const mergeMatch = prInfo.match(/MERGE=(\w+)/);
      const stateMatch = prInfo.match(/STATE=(\w+)/);
      reviewDecision = reviewMatch?.[1] ?? '';
      mergeable = mergeMatch?.[1] ?? '';
      prState = stateMatch?.[1] ?? '';
    } catch (err) {
      logger.warn({ pr: task.pr, err }, 'processMerge: could not check PR state — skipping this tick');
      continue;
    }

    // PR was already merged (e.g. by a previous tick whose status update was lost)
    if (prState === 'MERGED') {
      logger.info({ pr: task.pr }, 'processMerge: PR already merged on GitHub — updating status');
      task.status = 'merged';
      tickResults.push(`PR #${task.pr} (Linear ${task.issue}) already merged.`);
      continue;
    }

    if (reviewDecision === 'CHANGES_REQUESTED') {
      logger.warn({ pr: task.pr }, 'processMerge: PR has changes requested — routing to AUTHOR_FIXES');
      task.status = 'changes_requested';
      state.state = 'AUTHOR_FIXES';
      state.task_under_review = task.issue;
      state.next_action_at = randomDelay(2, 5);
      writeState(state);
      return `PR #${task.pr} has changes requested. Routing author to fix loop.`;
    }

    if (mergeable === 'CONFLICTING') {
      logger.warn({ pr: task.pr }, 'processMerge: PR has merge conflicts — author must rebase');
      const author = task.assignee;
      const config = agentConfig(author);
      await runAgent(author, `
PR #${task.pr} on repo ${DEVTEAM_UPSTREAM_REPO} has merge conflicts and cannot be merged.

You must resolve the conflicts:
1. Sync your fork with upstream: gh repo sync ${config.user}/${DEVTEAM_UPSTREAM_REPO.split('/')[1]} --force
2. Check out your branch locally
3. Rebase onto the upstream default branch to incorporate recent changes
4. Resolve any conflicts, commit, and force-push to your fork
5. Verify the PR is now conflict-free: gh pr view ${task.pr} --repo ${DEVTEAM_UPSTREAM_REPO} --json mergeable
`, group, chatJid, onProcess);
      tickResults.push(`PR #${task.pr} had conflicts. Author is rebasing — will retry merge.`);
      continue;
    }

    readyToMerge.push(task);
  }

  if (readyToMerge.length === 0) {
    // Check if all tasks are now merged (via pre-check discovery)
    const allMerged = state.tasks.every(t => t.status === 'merged');
    if (allMerged) {
      state.state = 'COMPLETE';
      state.next_action_at = randomDelay(1, 2);
      writeState(state);
      return tickResults.join('\n') + '\nAll tasks merged. Sprint complete.';
    }
    // Remaining PRs had conflicts or check errors; nothing to merge this tick
    state.next_action_at = randomDelay(5, 10);
    writeState(state);
    return tickResults.length > 0 ? tickResults.join('\n') : 'No PRs ready to merge this tick. Will retry.';
  }

  // Merge directly via execSync — no LLM needed for a deterministic gh command
  const mergedRefs: string[] = [];
  for (const task of readyToMerge) {
    let isMerged = false;
    try {
      execSync(
        `gh pr merge ${task.pr} --repo ${DEVTEAM_UPSTREAM_REPO} --squash --delete-branch`,
        { encoding: 'utf8', timeout: 30000, env: { ...process.env, PATH: EXTENDED_PATH, GH_TOKEN: DEVTEAM_PM_GITHUB_TOKEN } },
      );
      isMerged = true;
    } catch (mergeErr) {
      // execSync failed — check if it was actually merged anyway (race condition / already merged)
      try {
        const prState = execSync(
          `gh pr view ${task.pr} --repo ${DEVTEAM_UPSTREAM_REPO} --json state --jq '.state'`,
          { encoding: 'utf8', timeout: 15000, env: { ...process.env, PATH: EXTENDED_PATH, GH_TOKEN: DEVTEAM_PM_GITHUB_TOKEN } },
        ).trim();
        isMerged = prState === 'MERGED';
        if (isMerged) {
          logger.info({ pr: task.pr }, 'processMerge: merge cmd failed but PR already merged on GitHub');
        }
      } catch {
        // ignore secondary check failure
      }
      if (!isMerged) {
        logger.warn({ pr: task.pr, err: mergeErr }, 'processMerge: merge failed');
      }
    }

    if (isMerged) {
      task.status = 'merged';
      task.merge_attempts = 0;
      tickResults.push(`PR #${task.pr} (Linear ${task.issue}) merged.`);
      mergedRefs.push(`PR #${task.pr} → Linear ${task.issue}`);
    } else {
      task.merge_attempts = (task.merge_attempts ?? 0) + 1;
      tickResults.push(`Merge of PR #${task.pr} failed (attempt ${task.merge_attempts}).`);
      if (task.merge_attempts >= 3) {
        logger.error({ pr: task.pr, issue: task.issue }, 'processMerge: 3 consecutive merge failures — pausing sprint');
        state.paused = true;
        tickResults.push(`Sprint paused: PR #${task.pr} failed to merge 3 times. Manual intervention required.`);
      }
    }
  }

  // Mark merged tasks as Done and post Linear summary comment (fire-and-forget)
  if (mergedRefs.length > 0 && state.planning_issue) {
    const mergedIssues = readyToMerge.filter(t => t.status === 'merged').map(t => t.issue).filter(Boolean);
    runAgent(
      'orchestrator',
      `Do the following in order:
1. For each of these Linear issues, set the status to "Done" using save_issue with stateName "Done": ${mergedIssues.join(', ')}
2. Post a comment on Linear planning issue ${state.planning_issue} summarising what was merged: ${mergedRefs.join(', ')}. Use the Linear MCP create_comment tool.`,
      group,
      chatJid,
      onProcess,
    ).catch(err => logger.warn({ err }, 'processMerge: failed to update Linear statuses after merge'));
  }

  const remaining = state.tasks.filter(t => t.status !== 'merged');
  if (remaining.length === 0) {
    state.state = 'COMPLETE';
    state.next_action_at = randomDelay(1, 2);
  } else {
    state.next_action_at = randomDelay(3, 5);
  }

  writeState(state);
  return tickResults.join('\n');
}

async function finishSprint(
  state: SprintState,
  group: RegisteredGroup,
  chatJid: string,
  onProcess: (proc: ChildProcess, containerName: string) => void,
): Promise<string> {
  // Merge gate: verify all PRs are actually merged on GitHub before archiving
  const tasksWithPR = state.tasks.filter(t => t.pr !== null && t.pr !== undefined);
  const unmergedPRs: number[] = [];

  for (const task of tasksWithPR) {
    try {
      const prState = execSync(
        `gh pr view ${task.pr} --repo ${DEVTEAM_UPSTREAM_REPO} --json state --jq '.state'`,
        { encoding: 'utf8', timeout: 15000, env: { ...process.env, PATH: EXTENDED_PATH, GH_TOKEN: DEVTEAM_PM_GITHUB_TOKEN } },
      ).trim();

      if (prState !== 'MERGED') {
        unmergedPRs.push(task.pr!);
      }
    } catch (err) {
      logger.warn({ pr: task.pr, err }, 'finishSprint: could not check PR state — treating as unmerged');
      unmergedPRs.push(task.pr!);
    }
  }

  if (unmergedPRs.length > 0) {
    logger.warn({ unmergedPRs }, 'finishSprint: unmerged PRs found — returning to MERGE state');
    state.state = 'MERGE';
    state.next_action_at = randomDelay(3, 5);
    writeState(state);
    return `Sprint not complete — ${unmergedPRs.length} PR(s) still unmerged: #${unmergedPRs.join(', #')}. Returning to MERGE.`;
  }

  // Build sprint summary
  const durationMs = state.started_at ? Date.now() - new Date(state.started_at).getTime() : 0;
  const durationMin = Math.round(durationMs / 60000);
  const durationStr = durationMin >= 60
    ? `${Math.floor(durationMin / 60)}h ${durationMin % 60}m`
    : `${durationMin}m`;
  const summaryRows = state.tasks
    .filter(t => t.issue !== null)
    .map(t => `| ${t.issue} | @${agentConfig(t.assignee).user} | ${t.pr ? `#${t.pr}` : '—'} | ✅ Merged |`)
    .join('\n');

  const sprintSummary = [
    `## 🏁 Sprint #${state.sprint_number} Complete`,
    '',
    '### Summary',
    `- **Duration:** ${durationStr}`,
    `- **Tasks completed:** ${state.tasks.filter(t => t.status === 'merged').length}/${state.tasks.length}`,
    `- **PRs merged:** ${state.tasks.filter(t => t.pr !== null).map(t => `#${t.pr}`).join(', ') || '—'}`,
    '',
    '### Tasks',
    '| Issue | Assignee | PR | Status |',
    '|-------|----------|----|--------|',
    summaryRows || '| — | — | — | — |',
    '',
    'Sprint complete. The team will begin the next sprint shortly.',
  ].join('\n');

  // Post sprint summary to Linear, mark all tasks and planning issue as Done
  if (state.planning_issue) {
    const taskIssues = state.tasks.map(t => t.issue).filter(Boolean);
    await runAgent('orchestrator', `
Sprint #${state.sprint_number} is complete. Do the following in order:

1. Mark each of these task issues as "Done" using save_issue with stateName "Done": ${taskIssues.join(', ')}
2. Post the following summary as a comment on Linear issue ${state.planning_issue} using create_comment:

${sprintSummary}

3. Mark the planning issue ${state.planning_issue} as "Done" using save_issue with stateName "Done"
`, group, chatJid, onProcess);
  }

  // Archive sprint
  const historyFile = path.join(
    PROMPTS_DIR, 'sprint-history',
    `sprint-${String(state.sprint_number).padStart(3, '0')}.json`
  );
  fs.writeFileSync(historyFile, JSON.stringify(state, null, 2));

  // Reset for next sprint
  state.state = 'IDLE';
  state.planning_issue = null;
  state.tasks = [];
  state.debate_round = 0;
  state.review_round = 0;
  state.next_action_at = randomDelay(20, 40); // 20-40 min break between sprints

  writeState(state);

  return `Sprint #${state.sprint_number} complete. Next sprint in ~30 minutes.`;
}
