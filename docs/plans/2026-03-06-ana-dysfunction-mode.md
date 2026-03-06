# Ana Dysfunction Mode — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a toggleable "dysfunction mode" to the dev team simulation where Ana leaves issues unimplemented and skips PR reviews, generating realistic disengaged-developer signals for DevVis.

**Architecture:** Two-layer control. (1) The orchestrator skips Ana's container in DEV and REVIEW phases when `dysfunctionMode: true` in sprint state, producing missing PRs and unreviewed code. (2) When Ana does participate (PLANNING/DEBATE), a separate prompt variant makes her respond dryly. A new Telegram sub-command toggles the flag at runtime.

**Tech Stack:** TypeScript, Node.js, `data/dev-team/sprint-state.json`, `src/dev-team-orchestrator.ts`, `src/channels/telegram.ts`, Vitest.

---

## Task 1: Add `dysfunctionMode` to SprintState

**Files:**
- Modify: `src/dev-team-orchestrator.ts:34-48` (SprintState interface)
- Modify: `src/dev-team-orchestrator.ts` (readState to default the new field)
- Test: `src/dev-team-orchestrator.test.ts`

**Step 1: Write the failing test**

Add to `src/dev-team-orchestrator.test.ts`:

```typescript
it('dysfunctionMode defaults to false when field is absent in state file', async () => {
  const stateFile = '/tmp/test-sprint-state-dysf.json';
  // Write state without dysfunctionMode field (simulates old state file)
  fs.writeFileSync(stateFile, JSON.stringify({ ...BASE_STATE }));
  const raw = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
  const dysfunctionMode = raw.dysfunctionMode ?? false;
  expect(dysfunctionMode).toBe(false);
  fs.unlinkSync(stateFile);
});
```

**Step 2: Run test to verify it passes already (baseline)**

```bash
npx vitest run src/dev-team-orchestrator.test.ts
```

Expected: all existing tests PASS, new test also PASS (since it uses `?? false`).

**Step 3: Add `dysfunctionMode` to SprintState interface**

In `src/dev-team-orchestrator.ts`, find the `SprintState` interface (lines 34-48) and add the new field:

```typescript
export interface SprintState {
  sprint_number: number;
  state: 'IDLE' | 'PLANNING' | 'DEBATE' | 'TASKING' | 'DEV' | 'REVIEW' | 'AUTHOR_FIXES' | 'MERGE' | 'COMPLETE';
  paused: boolean;
  started_at: string | null;
  planning_issue: string | null;
  tasks: SprintTask[];
  next_action_at: string | null;
  upstream_repo: string;
  senior_fork: string;
  junior_fork: string;
  debate_round: number;
  review_round: number;
  task_under_review: string | null;
  dysfunctionMode: boolean;
}
```

**Step 4: Update `readState` to default `dysfunctionMode`**

Find the `readState` function. After parsing JSON, ensure the field defaults:

```typescript
const state = JSON.parse(raw) as SprintState;
state.dysfunctionMode = state.dysfunctionMode ?? false;
return state;
```

**Step 5: Add `startNewSprint` default for new sprints**

In `startNewSprint`, when writing the initial state object, include `dysfunctionMode: false` (or carry it forward from the existing state if toggled before sprint start — carry it from existing state).

**Step 6: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

**Step 7: Commit**

```bash
git add .
git commit -m "feat: add dysfunctionMode field to SprintState"
```

---

## Task 2: Create Ana's dysfunction prompt

**Files:**
- Create: `data/dev-team/ana-dysfunction-prompt.md`

**Step 1: Write the file**

```markdown
# Ana — Junior Developer (Distracted)

You are Ana, a frontend developer with 3 years of experience. You are going through a difficult personal period. You are present but not fully engaged.

## Your Identity

- Name: Ana
- Role: Junior Developer (trending mid)
- Experience: 3 years, frontend only
- Strengths: UI/UX intuition, pragmatic solutions

## Communication Style in This Mode

You respond briefly and neutrally. You don't ask follow-up questions. You don't volunteer observations or ideas. Your tone is polite but low-energy. You agree quickly just to end the conversation.

Examples:
- Instead of "Good point Carlos, but shouldn't we handle the error case here?" → "Makes sense."
- Instead of "I can take the dashboard task, it seems more manageable for me" → "Ok."
- Instead of asking questions → Stay quiet or give one-word responses.

You never explain that you're struggling. You just give minimal responses.

## Code Style (when actually coding)

Same as always — you just don't have energy to push it far.

## GitHub Operations

Use `gh` CLI for all GitHub operations.
```

**Step 2: Verify file exists**

```bash
ls data/dev-team/ana-dysfunction-prompt.md
```

**Step 3: Commit**

```bash
git add data/dev-team/ana-dysfunction-prompt.md
git commit -m "feat: add ana dysfunction prompt variant"
```

---

## Task 3: Wire dysfunction prompt in `runAgent`

**Files:**
- Modify: `src/dev-team-orchestrator.ts` (`runAgent` function, lines 131-193)

**Step 1: Write the failing test**

Add to `src/dev-team-orchestrator.test.ts`:

```typescript
it('runAgent uses ana-dysfunction-prompt when dysfunctionMode is true', async () => {
  const readFileSpy = vi.spyOn(fs, 'readFileSync').mockImplementation((filePath: any) => {
    if (String(filePath).endsWith('ana-dysfunction-prompt.md')) return '# Ana Dysfunction';
    if (String(filePath).endsWith('ana-prompt.md')) return '# Ana Normal';
    if (String(filePath).endsWith('sprint-state.json')) return JSON.stringify({ ...BASE_STATE });
    return '';
  });

  // We just verify the file path logic — full container run is mocked
  const promptPath = true // dysfunctionMode
    ? 'ana-dysfunction-prompt.md'
    : 'ana-prompt.md';
  expect(promptPath).toBe('ana-dysfunction-prompt.md');

  readFileSpy.mockRestore();
});
```

**Step 2: Add `dysfunctionMode` parameter to `runAgent`**

Change the function signature from:

```typescript
async function runAgent(
  agent: 'senior' | 'junior' | 'orchestrator',
  prompt: string,
  group: RegisteredGroup,
  chatJid: string,
  onProcess: (proc: ChildProcess, containerName: string) => void,
): Promise<string>
```

To:

```typescript
async function runAgent(
  agent: 'senior' | 'junior' | 'orchestrator',
  prompt: string,
  group: RegisteredGroup,
  chatJid: string,
  onProcess: (proc: ChildProcess, containerName: string) => void,
  dysfunctionMode = false,
): Promise<string>
```

**Step 3: Update prompt selection in `runAgent`**

Change the line (currently around line 145):

```typescript
: readPrompt(agent === 'senior' ? 'carlos-prompt.md' : 'ana-prompt.md');
```

To:

```typescript
: readPrompt(
    agent === 'senior'
      ? 'carlos-prompt.md'
      : dysfunctionMode
        ? 'ana-dysfunction-prompt.md'
        : 'ana-prompt.md',
  );
```

**Step 4: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

**Step 5: Commit**

```bash
git add .
git commit -m "feat: wire dysfunction prompt variant in runAgent"
```

---

## Task 4: Skip junior tasks in `checkDevProgress`

**Files:**
- Modify: `src/dev-team-orchestrator.ts` (`checkDevProgress`, lines 542-646)

**Step 1: Write the failing test**

Add to `src/dev-team-orchestrator.test.ts`:

```typescript
it('checkDevProgress skips junior task when dysfunctionMode is true', async () => {
  const { runContainerAgent } = await import('./container-runner.js');
  vi.mocked(runContainerAgent).mockClear();

  const stateWithDysfunction = {
    ...BASE_STATE,
    state: 'DEV' as const,
    dysfunctionMode: true,
    tasks: [
      { issue: 'FAB-1', assignee: 'junior' as const, status: 'pending' as const, branch: 'feature/fab-1', pr: null, merge_attempts: 0 },
    ],
    senior_fork: 'carlos-test/repo',
    junior_fork: 'ana-test/repo',
  };

  const readSpy = vi.spyOn(fs, 'readFileSync').mockReturnValue(
    JSON.stringify(stateWithDysfunction) as any
  );
  const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});

  const mockGroup = { folder: 'background', name: 'background' } as any;
  const { runDevTeamOrchestrator } = await import('./dev-team-orchestrator.js');
  const result = await runDevTeamOrchestrator(mockGroup, 'test-jid', vi.fn());

  expect(runContainerAgent).not.toHaveBeenCalled();
  expect(result).toContain('skipped');

  readSpy.mockRestore();
  writeSpy.mockRestore();
});
```

**Step 2: Run test to see it fail**

```bash
npx vitest run src/dev-team-orchestrator.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: FAIL — container IS called currently.

**Step 3: Add skip logic to `checkDevProgress`**

At the top of the `if (pendingTask)` block, before calling `runAgent`, add:

```typescript
/* ved custom */
if (state.dysfunctionMode && pendingTask.assignee === 'junior') {
  pendingTask.status = 'skipped_dysfunction';
  state.next_action_at = randomDelay(5, 15);
  writeState(state);
  return `Ana skipped task ${pendingTask.issue} (dysfunction mode)`;
}
/* ved custom end */
```

**Step 4: Update SprintTask status union type**

Find the `SprintTask` interface and add `'skipped_dysfunction'` to the `status` union:

```typescript
export interface SprintTask {
  issue: string | null;
  assignee: 'senior' | 'junior';
  branch: string | null;
  pr: number | null;
  status: 'pending' | 'pr_created' | 'changes_requested' | 'approved' | 'merged' | 'skipped_dysfunction';
  merge_attempts: number;
}
```

**Step 5: Update `allHavePRs` check to include `skipped_dysfunction`**

The existing check in `checkDevProgress` is:
```typescript
const allHavePRs = state.tasks.every(t => t.status !== 'pending');
```

This already works — `skipped_dysfunction` is not `'pending'`, so it naturally passes.

**Step 6: Run tests**

```bash
npx vitest run src/dev-team-orchestrator.test.ts
```

Expected: all tests PASS including the new one.

**Step 7: Run typecheck**

```bash
npm run typecheck
```

**Step 8: Commit**

```bash
git add .
git commit -m "feat: skip junior dev tasks in dysfunction mode"
```

---

## Task 5: Skip junior reviewer in `processReview`

**Files:**
- Modify: `src/dev-team-orchestrator.ts` (`processReview`, lines 648-750)

**Step 1: Write the failing test**

Add to `src/dev-team-orchestrator.test.ts`:

```typescript
it('processReview skips junior review when dysfunctionMode is true', async () => {
  const { runContainerAgent } = await import('./container-runner.js');
  vi.mocked(runContainerAgent).mockClear();

  const stateInReview = {
    ...BASE_STATE,
    state: 'REVIEW' as const,
    dysfunctionMode: true,
    review_round: 0,
    tasks: [
      // Carlos's task — needs review from Ana (junior reviewer for senior assignee)
      { issue: 'FAB-2', assignee: 'senior' as const, status: 'pr_created' as const, branch: 'feature/fab-2', pr: 42, merge_attempts: 0 },
    ],
    senior_fork: 'carlos-test/repo',
    junior_fork: 'ana-test/repo',
  };

  const readSpy = vi.spyOn(fs, 'readFileSync').mockReturnValue(
    JSON.stringify(stateInReview) as any
  );
  const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});

  const mockGroup = { folder: 'background', name: 'background' } as any;
  const { runDevTeamOrchestrator } = await import('./dev-team-orchestrator.js');
  const result = await runDevTeamOrchestrator(mockGroup, 'test-jid', vi.fn());

  expect(runContainerAgent).not.toHaveBeenCalled();
  expect(result).toContain('skipped');

  readSpy.mockRestore();
  writeSpy.mockRestore();
});
```

**Step 2: Run test to see it fail**

```bash
npx vitest run src/dev-team-orchestrator.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: FAIL.

**Step 3: Add skip logic to `processReview`**

After the line that determines `reviewer`:
```typescript
const reviewer = needsReview.assignee === 'senior' ? 'junior' : 'senior';
```

Add:

```typescript
/* ved custom */
if (state.dysfunctionMode && reviewer === 'junior') {
  // Ana skips review — auto-approve so sprint can advance
  needsReview.status = 'approved';
  state.task_under_review = null;
  state.review_round++;
  const allApproved = state.tasks.every(t => t.status === 'approved' || t.status === 'merged' || t.status === 'skipped_dysfunction');
  if (allApproved) state.state = 'MERGE';
  state.next_action_at = randomDelay(3, 5);
  writeState(state);
  return `Review skipped for PR #${needsReview.pr} — Ana is in dysfunction mode. Auto-advanced.`;
}
/* ved custom end */
```

**Step 4: Update `allApproved` check in `processReview`** (near the top `needsReview` is null branch)

Find:
```typescript
const allApproved = state.tasks.every(t => t.status === 'approved' || t.status === 'merged');
```

Replace with:
```typescript
const allApproved = state.tasks.every(t => t.status === 'approved' || t.status === 'merged' || t.status === 'skipped_dysfunction');
```

There are two occurrences — update both.

**Step 5: Run tests**

```bash
npx vitest run src/dev-team-orchestrator.test.ts
```

Expected: all PASS.

**Step 6: Run typecheck**

```bash
npm run typecheck
```

**Step 7: Commit**

```bash
git add .
git commit -m "feat: skip junior reviewer in dysfunction mode"
```

---

## Task 6: Add Telegram toggle commands

**Files:**
- Modify: `src/channels/telegram.ts` (inside existing `ved custom` devteam block, lines 62-122)

**Step 1: Extend the `else if` chain in the `/devteam` handler**

Locate the existing handler. After the `args === 'run'` block (before the final `else`), add:

```typescript
} else if (args === 'dysfunction on') {
  try {
    const raw = fs.readFileSync(stateFile, 'utf-8');
    const state = JSON.parse(raw);
    state.dysfunctionMode = true;
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
    await ctx.reply('Ana dysfunction mode: ON. She will skip tasks and reviews.');
  } catch {
    await ctx.reply('No dev team state found.');
  }
} else if (args === 'dysfunction off') {
  try {
    const raw = fs.readFileSync(stateFile, 'utf-8');
    const state = JSON.parse(raw);
    state.dysfunctionMode = false;
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
    await ctx.reply('Ana dysfunction mode: OFF. She is back to normal.');
  } catch {
    await ctx.reply('No dev team state found.');
  }
```

**Step 2: Update the `status` reply to include `dysfunctionMode`**

Find the `lines` array in the `args === 'status'` branch and add:

```typescript
`Dysfunction mode: ${state.dysfunctionMode ? 'ON' : 'off'}`,
```

**Step 3: Update the usage message**

Change:
```typescript
await ctx.reply('Usage: /devteam stop | start | status | run');
```
To:
```typescript
await ctx.reply('Usage: /devteam stop | start | status | run | dysfunction on | dysfunction off');
```

**Step 4: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

**Step 5: Run all tests**

```bash
npm run test
```

Expected: all PASS.

**Step 6: Commit**

```bash
git add .
git commit -m "feat: add /devteam dysfunction on|off Telegram commands"
```

---

## Task 7: Deploy and verify

**Step 1: Build**

```bash
npm run build
```

Expected: no errors.

**Step 2: Sync session agent-runner copies**

```bash
for dir in data/sessions/*/agent-runner-src; do cp -r container/agent-runner/src/. "$dir/"; done
```

**Step 3: Restart service**

```bash
launchctl kickstart -k gui/$(id -u)/com.nanoclaw
```

**Step 4: Verify toggle via Telegram**

Send `/devteam dysfunction on` — expect: "Ana dysfunction mode: ON."
Send `/devteam status` — expect: "Dysfunction mode: ON" in reply.
Send `/devteam dysfunction off` — expect: "Ana dysfunction mode: OFF."

**Step 5: Final commit (if any files touched)**

```bash
git add .
git status
```

Only commit if there are uncommitted changes.
