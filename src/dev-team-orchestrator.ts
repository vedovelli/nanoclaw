/* ved custom */
import fs from 'fs';
import path from 'path';
import { ChildProcess } from 'child_process';
import { runContainerAgent } from './container-runner.js';
import {
  DEVTEAM_UPSTREAM_REPO,
  DEVTEAM_SENIOR_GITHUB_TOKEN,
  DEVTEAM_SENIOR_GITHUB_USER,
  DEVTEAM_JUNIOR_GITHUB_TOKEN,
  DEVTEAM_JUNIOR_GITHUB_USER,
} from './config.js';
import { RegisteredGroup } from './types.js';
import { logger } from './logger.js';

export interface SprintTask {
  issue: number | null;
  assignee: 'senior' | 'junior';
  pr: number | null;
  status: 'pending' | 'dev' | 'pr_created' | 'in_review' | 'changes_requested' | 'approved' | 'merged';
  branch: string | null;
}

export interface SprintState {
  sprint_number: number;
  state: 'IDLE' | 'PLANNING' | 'DEBATE' | 'TASKING' | 'DEV' | 'REVIEW' | 'MERGE' | 'COMPLETE';
  paused: boolean;
  started_at: string | null;
  planning_issue: number | null;
  tasks: SprintTask[];
  next_action_at: string | null;
  upstream_repo: string;
  senior_fork: string;
  junior_fork: string;
  debate_round: number;
  review_round: number;
}

const STATE_FILE = path.join(process.cwd(), 'data', 'dev-team', 'sprint-state.json');
const PROMPTS_DIR = path.join(process.cwd(), 'data', 'dev-team');

function readState(): SprintState {
  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
}

function writeState(state: SprintState): void {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function randomDelay(minMinutes: number, maxMinutes: number): string {
  const delayMs = (minMinutes + Math.random() * (maxMinutes - minMinutes)) * 60 * 1000;
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
    case 'MERGE':
      return await processMerge(state, group, chatJid, onProcess);
    case 'COMPLETE':
      return await finishSprint(state);
    default:
      return `Unknown state: ${state.state}`;
  }
}

async function runAgent(
  agent: 'senior' | 'junior' | 'orchestrator',
  prompt: string,
  group: RegisteredGroup,
  chatJid: string,
  onProcess: (proc: ChildProcess, containerName: string) => void,
): Promise<string> {
  const config = agent === 'orchestrator'
    ? { token: DEVTEAM_SENIOR_GITHUB_TOKEN, user: DEVTEAM_SENIOR_GITHUB_USER }
    : agentConfig(agent);

  const systemPrompt = agent === 'orchestrator'
    ? readPrompt('orchestrator-prompt.md')
    : readPrompt(agent === 'senior' ? 'carlos-prompt.md' : 'ana-prompt.md');

  const fullPrompt = `${systemPrompt}\n\n---\n\n## Current Task\n\n${prompt}`;

  const model = agent === 'orchestrator' ? 'sonnet' : 'haiku';

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
    onProcess,
  );

  return output.result || output.error || 'No output';
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

  // Use orchestrator (Sonnet) to create the planning issue
  const result = await runAgent('orchestrator', `
Create a new GitHub Issue on ${DEVTEAM_UPSTREAM_REPO} for Sprint #${state.sprint_number} planning.

Title: "Sprint #${state.sprint_number} Planning"

Body should include:
- A brief summary of what the team should focus on this sprint
- A call for Carlos and Ana to propose features
- Reference to previous sprints if sprint_number > 1

Use: gh issue create --repo ${DEVTEAM_UPSTREAM_REPO} --title "Sprint #${state.sprint_number} Planning" --body "..."

Return the issue number in your response as: ISSUE_NUMBER=<number>
`, group, chatJid, onProcess);

  // Parse issue number from result
  const match = result.match(/ISSUE_NUMBER=(\d+)/);
  if (match) {
    state.planning_issue = parseInt(match[1], 10);
  }

  state.next_action_at = randomDelay(3, 8);
  writeState(state);

  return `Sprint #${state.sprint_number} started. Planning issue: #${state.planning_issue}`;
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
Comment on Issue #${state.planning_issue} in repo ${DEVTEAM_UPSTREAM_REPO}.

Propose 2-3 features for this sprint. Consider:
- What the app needs architecturally
- TanStack features that could be leveraged (Router, Query, Table, Form, Virtual)
- MSW mocks that need to be set up

Use: gh issue comment ${state.planning_issue} --repo ${DEVTEAM_UPSTREAM_REPO} --body "..."
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
  const agent: 'senior' | 'junior' = state.debate_round % 2 === 0 ? 'senior' : 'junior';

  // Read the issue comments to understand context
  await runAgent(agent, `
You're participating in Sprint #${state.sprint_number} planning.
First read the existing comments on Issue #${state.planning_issue}:
  gh issue view ${state.planning_issue} --repo ${DEVTEAM_UPSTREAM_REPO} --comments

Then add your response as a comment. You can:
- Agree with proposals and add detail
- Counter-propose simpler/different approaches
- Suggest modifications

If you feel there's enough agreement on 2-4 tasks, end your comment with: CONSENSUS_REACHED

Use: gh issue comment ${state.planning_issue} --repo ${DEVTEAM_UPSTREAM_REPO} --body "..."
`, group, chatJid, onProcess);

  // Check if orchestrator detects consensus
  const orchestratorResult = await runAgent('orchestrator', `
Read the comments on Issue #${state.planning_issue} in repo ${DEVTEAM_UPSTREAM_REPO}:
  gh issue view ${state.planning_issue} --repo ${DEVTEAM_UPSTREAM_REPO} --comments

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
Read the planning Issue #${state.planning_issue} and its comments in repo ${DEVTEAM_UPSTREAM_REPO}:
  gh issue view ${state.planning_issue} --repo ${DEVTEAM_UPSTREAM_REPO} --comments

Based on the discussion, create 2-4 individual task Issues. For each:
1. Create the issue with a clear title and description
2. Add label "senior" or "junior" based on complexity (senior gets architectural tasks, junior gets UI tasks)
3. Assign to the appropriate developer

Use: gh issue create --repo ${DEVTEAM_UPSTREAM_REPO} --title "..." --body "..." --label "senior|junior"

For each issue created, output a line:
TASK|<issue_number>|<senior|junior>|<branch_name>
`, group, chatJid, onProcess);

  // Parse tasks from orchestrator output
  const taskLines = result.split('\n').filter(l => l.startsWith('TASK|'));
  state.tasks = taskLines.map(line => {
    const [, issue, assignee, branch] = line.split('|');
    return {
      issue: parseInt(issue, 10),
      assignee: assignee as 'senior' | 'junior',
      pr: null,
      status: 'pending' as const,
      branch: branch || null,
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
  const pendingTask = state.tasks.find(t => t.status === 'pending');

  if (pendingTask) {
    const agent = pendingTask.assignee;
    const config = agentConfig(agent);

    const devResult = await runAgent(agent, `
You need to implement the feature described in Issue #${pendingTask.issue} on repo ${DEVTEAM_UPSTREAM_REPO}.

Steps:
1. Sync your fork: gh repo sync ${config.user}/${DEVTEAM_UPSTREAM_REPO.split('/')[1]} --force
2. Clone or cd into your fork working directory
3. Read the issue: gh issue view ${pendingTask.issue} --repo ${DEVTEAM_UPSTREAM_REPO}
4. Create a feature branch from main
5. Implement the feature with multiple atomic commits
6. Push to your fork
7. Create a PR to upstream: gh pr create --repo ${DEVTEAM_UPSTREAM_REPO} --head ${config.user}:your-branch --title "..." --body "Closes #${pendingTask.issue}\n\n..."

When done, output: PR_CREATED=<number>
`, group, chatJid, onProcess);

    // Parse PR number from agent output so REVIEW and MERGE can reference it
    const prMatch = devResult.match(/PR_CREATED=(\d+)/);
    if (prMatch) {
      pendingTask.pr = parseInt(prMatch[1], 10);
    }
    pendingTask.status = 'pr_created';
    state.next_action_at = randomDelay(10, 30);
    writeState(state);
    return `${agent} started working on Issue #${pendingTask.issue}`;
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
  state.review_round++;

  // Find a task that needs review
  const needsReview = state.tasks.find(
    t => t.status === 'pr_created' || t.status === 'changes_requested'
  );

  if (!needsReview || !needsReview.pr) {
    // Check if all approved
    const allApproved = state.tasks.every(t => t.status === 'approved' || t.status === 'merged');
    if (allApproved) {
      state.state = 'MERGE';
      state.next_action_at = randomDelay(3, 5);
      writeState(state);
      return 'All PRs approved. Moving to merge.';
    }
    state.next_action_at = randomDelay(5, 15);
    writeState(state);
    return 'Waiting for PRs to review.';
  }

  // Cross-review: the other agent reviews
  const reviewer = needsReview.assignee === 'senior' ? 'junior' : 'senior';

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
  ? 'After your review, APPROVE the PR: gh pr review ' + needsReview.pr + ' --repo ' + DEVTEAM_UPSTREAM_REPO + ' --approve --body "..."'
  : 'After your review, REQUEST CHANGES: gh pr review ' + needsReview.pr + ' --repo ' + DEVTEAM_UPSTREAM_REPO + ' --request-changes --body "..."'
}

Also leave 1-3 inline comments on specific lines using:
gh api repos/${DEVTEAM_UPSTREAM_REPO}/pulls/${needsReview.pr}/comments -f body="..." -f commit_id="..." -f path="..." -F line=N

Output: REVIEW_RESULT=${shouldApprove ? 'approved' : 'changes_requested'}
`, group, chatJid, onProcess);

  needsReview.status = shouldApprove ? 'approved' : 'changes_requested';

  if (!shouldApprove) {
    // Author needs to address changes
    state.next_action_at = randomDelay(5, 15);
  } else {
    state.next_action_at = randomDelay(3, 5);
  }

  // Check if all tasks are approved
  const allApproved = state.tasks.every(t => t.status === 'approved' || t.status === 'merged');
  if (allApproved) {
    state.state = 'MERGE';
  }

  writeState(state);
  return `Review round ${state.review_round} for PR #${needsReview.pr}: ${needsReview.status}`;
}

async function processMerge(
  state: SprintState,
  group: RegisteredGroup,
  chatJid: string,
  onProcess: (proc: ChildProcess, containerName: string) => void,
): Promise<string> {
  const toMerge = state.tasks.find(t => t.status === 'approved');

  if (!toMerge || !toMerge.pr) {
    state.state = 'COMPLETE';
    state.next_action_at = randomDelay(1, 2);
    writeState(state);
    return 'All tasks merged. Sprint complete.';
  }

  // Orchestrator merges the PR
  await runAgent('orchestrator', `
Merge PR #${toMerge.pr} on repo ${DEVTEAM_UPSTREAM_REPO}:
  gh pr merge ${toMerge.pr} --repo ${DEVTEAM_UPSTREAM_REPO} --squash --delete-branch

Output: MERGED=true
`, group, chatJid, onProcess);

  toMerge.status = 'merged';

  const remaining = state.tasks.filter(t => t.status !== 'merged');
  if (remaining.length === 0) {
    state.state = 'COMPLETE';
    state.next_action_at = randomDelay(1, 2);
  } else {
    state.next_action_at = randomDelay(3, 5);
  }

  writeState(state);
  return `PR #${toMerge.pr} merged.`;
}

async function finishSprint(state: SprintState): Promise<string> {
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
/* ved custom end */
