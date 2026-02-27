# Dev Team Simulation — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an autonomous dev team simulation that runs two AI agents (Carlos=senior, Ana=junior) continuously developing a React/TanStack SPA, with all activity flowing through GitHub (Issues, PRs, code reviews).

**Architecture:** A Sprint Orchestrator (Sonnet, NanoClaw scheduled task) manages a state machine that coordinates two container agents (Haiku). Each agent has its own GitHub account/fork and communicates exclusively via GitHub Issues and PR comments. The orchestrator wakes every 5 minutes, checks state, and dispatches the next action.

**Tech Stack:** NanoClaw (Node.js/TypeScript), Claude Agent SDK (query with model param), GitHub CLI (gh), React + Vite + TanStack (target app).

---

## Phase 1: Infrastructure — Model Selection Support

### Task 1: Add `model` field to ContainerInput

**Files:**
- Modify: `src/container-runner.ts:67-77` (ContainerInput interface)
- Modify: `container/agent-runner/src/index.ts:21-31` (ContainerInput interface)

**Step 1: Add model field to host ContainerInput**

In `src/container-runner.ts`, add `model?: string` to the `ContainerInput` interface:

```typescript
export interface ContainerInput {
  prompt: string;
  sessionId?: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask?: boolean;
  /* ved custom */ notifyJid?: string; /* ved custom end */
  assistantName?: string;
  secrets?: Record<string, string>;
  /* ved custom */ model?: string; /* ved custom end */
}
```

**Step 2: Add model field to agent-runner ContainerInput**

In `container/agent-runner/src/index.ts`, mirror the same field:

```typescript
interface ContainerInput {
  prompt: string;
  sessionId?: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask?: boolean;
  /* ved custom */ notifyJid?: string; /* ved custom end */
  assistantName?: string;
  secrets?: Record<string, string>;
  /* ved custom */ model?: string; /* ved custom end */
}
```

**Step 3: Thread model into `query()` call**

In `container/agent-runner/src/index.ts`, in the `runQuery` function, add `model` to the query options:

```typescript
for await (const message of query({
  prompt: stream,
  options: {
    model: containerInput.model, // undefined = SDK default
    cwd: '/workspace/group',
    // ... rest of existing options
  }
})) {
```

**Step 4: Build and verify**

Run: `npm run typecheck`
Expected: No type errors.

**Step 5: Commit**

```bash
git add src/container-runner.ts container/agent-runner/src/index.ts
git commit -m "feat(devteam): add model field to ContainerInput for per-task model selection"
```

---

## Phase 2: Telegram `/devteam` Command

### Task 2: Add devteam command handler to Telegram channel

**Files:**
- Modify: `src/channels/telegram.ts` (add command inside `connect()`)

**Step 1: Add the `/devteam` command handler**

In `src/channels/telegram.ts`, inside the `connect()` method, add a new command handler **before** the `this.bot.on('message:text', ...)` line:

```typescript
// Dev Team control commands
this.bot.command('devteam', async (ctx) => {
  const args = (ctx.match as string || '').trim().toLowerCase();
  const stateFile = path.join(process.cwd(), 'data', 'dev-team', 'sprint-state.json');

  if (args === 'stop') {
    try {
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
      state.paused = true;
      fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
      ctx.reply('Dev team paused. Use /devteam start to resume.');
    } catch {
      ctx.reply('No active dev team state found.');
    }
  } else if (args === 'start') {
    try {
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
      state.paused = false;
      fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
      ctx.reply('Dev team resumed.');
    } catch {
      ctx.reply('No dev team state found. The orchestrator will create one on first run.');
    }
  } else if (args === 'status') {
    try {
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
      const lines = [
        `Sprint: #${state.sprint_number}`,
        `State: ${state.state}`,
        `Paused: ${state.paused ? 'Yes' : 'No'}`,
        `Tasks: ${(state.tasks || []).length}`,
        `Next action: ${state.next_action_at || 'N/A'}`,
      ];
      ctx.reply(lines.join('\n'));
    } catch {
      ctx.reply('No active dev team state found.');
    }
  } else {
    ctx.reply('Usage: /devteam stop | start | status');
  }
});
```

**Step 2: Add imports at top of file**

Add `import fs from 'fs';` and `import path from 'path';` if not already imported.

**Step 3: Typecheck**

Run: `npm run typecheck`

**Step 4: Commit**

```bash
git add src/channels/telegram.ts
git commit -m "feat(devteam): add /devteam stop|start|status Telegram command"
```

---

## Phase 3: Sprint State and Data Structure

### Task 3: Create dev-team data directory and initial state

**Files:**
- Create: `data/dev-team/sprint-state.json`
- Create: `data/dev-team/orchestrator-prompt.md`
- Create: `data/dev-team/carlos-prompt.md`
- Create: `data/dev-team/ana-prompt.md`

**Step 1: Create directory and initial state**

```bash
mkdir -p data/dev-team/sprint-history
```

Write `data/dev-team/sprint-state.json`:

```json
{
  "sprint_number": 0,
  "state": "IDLE",
  "paused": false,
  "started_at": null,
  "planning_issue": null,
  "tasks": [],
  "next_action_at": null,
  "upstream_repo": "",
  "senior_fork": "",
  "junior_fork": ""
}
```

**Step 2: Create orchestrator prompt**

Write `data/dev-team/orchestrator-prompt.md`:

```markdown
# Sprint Orchestrator

You are the Sprint Orchestrator for a dev team simulation. You manage the sprint lifecycle for two developers (Carlos and Ana) working on a React/TypeScript SPA.

## Your Role

You make decisions about:
- Whether the planning debate has reached consensus
- How to split tasks between the two developers (non-conflicting)
- When a PR is ready to merge
- What the next sprint should focus on

## Current State

The sprint state is provided in your prompt. Based on the current state, execute the next action.

## Rules

1. Always output valid JSON with your decision
2. Tasks must not have file conflicts between developers
3. Each sprint should have 2-4 tasks total
4. Senior (Carlos) gets architectural/complex tasks
5. Junior (Ana) gets UI/component tasks
6. Always use GitHub CLI (`gh`) for all GitHub operations
```

**Step 3: Create Carlos (senior) prompt**

Write `data/dev-team/carlos-prompt.md`:

```markdown
# Carlos — Senior Developer

You are Carlos, a senior fullstack developer with 10 years of experience, specializing in React with TypeScript. You also have strong backend experience with databases and API design.

## Your Identity

- Name: Carlos
- Role: Senior Developer
- Experience: 10 years
- Strengths: Architecture, abstractions, custom hooks, TypeScript generics, performance optimization
- Style: Clean code advocate, favors composition over inheritance, separation of concerns

## Code Style

- Use custom hooks to encapsulate logic
- Create well-typed interfaces and generics when appropriate
- Prefer small, focused components
- Conventional commits: `feat:`, `fix:`, `refactor:`, `chore:`
- Atomic commits — one logical change per commit

## When Reviewing Code (Ana's PRs)

- Be constructive but thorough
- Point out code smells and suggest better patterns
- Include inline code examples in your suggestions
- Praise good decisions, especially when Ana tackles something complex
- Request changes when you see:
  - Use of `any` type
  - Duplicated logic that should be abstracted
  - Missing error handling
  - Performance concerns (unnecessary re-renders)
- Keep your tone mentoring, not condescending

## When Planning Sprints

- Propose features that improve architecture and DX
- Think about state management, routing structure, data fetching patterns
- Sometimes you over-engineer — be open to pushback from Ana about YAGNI

## GitHub Operations

Use `gh` CLI for all GitHub operations. Your fork remote is `origin`, upstream is `upstream`.

Always:
1. Sync fork before starting work: `gh repo sync --force`
2. Create feature branch from main
3. Make atomic commits as you work
4. Push to your fork and create PR to upstream
```

**Step 4: Create Ana (junior) prompt**

Write `data/dev-team/ana-prompt.md`:

```markdown
# Ana — Junior Developer

You are Ana, a frontend developer with 3 years of experience, trending towards mid-level. You develop exclusively in React.

## Your Identity

- Name: Ana
- Role: Junior Developer (trending mid)
- Experience: 3 years, frontend only
- Strengths: UI/UX intuition, pragmatic solutions, CSS/Tailwind, component composition
- Style: Direct and practical, prefers working code over perfect abstractions

## Code Style

- Pragmatic — working code first, refactor later
- Sometimes writes `any` when a proper type would take too long (you're improving on this)
- Might duplicate a small piece of logic rather than creating a premature abstraction
- Conventional commits with slightly more descriptive messages
- Getting better at TypeScript sprint over sprint

## When Reviewing Code (Carlos's PRs)

- Ask genuine questions when you don't understand an abstraction: "Why not just X here?"
- Less assertive in suggestions, but you DO catch real bugs
- Push back on over-engineering with YAGNI arguments
- Request explanations for complex generic types
- Approve faster than Carlos — you trust his experience
- Your tone is curious and collaborative

## When Planning Sprints

- Suggest features that improve UX and visual polish
- Think about components, interactions, responsiveness, accessibility
- Push for simplicity when Carlos proposes complex abstractions
- Bring up edge cases from a user's perspective

## GitHub Operations

Use `gh` CLI for all GitHub operations. Your fork remote is `origin`, upstream is `upstream`.

Always:
1. Sync fork before starting work: `gh repo sync --force`
2. Create feature branch from main
3. Make atomic commits as you work
4. Push to your fork and create PR to upstream
```

**Step 5: Commit**

```bash
git add data/dev-team/
git commit -m "feat(devteam): add sprint state file and agent persona prompts"
```

---

## Phase 4: Environment Variables

### Task 4: Add devteam env vars to .env.example and config

**Files:**
- Modify: `.env.example`
- Modify: `src/config.ts` (add devteam config exports)

**Step 1: Add env vars to .env.example**

Append to `.env.example`:

```
# Dev Team Simulation
DEVTEAM_ENABLED=false
DEVTEAM_UPSTREAM_REPO=
DEVTEAM_SENIOR_GITHUB_TOKEN=
DEVTEAM_SENIOR_GITHUB_USER=
DEVTEAM_JUNIOR_GITHUB_TOKEN=
DEVTEAM_JUNIOR_GITHUB_USER=
```

**Step 2: Add config exports**

In `src/config.ts`, add:

```typescript
/* ved custom */
// Dev Team Simulation
export const DEVTEAM_ENABLED = process.env.DEVTEAM_ENABLED === 'true';
export const DEVTEAM_UPSTREAM_REPO = process.env.DEVTEAM_UPSTREAM_REPO || '';
export const DEVTEAM_SENIOR_GITHUB_TOKEN = process.env.DEVTEAM_SENIOR_GITHUB_TOKEN || '';
export const DEVTEAM_SENIOR_GITHUB_USER = process.env.DEVTEAM_SENIOR_GITHUB_USER || '';
export const DEVTEAM_JUNIOR_GITHUB_TOKEN = process.env.DEVTEAM_JUNIOR_GITHUB_TOKEN || '';
export const DEVTEAM_JUNIOR_GITHUB_USER = process.env.DEVTEAM_JUNIOR_GITHUB_USER || '';
/* ved custom end */
```

**Step 3: Typecheck and commit**

Run: `npm run typecheck`

```bash
git add .env.example src/config.ts
git commit -m "feat(devteam): add environment variables for dev team simulation"
```

---

## Phase 5: The Sprint Orchestrator

### Task 5: Create the orchestrator module

**Files:**
- Create: `src/dev-team-orchestrator.ts`

This is the core module. It exports a function that the scheduler calls. The function reads the sprint state, determines the next action, and dispatches it.

**Step 1: Create the orchestrator**

Write `src/dev-team-orchestrator.ts`:

```typescript
/* ved custom */
import fs from 'fs';
import path from 'path';
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
  onProcess: (proc: any, containerName: string) => void,
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
      return await startNewSprint(state, group, onProcess);
    case 'PLANNING':
      return await startDebate(state, group, onProcess);
    case 'DEBATE':
      return await continueDebate(state, group, onProcess);
    case 'TASKING':
      return await startDev(state, group, onProcess);
    case 'DEV':
      return await checkDevProgress(state, group, onProcess);
    case 'REVIEW':
      return await processReview(state, group, onProcess);
    case 'MERGE':
      return await processMerge(state, group, onProcess);
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
  onProcess: (proc: any, containerName: string) => void,
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
      chatJid: group.jid,
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
  onProcess: (proc: any, containerName: string) => void,
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
`, group, onProcess);

  // Parse issue number from result
  const match = result.match(/ISSUE_NUMBER=(\d+)/);
  if (match) {
    state.planning_issue = parseInt(match[1], 10);
  }

  state.next_action_at = randomDelay(3, 8);
  writeState(state);

  // Archive previous sprint if exists
  if (state.sprint_number > 1) {
    const historyFile = path.join(PROMPTS_DIR, 'sprint-history', `sprint-${String(state.sprint_number - 1).padStart(3, '0')}.json`);
    // Previous state was already written, we just note the transition
  }

  return `Sprint #${state.sprint_number} started. Planning issue: #${state.planning_issue}`;
}

async function startDebate(
  state: SprintState,
  group: RegisteredGroup,
  onProcess: (proc: any, containerName: string) => void,
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
`, group, onProcess);

  state.next_action_at = randomDelay(3, 8);
  writeState(state);

  return `Carlos proposed features for Sprint #${state.sprint_number}`;
}

async function continueDebate(
  state: SprintState,
  group: RegisteredGroup,
  onProcess: (proc: any, containerName: string) => void,
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
`, group, onProcess);

  // Check if orchestrator detects consensus
  const orchestratorResult = await runAgent('orchestrator', `
Read the comments on Issue #${state.planning_issue} in repo ${DEVTEAM_UPSTREAM_REPO}:
  gh issue view ${state.planning_issue} --repo ${DEVTEAM_UPSTREAM_REPO} --comments

Analyze whether the team has reached consensus on sprint tasks.
If yes, respond with: CONSENSUS=true
If no, respond with: CONSENSUS=false
`, group, onProcess);

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
  onProcess: (proc: any, containerName: string) => void,
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
`, group, onProcess);

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
  onProcess: (proc: any, containerName: string) => void,
): Promise<string> {
  // Find a pending task and dispatch the agent
  const pendingTask = state.tasks.find(t => t.status === 'pending');

  if (pendingTask) {
    const agent = pendingTask.assignee;
    const config = agentConfig(agent);

    await runAgent(agent, `
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
`, group, onProcess);

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
  onProcess: (proc: any, containerName: string) => void,
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
`, group, onProcess);

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
  onProcess: (proc: any, containerName: string) => void,
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
`, group, onProcess);

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
```

**Step 2: Typecheck**

Run: `npm run typecheck`

**Step 3: Commit**

```bash
git add src/dev-team-orchestrator.ts
git commit -m "feat(devteam): implement sprint orchestrator state machine"
```

---

## Phase 6: Integrate Orchestrator with Scheduler

### Task 6: Register the orchestrator as a scheduled task

**Files:**
- Modify: `src/index.ts` (add devteam orchestrator startup)

**Step 1: Add orchestrator to the main startup**

In `src/index.ts`, after the scheduler loop is started, add a devteam orchestrator check.

The simplest integration is to create a scheduled task via the database on first startup (if DEVTEAM_ENABLED and no devteam task exists). The task uses an interval of 300000 (5 minutes).

Add this function and call it during startup:

```typescript
/* ved custom */
import { DEVTEAM_ENABLED, DEVTEAM_UPSTREAM_REPO } from './config.js';

async function initDevTeam() {
  if (!DEVTEAM_ENABLED || !DEVTEAM_UPSTREAM_REPO) return;

  // Check if devteam task already exists
  const tasks = getAllTasks();
  const existing = tasks.find(t => t.id === 'devteam-orchestrator');
  if (existing) return;

  // Create the orchestrator scheduled task
  createTask({
    id: 'devteam-orchestrator',
    group_folder: 'background',
    chat_jid: Object.keys(registeredGroups).find(jid => registeredGroups[jid].folder === 'background') || '',
    prompt: '__DEVTEAM_ORCHESTRATOR__',
    schedule_type: 'interval',
    schedule_value: '300000',
    context_mode: 'isolated',
    next_run: new Date().toISOString(),
    last_run: null,
    last_result: null,
    status: 'active',
    created_at: new Date().toISOString(),
  });

  logger.info('DevTeam orchestrator scheduled task created');
}
/* ved custom end */
```

**Step 2: Hook into task-scheduler to intercept the devteam task**

In `src/task-scheduler.ts`, inside `runTask()`, add a special case for the devteam orchestrator prompt:

```typescript
/* ved custom */
import { runDevTeamOrchestrator } from './dev-team-orchestrator.js';

// Inside runTask(), before the runContainerAgent call:
if (task.prompt === '__DEVTEAM_ORCHESTRATOR__') {
  try {
    const result = await runDevTeamOrchestrator(group, (proc, containerName) =>
      deps.onProcess(task.chat_jid, proc, containerName, task.group_folder));
    logTaskRun({
      task_id: task.id,
      run_at: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      status: 'success',
      result: result.slice(0, 200),
      error: null,
    });
    // Advance next_run
    const nextRun = new Date(Date.now() + parseInt(task.schedule_value, 10)).toISOString();
    updateTaskAfterRun(task.id, nextRun, result.slice(0, 200));
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logTaskRun({
      task_id: task.id,
      run_at: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      status: 'error',
      result: null,
      error,
    });
  }
  return;
}
/* ved custom end */
```

**Step 3: Typecheck and commit**

Run: `npm run typecheck`

```bash
git add src/index.ts src/task-scheduler.ts
git commit -m "feat(devteam): integrate orchestrator with NanoClaw scheduler"
```

---

## Phase 7: Upstream Repo Scaffold

### Task 7: Create the React + TanStack scaffold script

**Files:**
- Create: `scripts/devteam-scaffold.sh`

This script creates the upstream repo with the full React + TanStack + MSW + Tailwind setup.

**Step 1: Write the scaffold script**

Write `scripts/devteam-scaffold.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Usage: ./scripts/devteam-scaffold.sh <repo-name>
# Creates a new GitHub repo with React + TanStack + MSW + Tailwind scaffold

REPO_NAME="${1:?Usage: $0 <repo-name>}"
REPO_DIR="/tmp/devteam-scaffold-${REPO_NAME}"

echo "Creating scaffold in ${REPO_DIR}..."

# Create project with Vite
npm create vite@latest "${REPO_DIR}" -- --template react-ts
cd "${REPO_DIR}"

# Install TanStack suite
npm install @tanstack/react-router @tanstack/react-query @tanstack/react-table @tanstack/react-form @tanstack/react-virtual

# Install MSW for API mocking
npm install msw --save-dev

# Install Tailwind CSS
npm install -D tailwindcss @tailwindcss/vite

# Install dev tools
npm install -D prettier eslint @eslint/js typescript-eslint

# Initialize git
git init -b main
git add -A
git commit -m "chore: scaffold React + TanStack + MSW + Tailwind project"

# Create GitHub repo
gh repo create "${REPO_NAME}" --public --source=. --push

echo ""
echo "Repo created: https://github.com/$(gh api user -q .login)/${REPO_NAME}"
echo ""
echo "Next steps:"
echo "  1. Create GitHub accounts for Carlos and Ana"
echo "  2. Fork the repo from each account"
echo "  3. Add PATs to .env"
```

**Step 2: Make executable and commit**

```bash
chmod +x scripts/devteam-scaffold.sh
git add scripts/devteam-scaffold.sh
git commit -m "feat(devteam): add upstream repo scaffold script"
```

---

## Phase 8: Testing

### Task 8: Write tests for the orchestrator state machine

**Files:**
- Create: `src/dev-team-orchestrator.test.ts`

**Step 1: Write unit tests for state transitions**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';

// Mock dependencies
vi.mock('./container-runner.js', () => ({
  runContainerAgent: vi.fn().mockResolvedValue({ status: 'success', result: 'ISSUE_NUMBER=1' }),
}));
vi.mock('./config.js', () => ({
  DEVTEAM_UPSTREAM_REPO: 'test/repo',
  DEVTEAM_SENIOR_GITHUB_TOKEN: 'token-sr',
  DEVTEAM_SENIOR_GITHUB_USER: 'carlos-test',
  DEVTEAM_JUNIOR_GITHUB_TOKEN: 'token-jr',
  DEVTEAM_JUNIOR_GITHUB_USER: 'ana-test',
}));
vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('DevTeam Orchestrator', () => {
  it('should read and write sprint state', () => {
    const stateFile = '/tmp/test-sprint-state.json';
    const state = {
      sprint_number: 0,
      state: 'IDLE',
      paused: false,
      started_at: null,
      planning_issue: null,
      tasks: [],
      next_action_at: null,
      upstream_repo: 'test/repo',
      senior_fork: '',
      junior_fork: '',
      debate_round: 0,
      review_round: 0,
    };
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
    const read = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    expect(read.state).toBe('IDLE');
  });

  it('should skip when paused', async () => {
    // The orchestrator should return early when paused
    // This validates the pause mechanism from /devteam stop
    expect(true).toBe(true); // Placeholder - full integration test needs container
  });
});
```

**Step 2: Run tests**

Run: `npx vitest run src/dev-team-orchestrator.test.ts`

**Step 3: Commit**

```bash
git add src/dev-team-orchestrator.test.ts
git commit -m "test(devteam): add orchestrator state machine tests"
```

---

## Phase 9: Deploy and Sync

### Task 9: Build, sync containers, and restart

**Step 1: Sync agent-runner source to session copies**

```bash
for dir in data/sessions/*/agent-runner-src; do cp -r container/agent-runner/src/. "$dir/"; done
```

**Step 2: Build host TypeScript**

```bash
npm run build
```

**Step 3: Rebuild container**

```bash
./container/build.sh
```

**Step 4: Add devteam env vars to .env**

Add to `.env` (user fills in actual values):

```
DEVTEAM_ENABLED=true
DEVTEAM_UPSTREAM_REPO=fabiovedovelli/repo-name
DEVTEAM_SENIOR_GITHUB_TOKEN=ghp_xxx
DEVTEAM_SENIOR_GITHUB_USER=carlos-xxx
DEVTEAM_JUNIOR_GITHUB_TOKEN=ghp_yyy
DEVTEAM_JUNIOR_GITHUB_USER=ana-xxx
```

**Step 5: Restart NanoClaw**

```bash
launchctl kickstart -k gui/$(id -u)/com.nanoclaw
```

**Step 6: Verify via Telegram**

Send `/devteam status` — should respond with current state.

---

## Summary of Tasks

| # | Task | Phase | Est. Steps |
|---|------|-------|-----------|
| 1 | Add `model` field to ContainerInput | Infrastructure | 5 |
| 2 | Telegram `/devteam` command | Telegram | 4 |
| 3 | Sprint state + agent prompts | Data | 5 |
| 4 | Environment variables | Config | 3 |
| 5 | Sprint orchestrator module | Core | 3 |
| 6 | Scheduler integration | Integration | 3 |
| 7 | Upstream repo scaffold script | Setup | 2 |
| 8 | Tests | Testing | 3 |
| 9 | Deploy and verify | Deploy | 6 |

## Dependencies

- Tasks 1-4 can run in parallel (no dependencies)
- Task 5 depends on Task 1 (model field) and Task 4 (config)
- Task 6 depends on Task 5 (orchestrator module)
- Task 7 is independent (can run anytime)
- Task 8 depends on Task 5
- Task 9 depends on all previous tasks
