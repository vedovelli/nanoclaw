# Dev Team Workflow Improvements — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the five workflow failures identified in the AI dev team retrospective — unconditional merge, missing author-fix loop, absent merge gate, and lack of CI/CD + PR checklist in the simulation repo.

**Architecture:** All changes are in `src/dev-team-orchestrator.ts` (our own file — no `ved custom` markers required). The CI/CD and PR template changes happen inside the simulation repo, injected by the orchestrator during the one-time `setupForks` phase.

**Tech Stack:** TypeScript, `gh` CLI (via container agent), GitHub API, Vitest.

**Baseline captured:** Build ✓, 479 tests ✓ (39 files) — `npm run build && npm run test` as of 2026-02-28.

---

## Root Cause Summary

| Problem | Root Cause | Fix |
|---|---|---|
| PRs never merged | `toMerge.status = 'merged'` set unconditionally regardless of `gh pr merge` exit | Task 1 |
| `changes_requested` → approval without fixes | No state that triggers author to push fixes | Task 2 |
| Sprint N+1 starts with unmerged sprint N PRs | `finishSprint` archives without verifying GitHub | Task 3 |
| No CI, no PR template in simulation repo | Setup phase never creates these files | Tasks 4–5 |

---

## Task 0: Fix Orchestrator Identity — PM usa conta `vedovelli`

**Files:**
- Modify: `src/config.ts` — bloco `readEnvFile` + dois novos exports (arquivo upstream, usar `ved custom`)
- Modify: `src/dev-team-orchestrator.ts` — função `runAgent` (arquivo nosso, sem markers)
- Modify: `.env.example` — adicionar as duas novas vars

**Context:** O `runAgent` para o role `orchestrator` usa `DEVTEAM_SENIOR_GITHUB_TOKEN` e `DEVTEAM_SENIOR_GITHUB_USER` — ou seja, age como Carlos no GitHub. Isso faz com que planning issues, task issues e merges apareçam abertos pelo developer senior em vez do PM. A correção introduz `DEVTEAM_PM_GITHUB_TOKEN` e `DEVTEAM_PM_GITHUB_USER` que apontam para a conta `vedovelli`.

**Step 1: Adicionar vars ao `readEnvFile` em `src/config.ts`**

Dentro do bloco `/* ved custom */ ... /* ved custom end */` que já contém as DEVTEAM vars (linhas 14–22), adicionar as duas novas keys:

```typescript
/* ved custom */
  'DEVTEAM_ENABLED',
  'DEVTEAM_FAST_MODE',
  'DEVTEAM_UPSTREAM_REPO',
  'DEVTEAM_PM_GITHUB_TOKEN',    // ← novo
  'DEVTEAM_PM_GITHUB_USER',     // ← novo
  'DEVTEAM_SENIOR_GITHUB_TOKEN',
  'DEVTEAM_SENIOR_GITHUB_USER',
  'DEVTEAM_JUNIOR_GITHUB_TOKEN',
  'DEVTEAM_JUNIOR_GITHUB_USER',
/* ved custom end */
```

**Step 2: Adicionar os dois exports em `src/config.ts`**

Após os exports existentes de `DEVTEAM_UPSTREAM_REPO` (por volta da linha 100), adicionar dentro do bloco `ved custom` já existente:

```typescript
export const DEVTEAM_PM_GITHUB_TOKEN =
  process.env.DEVTEAM_PM_GITHUB_TOKEN || envConfig.DEVTEAM_PM_GITHUB_TOKEN || '';
export const DEVTEAM_PM_GITHUB_USER =
  process.env.DEVTEAM_PM_GITHUB_USER || envConfig.DEVTEAM_PM_GITHUB_USER || '';
```

**Step 3: Importar as novas vars em `src/dev-team-orchestrator.ts`**

Localizar onde `DEVTEAM_SENIOR_GITHUB_TOKEN` é importado de `./config.js` e adicionar as novas vars ao mesmo import:

```typescript
import {
  // ... existentes ...
  DEVTEAM_PM_GITHUB_TOKEN,
  DEVTEAM_PM_GITHUB_USER,
} from './config.js';
```

**Step 4: Corrigir credenciais do orchestrator em `runAgent`**

Substituir:

```typescript
const config = agent === 'orchestrator'
    ? { token: DEVTEAM_SENIOR_GITHUB_TOKEN, user: DEVTEAM_SENIOR_GITHUB_USER }
    : agentConfig(agent);
```

Por:

```typescript
const config = agent === 'orchestrator'
    ? { token: DEVTEAM_PM_GITHUB_TOKEN, user: DEVTEAM_PM_GITHUB_USER }
    : agentConfig(agent);
```

**Step 5: Atualizar `.env.example`**

Adicionar após as vars existentes do devteam:

```
DEVTEAM_PM_GITHUB_TOKEN=     # Token do vedovelli (owner/PM)
DEVTEAM_PM_GITHUB_USER=vedovelli
```

**Step 6: Adicionar ao `.env` local**

```bash
# Editar .env e adicionar:
DEVTEAM_PM_GITHUB_TOKEN=<seu token pessoal do vedovelli>
DEVTEAM_PM_GITHUB_USER=vedovelli
```

**Step 7: Typecheck**

```bash
npm run typecheck
```

**Step 8: Commit**

```bash
git add src/config.ts src/dev-team-orchestrator.ts .env.example
git commit -m "fix: orchestrator uses PM (vedovelli) GitHub credentials instead of senior"
```

---

## Task 1: Fix Merge Verification in `processMerge`

**Files:**
- Modify: `src/dev-team-orchestrator.ts` — function `processMerge` (lines 564–599)

**Context:** Currently, after calling `runAgent('orchestrator', 'gh pr merge ...')`, `toMerge.status = 'merged'` is set unconditionally. If the merge fails (conflict, permissions, branch not up-to-date), the state records the task as merged while the GitHub PR remains open.

**Step 1: Locate the unconditional assignment**

Read the body of `processMerge` in `src/dev-team-orchestrator.ts` lines 564–599. Confirm the line:
```typescript
toMerge.status = 'merged';
```
is not guarded by any conditional.

**Step 2: Replace `processMerge` body**

Replace the entire body with this corrected version (captures the agent result and only sets 'merged' if `MERGED=true` appears in output):

```typescript
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
  const mergeResult = await runAgent('orchestrator', `
Merge PR #${toMerge.pr} on repo ${DEVTEAM_UPSTREAM_REPO}:
  gh pr merge ${toMerge.pr} --repo ${DEVTEAM_UPSTREAM_REPO} --squash --delete-branch

If merge succeeds, output exactly: MERGED=true
If merge fails for any reason (conflict, permissions, not approved), output: MERGED=false
Include the error message on the next line.
`, group, chatJid, onProcess);

  if (!mergeResult.includes('MERGED=true')) {
    logger.warn({ pr: toMerge.pr, result: mergeResult }, 'Merge failed — will retry next tick');
    state.next_action_at = randomDelay(5, 10);
    writeState(state);
    return `Merge of PR #${toMerge.pr} failed. Will retry.`;
  }

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
```

**Step 3: Build and confirm no type errors**

```bash
npm run typecheck
```
Expected: no errors.

**Step 4: Commit**

```bash
git add src/dev-team-orchestrator.ts
git commit -m "fix: verify merge result before marking task as merged"
```

---

## Task 2: Add `AUTHOR_FIXES` State

**Files:**
- Modify: `src/dev-team-orchestrator.ts` — `SprintState` interface, `processReview`, `runDevTeamOrchestrator`, new function `authorFixTask`

**Context:** When `processReview` sets `changes_requested`, the state stays `REVIEW`. On the next tick, the same PR is re-reviewed with increasing approval probability — but the author NEVER pushes fixes. This makes `changes_requested` purely cosmetic.

**Step 1: Add `AUTHOR_FIXES` to `SprintState`**

In the `SprintState` interface (lines 25–38), make two changes:

1. Add `'AUTHOR_FIXES'` to the `state` union:
```typescript
state: 'IDLE' | 'PLANNING' | 'DEBATE' | 'TASKING' | 'DEV' | 'REVIEW' | 'AUTHOR_FIXES' | 'MERGE' | 'COMPLETE';
```

2. Add a new property to track which task needs author fixes:
```typescript
task_under_review: number | null;
```

**Step 2: Update `readState` default object**

Find where the default state is constructed (around line 55–72 — look for `paused: false` and `tasks: []`). Add `task_under_review: null` to keep the state schema consistent:

```typescript
task_under_review: null,
```

**Step 3: Modify `processReview` — transition to `AUTHOR_FIXES` on `changes_requested`**

In `processReview` (lines 483–562), find the block that runs when `!shouldApprove`:

```typescript
if (!shouldApprove) {
    // Author needs to address changes
    state.next_action_at = randomDelay(5, 15);
}
```

Replace it with:

```typescript
if (!shouldApprove) {
  // Author must push fixes before re-review
  state.state = 'AUTHOR_FIXES';
  state.task_under_review = needsReview.issue;
  state.next_action_at = randomDelay(5, 15);
}
```

Also remove the `allApproved` check + `state.state = 'MERGE'` that follows the approve block — it's now only needed on the `shouldApprove` path. Verify the `allApproved` check at the bottom of the function still correctly transitions when all tasks are done.

**Step 4: Create `authorFixTask` function**

Insert this new function before `processMerge` (around line 563):

```typescript
async function authorFixTask(
  state: SprintState,
  group: RegisteredGroup,
  chatJid: string,
  onProcess: (proc: ChildProcess, containerName: string) => void,
): Promise<string> {
  const taskToFix = state.tasks.find(t => t.issue === state.task_under_review);

  if (!taskToFix || !taskToFix.pr) {
    // No matching task — return to review
    state.state = 'REVIEW';
    state.task_under_review = null;
    state.next_action_at = randomDelay(1, 2);
    writeState(state);
    return 'No task to fix. Returning to review.';
  }

  const author = taskToFix.assignee;
  const config = agentConfig(author);

  await runAgent(author, `
PR #${taskToFix.pr} on repo ${DEVTEAM_UPSTREAM_REPO} received a review requesting changes.

Steps:
1. Read the review feedback:
   gh pr reviews ${taskToFix.pr} --repo ${DEVTEAM_UPSTREAM_REPO}
2. Read inline comments:
   gh api repos/${DEVTEAM_UPSTREAM_REPO}/pulls/${taskToFix.pr}/comments
3. cd into your fork working directory for the branch of this PR
4. Address EACH piece of feedback with focused code changes
5. Commit each fix with a descriptive message that references the review concern
6. Push to your fork:
   git push origin HEAD

When all fixes are pushed, output: FIXES_PUSHED=true
`, group, chatJid, onProcess);

  // Reset task status to pr_created so it will be re-reviewed
  taskToFix.status = 'pr_created';
  state.state = 'REVIEW';
  state.task_under_review = null;
  state.next_action_at = randomDelay(5, 15);
  writeState(state);
  return `Author fixes pushed for PR #${taskToFix.pr}. Returning to review.`;
}
```

**Step 5: Add `AUTHOR_FIXES` case to `runDevTeamOrchestrator` switch**

In the `switch (state.state)` block (around line 99), add:

```typescript
case 'AUTHOR_FIXES':
  return await authorFixTask(state, group, chatJid, onProcess);
```

Place it between `case 'REVIEW'` and `case 'MERGE'`.

**Step 6: Build and confirm no type errors**

```bash
npm run typecheck
```
Expected: no errors (TypeScript will enforce `task_under_review` is initialised everywhere `SprintState` is constructed).

**Step 7: Update the existing test's `BASE_STATE` fixture**

In `src/dev-team-orchestrator.test.ts`, find `BASE_STATE` and add `task_under_review: null` to match the new interface. Run tests to confirm no regressions:

```bash
npx vitest run src/dev-team-orchestrator.test.ts
```
Expected: all existing tests pass.

**Step 8: Commit**

```bash
git add src/dev-team-orchestrator.ts src/dev-team-orchestrator.test.ts
git commit -m "feat: add AUTHOR_FIXES state so reviewer changes trigger author to push fixes"
```

---

## Task 3: Merge Gate in `finishSprint`

**Files:**
- Modify: `src/dev-team-orchestrator.ts` — function `finishSprint`

**Context:** `finishSprint` archives the sprint and transitions to `IDLE` unconditionally. Even if `processMerge` recorded all tasks as 'merged' due to the bug fixed in Task 1, any residual state corruption could allow unmerged PRs to be silently archived. This task adds a GitHub-verified safety check.

**Step 1: Replace `finishSprint` body**

Replace the entire body with:

```typescript
async function finishSprint(
  state: SprintState,
  group: RegisteredGroup,
  chatJid: string,
  onProcess: (proc: ChildProcess, containerName: string) => void,
): Promise<string> {
  // Verify all tracked PRs are actually merged on GitHub before archiving
  const prNumbers = state.tasks.map(t => t.pr).filter((pr): pr is number => pr !== null);

  if (prNumbers.length > 0) {
    const verifyResult = await runAgent('orchestrator', `
Verify that ALL of these PRs are merged on repo ${DEVTEAM_UPSTREAM_REPO}:
${prNumbers.map(n => `  PR #${n}`).join('\n')}

For each PR, run:
  gh pr view <number> --repo ${DEVTEAM_UPSTREAM_REPO} --json state,mergedAt

If ALL are merged (state=MERGED), output: ALL_MERGED=true
If ANY are still open, output: ALL_MERGED=false and list the open PR numbers.
`, group, chatJid, onProcess);

    if (!verifyResult.includes('ALL_MERGED=true')) {
      logger.warn({ sprint: state.sprint_number, result: verifyResult }, 'Sprint finish blocked — unmerged PRs detected');
      state.state = 'MERGE';
      state.next_action_at = randomDelay(5, 10);
      writeState(state);
      return `Sprint #${state.sprint_number} finish blocked: unmerged PRs remain. Returning to MERGE.`;
    }
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
  state.task_under_review = null;
  state.next_action_at = randomDelay(20, 40); // 20-40 min break between sprints

  writeState(state);

  return `Sprint #${state.sprint_number} complete. Next sprint in ~30 minutes.`;
}
```

Note: `finishSprint` signature now needs `group`, `chatJid`, `onProcess` parameters (like the other functions). Update the call site in `runDevTeamOrchestrator`:

```typescript
case 'COMPLETE':
  return await finishSprint(state, group, chatJid, onProcess);
```

**Step 2: Build and typecheck**

```bash
npm run typecheck
```
Expected: no errors.

**Step 3: Commit**

```bash
git add src/dev-team-orchestrator.ts
git commit -m "fix: gate sprint archival on GitHub-verified merge status"
```

---

## Task 4: Create PR Template in Simulation Repo via `setupForks`

**Files:**
- Modify: `src/dev-team-orchestrator.ts` — function `setupForks`

**Context:** The simulation repo has no `.github/pull_request_template.md`. Recurring review issues (type safety, error handling, accessibility, mock data) should be a checklist authors verify before opening a PR. The orchestrator (vedovelli account) has write access and can create this file once during setup.

**Step 1: Read the current `setupForks` body**

Find `setupForks` in `src/dev-team-orchestrator.ts`. It currently forks the repo for each agent account. We'll add a second agent call after forks are created.

**Step 2: Add template creation step to `setupForks`**

After the senior and junior fork calls succeed (after parsing fork URLs and before `writeState`), add:

```typescript
// One-time: create PR template and CI workflow in upstream repo if not present
await runAgent('orchestrator', `
Check if .github/pull_request_template.md exists in repo ${DEVTEAM_UPSTREAM_REPO}:
  gh api repos/${DEVTEAM_UPSTREAM_REPO}/contents/.github/pull_request_template.md 2>/dev/null && echo EXISTS || echo MISSING

If MISSING, create it:
  gh api repos/${DEVTEAM_UPSTREAM_REPO}/contents/.github/pull_request_template.md \
    --method PUT \
    --field message="chore: add PR template with quality checklist" \
    --field content="$(echo '## Summary

<!-- One paragraph describing what this PR does and why. -->

## Checklist

- [ ] No TypeScript `any` types introduced
- [ ] Error handling is specific (not bare `catch (e) {}`)
- [ ] Loading, empty, and error states are handled in UI components
- [ ] No hardcoded values that belong in constants or config
- [ ] Accessibility: interactive elements have labels, keyboard navigation works
- [ ] Mock data uses realistic values (not "test", "foo", "lorem ipsum")
- [ ] Component is responsive on mobile viewport

## Test plan

<!-- Steps to verify the feature works end-to-end. -->
' | base64)"

Output: TEMPLATE_DONE=true
`, group, chatJid, onProcess);
```

**Step 3: Build and typecheck**

```bash
npm run typecheck
```

**Step 4: Commit**

```bash
git add src/dev-team-orchestrator.ts
git commit -m "feat: create PR template in simulation repo during setup"
```

---

## Task 5: Create CI Workflow in Simulation Repo via `setupForks`

**Files:**
- Modify: `src/dev-team-orchestrator.ts` — function `setupForks` (continuation of Task 4)

**Context:** No automated CI means type errors, unused imports, and lint issues only get caught in manual code review. Adding a minimal GitHub Actions workflow (TypeScript type-check + ESLint) enforces quality before review.

**Step 1: Add CI workflow creation step to `setupForks`**

Immediately after the PR template creation call from Task 4, add:

```typescript
await runAgent('orchestrator', `
Check if .github/workflows/ci.yml exists in repo ${DEVTEAM_UPSTREAM_REPO}:
  gh api repos/${DEVTEAM_UPSTREAM_REPO}/contents/.github/workflows/ci.yml 2>/dev/null && echo EXISTS || echo MISSING

If MISSING, create it:
  gh api repos/${DEVTEAM_UPSTREAM_REPO}/contents/.github/workflows/ci.yml \
    --method PUT \
    --field message="chore: add CI workflow (typecheck + lint)" \
    --field content="$(echo 'name: CI

on:
  pull_request:
    branches: [master]

jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npx tsc --noEmit
      - run: npx eslint src --ext .ts,.tsx --max-warnings 0
' | base64)"

Output: CI_DONE=true
`, group, chatJid, onProcess);
```

**Step 2: Build and typecheck**

```bash
npm run typecheck
```

**Step 3: Commit**

```bash
git add src/dev-team-orchestrator.ts
git commit -m "feat: create CI workflow in simulation repo during setup"
```

---

## Task 6: Full Build + Test Verification

**Step 1: Run full build and test suite**

```bash
npm run build && npm run test
```

Expected:
- Build: ✓ (same as baseline)
- Tests: 479 passed, 39 files (same as baseline — no new failures)

**Step 2: Verify `AUTHOR_FIXES` is handled in all state consumers**

Check that nothing hard-codes the list of valid states:

```bash
grep -n "AUTHOR_FIXES\|IDLE\|PLANNING\|DEBATE\|TASKING\|DEV\|REVIEW\|MERGE\|COMPLETE" src/dev-team-orchestrator.ts
```

Confirm `AUTHOR_FIXES` appears in: the interface union, the switch statement, and `authorFixTask`.

**Step 3: Commit (if any fix-up needed)**

```bash
git add src/dev-team-orchestrator.ts src/dev-team-orchestrator.test.ts
git commit -m "chore: final cleanup after devteam workflow improvements"
```

---

## Task 7: Update Customization Tracker

Update the Basic Memory Cloud tracker note (project: `nanoclaw`, identifier: `nanoclaw/nano-claw-custom-modifications-tracker`) by appending a new section:

```markdown
### 15i. Fix + Feat: Dev Team Workflow Improvements

- **PR:** `feat/devteam-workflow-improvements`
- **What:** Five changes to improve sprint reliability:
  1. `processMerge` — parse `MERGED=true` from agent output; retry instead of silently recording fake merge
  2. `AUTHOR_FIXES` state — when reviewer requests changes, author is prompted to push fixes before re-review
  3. `finishSprint` — verify all PRs are actually merged on GitHub before archiving; return to MERGE if not
  4. `setupForks` — one-time creation of `.github/pull_request_template.md` in simulation repo
  5. `setupForks` — one-time creation of `.github/workflows/ci.yml` (typecheck + ESLint) in simulation repo
- **Files changed:**
  - `src/dev-team-orchestrator.ts` — **MODIFIED** — all 5 changes; our own file (no `ved custom` markers required)
- **Re-apply difficulty:** Low — all changes are within our own file. If upstream ever ships a `dev-team-orchestrator.ts`, a conflict would need manual resolution, but the file is local-only.
```

---

---

## Task 8: Clean Slate — Close All Issues and PRs, Reset Sprint State

**Context:** After 5 sprints, the simulation repo has 13 open PRs and 17+ open issues accumulated without any merges. Rather than trying to reconcile this diverged state, we wipe the GitHub history clean and reset the sprint state machine to zero so the improved workflow runs from the start.

**Step 1: Close all open PRs in the simulation repo**

Run as a single CLI command (orchestrator account has write access):

```bash
gh pr list --repo vedovelli/ai-dev-team-simulation --state open --json number --jq '.[].number' | \
  xargs -I{} gh pr close {} --repo vedovelli/ai-dev-team-simulation --comment "Closing as part of clean-slate reset — reimplementing with improved workflow."
```

Expected: all 13 PRs closed. Verify:

```bash
gh pr list --repo vedovelli/ai-dev-team-simulation --state open
```
Expected: empty list.

**Step 2: Close all open issues in the simulation repo**

```bash
gh issue list --repo vedovelli/ai-dev-team-simulation --state open --json number --jq '.[].number' | \
  xargs -I{} gh issue close {} --repo vedovelli/ai-dev-team-simulation --comment "Closing as part of clean-slate reset."
```

Verify:

```bash
gh issue list --repo vedovelli/ai-dev-team-simulation --state open
```
Expected: empty list.

**Step 3: Reset sprint state to zero**

Overwrite `data/dev-team/sprint-state.json` with a clean initial state. Read the current file first to confirm the structure, then reset:

```bash
cat data/dev-team/sprint-state.json
```

Write the reset state (preserve `upstream_repo`, `senior_fork`, `junior_fork` — the forks still exist and are valid):

```json
{
  "sprint_number": 0,
  "state": "IDLE",
  "paused": false,
  "started_at": null,
  "planning_issue": null,
  "tasks": [],
  "next_action_at": null,
  "upstream_repo": "<current value>",
  "senior_fork": "<current value>",
  "junior_fork": "<current value>",
  "debate_round": 0,
  "review_round": 0,
  "task_under_review": null
}
```

The `setupForks` guard checks `!state.senior_fork || !state.junior_fork`, so the forks won't be re-created. Sprint 1 will start immediately on the next tick.

**Step 4: Archive sprint history**

The existing sprint history files in `data/dev-team/sprint-history/` should be kept — they're a record of the experiment. No deletion needed.

**Step 5: Verify service picks up new state**

Trigger the orchestrator manually via Telegram:

```
/devteam status
```

Expected: `Sprint: #0, State: IDLE` (or similar).

Then kick off the first sprint:

```
/devteam run
```

Expected: orchestrator starts Sprint #1 with the new workflow active.

---

## Plan Complete

**Execution options:**

**1. Subagent-Driven (this session)** — dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** — open new session with executing-plans, batch execution with checkpoints

Which approach?
