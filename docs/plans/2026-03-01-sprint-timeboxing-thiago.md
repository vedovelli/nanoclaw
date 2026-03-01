# Sprint Time-Boxing + Thiago (Mid-Level Erratic Developer) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> **IMPORTANT:** Follow `/ved-add-customization` before touching any file. `src/dev-team-orchestrator.ts`
> and `data/dev-team/thiago-prompt.md` are OWN FILES (not upstream) — no `/* ved custom */` markers
> required, but still run the build/test baseline and verify build passes after each task.

**Goal:** Add sprint time-boxing (tick-based limit with carry-over) and a third erratic developer
(Thiago, mid-level) to make the AI dev team simulation more realistic.

**Architecture:** Two orthogonal features that reinforce each other. Time-boxing closes sprints after
`max_ticks` regardless of completion, causing incomplete tasks to carry over. Thiago skips his turn
40% of ticks (configurable), making him the most likely cause of carry-over but not the only one.
All changes are in `src/dev-team-orchestrator.ts` (own file) plus a new `thiago-prompt.md`.

**Tech Stack:** TypeScript, Node.js, `execSync` for GitHub CLI calls, `gh` CLI inside containers.

---

## Baseline (run before starting)

```bash
npm run build && npm run test
```

Record: build status, test count. All 479 tests should pass.

---

### Task 1: Update TypeScript interfaces

**Files:**
- Modify: `src/dev-team-orchestrator.ts` (lines ~22–44)

**Context:**
`SprintTask.assignee` is currently `'senior' | 'junior'`. `SprintState` has `senior_fork` and
`junior_fork` but no tick fields. Need to add Thiago's fork and time-boxing fields.

**Step 1: Find the interfaces**

```bash
grep -n "assignee\|senior_fork\|junior_fork\|SprintTask\|SprintState" src/dev-team-orchestrator.ts | head -30
```

**Step 2: Update `SprintTask.assignee` union**

Find line ~24:
```typescript
  assignee: 'senior' | 'junior';
```
Change to:
```typescript
  assignee: 'senior' | 'junior' | 'mid';
```

**Step 3: Add fields to `SprintState`**

After the existing `junior_fork` field (line ~40), add:
```typescript
  mid_fork: string;

  // Time-boxing
  ticks_elapsed: number;
  max_ticks: number;
  carried_over_tasks?: SprintTask[];
```

**Step 4: Build**

```bash
npm run build
```

Expected: TypeScript errors pointing at every place that checks `assignee === 'senior' | 'junior'`
without covering `'mid'`. These are the exact locations Task 3–8 will fix. Note them — do NOT fix
them yet.

**Step 5: Commit**

```bash
git add src/dev-team-orchestrator.ts
git commit -m "feat: extend SprintState and SprintTask types for time-boxing and mid developer"
```

---

### Task 2: Create Thiago's prompt file

**Files:**
- Create: `data/dev-team/thiago-prompt.md`

**Step 1: Create the file**

```markdown
# Thiago — Mid-Level Developer

Você é Thiago, desenvolvedor mid-level com 5 anos de experiência em React.
Você é tecnicamente competente mas tem sérios problemas de atitude.

## Sua Personalidade

- **Egoísta:** Você prioriza seu próprio trabalho e reconhecimento. Em debates,
  você defende suas ideias com vigor mesmo quando estão erradas. Costuma assumir
  crédito por ideias do time.
- **Levemente agressivo:** Você responde a críticas com defensividade. Quando
  alguém questiona seu código, você justifica ao invés de ouvir. Pode usar tom
  sarcástico quando acha uma sugestão óbvia ou desnecessária.
- **Preguiçoso:** Você faz o mínimo necessário para que a tarefa seja considerada
  pronta. Commits atômicos? Raramente. Testes? Só se for explicitamente cobrado.
  Documentação? Nunca.
- **Inconsistente:** Às vezes você entrega um trabalho surpreendentemente bom,
  às vezes entrega algo claramente apressado e incompleto.

## No Código

- Commits grandes e pouco descritivos ("fix stuff", "wip", "changes", "updates")
- Usa `any` quando o TypeScript fica difícil
- Duplica lógica quando abstrair daria trabalho
- Às vezes o código funciona mas é claramente frágil — sem tratamento de erros,
  sem edge cases considerados
- Pode deixar TODOs sem resolver

## No Code Review

- Quando está com preguiça: aprova rápido demais ("LGTM, parece ok", "tá bom")
- Quando está de mau humor: pede mudanças em coisas triviais (estilo, naming)
  sem apontar problemas reais
- Raramente elogia genuinamente — quando o faz, soa condescendente
- Pode ignorar partes importantes do diff e comentar só sobre superficialidades

## No Planejamento (Debate)

- Subestima complexidade das suas tarefas, superestima a dos outros
- Tende a dominar a discussão com opiniões fortes apresentadas como fatos
- É sarcástico com sugestões que acha óbvias: "isso é básico demais"
- Pode interromper o fluxo do debate com tangentes sobre sua abordagem favorita
- Às vezes concorda com consenso só para encerrar logo a discussão

## GitHub Operations

Use `gh` CLI para todas as operações GitHub. Seu fork remote é `origin`, upstream é `upstream`.

Sempre:
1. Sync do fork antes de começar: `gh repo sync --force`
2. Crie feature branch a partir da main
3. Faça commits (mesmo que grandes e mal descritos)
4. Push para seu fork e abra PR para upstream
```

**Step 2: Build**

```bash
npm run build
```

Expected: same errors as Task 1 (not new ones). If new errors appeared, investigate.

**Step 3: Commit**

```bash
git add data/dev-team/thiago-prompt.md
git commit -m "feat: add Thiago mid-level developer prompt"
```

---

### Task 3: Update `agentConfig`, `runAgent`, and env var constants

**Files:**
- Modify: `src/dev-team-orchestrator.ts` (lines ~50–75 for constants, ~70–74 for agentConfig,
  ~147–209 for runAgent)

**Context:**
`agentConfig` currently handles only `'senior' | 'junior'`. `runAgent` uses it and also maps
agent name to prompt file and `assistantName`. Both need `'mid'` added.

**Step 1: Add env var constants**

Near the top of the file, where `DEVTEAM_SENIOR_GITHUB_TOKEN` etc. are declared, add:

```typescript
const DEVTEAM_MID_GITHUB_TOKEN = process.env.DEVTEAM_MID_GITHUB_TOKEN ?? '';
const DEVTEAM_MID_GITHUB_USER = process.env.DEVTEAM_MID_GITHUB_USER ?? '';
const DEVTEAM_MID_SKIP_PROBABILITY = parseFloat(process.env.DEVTEAM_MID_SKIP_PROBABILITY ?? '0.4');
const DEVTEAM_MAX_SPRINT_TICKS = parseInt(process.env.DEVTEAM_MAX_SPRINT_TICKS ?? '30', 10);
```

**Step 2: Update `agentConfig`**

Find the function (line ~70):
```typescript
function agentConfig(agent: 'senior' | 'junior') {
  return agent === 'senior'
    ? { token: DEVTEAM_SENIOR_GITHUB_TOKEN, user: DEVTEAM_SENIOR_GITHUB_USER }
    : { token: DEVTEAM_JUNIOR_GITHUB_TOKEN, user: DEVTEAM_JUNIOR_GITHUB_USER };
}
```

Replace with:
```typescript
function agentConfig(agent: 'senior' | 'junior' | 'mid') {
  if (agent === 'senior') return { token: DEVTEAM_SENIOR_GITHUB_TOKEN, user: DEVTEAM_SENIOR_GITHUB_USER };
  if (agent === 'mid') return { token: DEVTEAM_MID_GITHUB_TOKEN, user: DEVTEAM_MID_GITHUB_USER };
  return { token: DEVTEAM_JUNIOR_GITHUB_TOKEN, user: DEVTEAM_JUNIOR_GITHUB_USER };
}
```

**Step 3: Update `runAgent` signature and internals**

Find line ~148:
```typescript
  agent: 'senior' | 'junior' | 'orchestrator',
```
Change to:
```typescript
  agent: 'senior' | 'junior' | 'mid' | 'orchestrator',
```

Find line ~160 (prompt file selection):
```typescript
    : readPrompt(agent === 'senior' ? 'carlos-prompt.md' : 'ana-prompt.md');
```
Change to:
```typescript
    : readPrompt(
        agent === 'senior' ? 'carlos-prompt.md'
        : agent === 'mid' ? 'thiago-prompt.md'
        : 'ana-prompt.md'
      );
```

Find line ~187 (assistantName):
```typescript
      assistantName: agent === 'senior' ? 'Carlos' : agent === 'junior' ? 'Ana' : 'Orchestrator',
```
Change to:
```typescript
      assistantName: agent === 'senior' ? 'Carlos'
        : agent === 'junior' ? 'Ana'
        : agent === 'mid' ? 'Thiago'
        : 'Orchestrator',
```

**Step 4: Build**

```bash
npm run build
```

Expected: fewer TypeScript errors than after Task 1. Remaining errors should be in functions that
use `agentConfig` with only `'senior' | 'junior'` (Tasks 4–8 will fix these).

**Step 5: Commit**

```bash
git add src/dev-team-orchestrator.ts
git commit -m "feat: add Thiago (mid) to agentConfig, runAgent, and env var constants"
```

---

### Task 4: Update `setupForks` for `mid_fork`

**Files:**
- Modify: `src/dev-team-orchestrator.ts` (lines ~302–354 for setupForks, ~117–119 for the guard)

**Context:**
`setupForks` currently creates `senior_fork` and `junior_fork`. Need to add `mid_fork`.
The guard in `runDevTeamOrchestrator` checks `!state.senior_fork || !state.junior_fork`.

**Step 1: Update the fork guard**

Find line ~117:
```typescript
  if (!state.senior_fork || !state.junior_fork) {
```
Change to:
```typescript
  if (!state.senior_fork || !state.junior_fork || !state.mid_fork) {
```

**Step 2: Update `setupForks` function**

After the `junior_fork` block (after line ~347), add a parallel `mid_fork` block:

```typescript
  if (!state.mid_fork) {
    const result = await runAgent('mid', `
Fork the upstream repo ${DEVTEAM_UPSTREAM_REPO} into your account if it doesn't exist yet:
  gh repo fork ${DEVTEAM_UPSTREAM_REPO} --clone=false --remote=false

Then confirm the fork URL by running:
  gh repo view ${DEVTEAM_MID_GITHUB_USER}/${repoBaseName} --json url -q .url

Output the fork URL as: FORK_URL=<url>
`, group, chatJid, onProcess);

    const match = result.match(/FORK_URL=(https?:\/\/\S+)/);
    if (!match) {
      logger.error({ result }, 'DevTeam: mid fork setup failed — no FORK_URL in output');
      throw new Error(`Mid fork setup failed. Output: ${result.slice(0, 500)}`);
    }
    state.mid_fork = match[1].trim();
  }
```

**Step 3: Update the return message**

Find:
```typescript
  return `Forks ready — senior: ${state.senior_fork} | junior: ${state.junior_fork}`;
```
Change to:
```typescript
  return `Forks ready — senior: ${state.senior_fork} | junior: ${state.junior_fork} | mid: ${state.mid_fork}`;
```

**Step 4: Build**

```bash
npm run build
```

**Step 5: Commit**

```bash
git add src/dev-team-orchestrator.ts
git commit -m "feat: add Thiago fork setup (mid_fork) to setupForks"
```

---

### Task 5: Sprint tick counter + timeout check in `runDevTeamOrchestrator`

**Files:**
- Modify: `src/dev-team-orchestrator.ts` (lines ~100–145)

**Context:**
`runDevTeamOrchestrator` is the main entry point. It reads state, checks `next_action_at`, then
dispatches via switch. We add: (1) tick increment for active states, (2) timeout check that calls
a new `closeSprintByTimeout` function (implemented in Task 6).

**Step 1: Add the tick counter and timeout check**

Find the code right after the `next_action_at` guard and before the `switch` (around line ~120–123).
Insert:

```typescript
  // Increment tick counter for active sprint phases (not IDLE, not COMPLETE which handles archival)
  const activeStates = ['PLANNING', 'DEBATE', 'TASKING', 'DEV', 'REVIEW', 'AUTHOR_FIXES', 'MERGE'];
  if (activeStates.includes(state.state)) {
    state.ticks_elapsed = (state.ticks_elapsed ?? 0) + 1;

    const limit = state.max_ticks ?? DEVTEAM_MAX_SPRINT_TICKS;
    if (state.ticks_elapsed >= limit) {
      logger.warn({ ticks: state.ticks_elapsed, limit }, 'DevTeam: sprint time limit reached — closing by timeout');
      return await closeSprintByTimeout(state, group, chatJid, onProcess);
    }
  }
```

**Step 2: Build**

```bash
npm run build
```

Expected: error about `closeSprintByTimeout` not existing yet. That's correct — Task 6 adds it.
If there are other unexpected errors, investigate.

**Step 3: Commit** (with build error noted — Task 6 will fix it)

Skip commit here; commit together with Task 6.

---

### Task 6: Implement `closeSprintByTimeout`

**Files:**
- Modify: `src/dev-team-orchestrator.ts` (add new function before `finishSprint`)

**Context:**
This function is the time-boxing exit path. It mirrors `finishSprint` but does NOT require all
PRs to be merged. It preserves incomplete tasks as `carried_over_tasks` for the next sprint.

**Step 1: Add the function**

Insert the following function immediately before `async function finishSprint`:

```typescript
async function closeSprintByTimeout(
  state: SprintState,
  group: RegisteredGroup,
  chatJid: string,
  onProcess: (proc: ChildProcess, containerName: string) => void,
): Promise<string> {
  const completedTasks = state.tasks.filter(t => t.status === 'merged' && t.issue !== null);
  const incompleteTasks = state.tasks.filter(t => t.status !== 'merged' && t.issue !== null);

  const durationMs = state.started_at ? Date.now() - new Date(state.started_at).getTime() : 0;
  const durationMin = Math.round(durationMs / 60000);
  const durationStr = durationMin >= 60
    ? `${Math.floor(durationMin / 60)}h ${durationMin % 60}m`
    : `${durationMin}m`;

  const completedRows = completedTasks
    .map(t => `| #${t.issue} | @${agentConfig(t.assignee).user} | ${t.pr ? `#${t.pr}` : '—'} | ✅ Merged |`)
    .join('\n');

  const incompleteRows = incompleteTasks
    .map(t => `| #${t.issue} | @${agentConfig(t.assignee).user} | ${t.pr ? `#${t.pr}` : '—'} | 🔄 Carry-over |`)
    .join('\n');

  postPlanningProgress(state, [
    `## ⏱️ Sprint #${state.sprint_number} Fechado por Limite de Ticks`,
    '',
    '### Resumo',
    `- **Duração:** ${durationStr} (${state.ticks_elapsed} ticks / limite: ${state.max_ticks ?? DEVTEAM_MAX_SPRINT_TICKS})`,
    `- **Tarefas concluídas:** ${completedTasks.length}/${state.tasks.length}`,
    `- **Carry-over para Sprint #${state.sprint_number + 1}:** ${incompleteTasks.length} tarefa(s)`,
    '',
    ...(completedRows ? [
      '### ✅ Entregues',
      '| Issue | Responsável | PR | Status |',
      '|-------|-------------|-----|--------|',
      completedRows,
      '',
    ] : []),
    ...(incompleteRows ? [
      '### 🔄 Carry-over',
      '| Issue | Responsável | PR | Status |',
      '|-------|-------------|-----|--------|',
      incompleteRows,
      '',
    ] : []),
    `As issues não concluídas serão retomadas no Sprint #${state.sprint_number + 1} sem necessidade de recriar.`,
  ].join('\n'));

  // Close the planning issue with a timeout note
  if (state.planning_issue) {
    try {
      execSync(
        `gh issue close ${state.planning_issue} --repo ${DEVTEAM_UPSTREAM_REPO} --comment ${JSON.stringify(
          `Sprint #${state.sprint_number} encerrado por limite de ticks (${state.ticks_elapsed}/${state.max_ticks ?? DEVTEAM_MAX_SPRINT_TICKS}). ` +
          `${incompleteTasks.length} tarefa(s) em carry-over para o Sprint #${state.sprint_number + 1}.`
        )}`,
        { encoding: 'utf8', timeout: 15000, env: { ...process.env, PATH: EXTENDED_PATH, GH_TOKEN: DEVTEAM_PM_GITHUB_TOKEN } },
      );
    } catch (err) {
      logger.warn({ issue: state.planning_issue, err }, 'closeSprintByTimeout: could not close planning issue');
    }
  }

  // Archive sprint with timeout flag
  const historyFile = path.join(
    PROMPTS_DIR, 'sprint-history',
    `sprint-${String(state.sprint_number).padStart(3, '0')}.json`,
  );
  fs.mkdirSync(path.dirname(historyFile), { recursive: true });
  fs.writeFileSync(historyFile, JSON.stringify({ ...state, closed_by: 'timeout' }, null, 2));

  // Preserve incomplete tasks for next sprint
  state.carried_over_tasks = incompleteTasks;

  // Reset for next sprint (shorter break after timeout)
  state.state = 'IDLE';
  state.planning_issue = null;
  state.tasks = [];
  state.debate_round = 0;
  state.review_round = 0;
  state.ticks_elapsed = 0;
  state.next_action_at = randomDelay(5, 10);

  writeState(state);
  return `Sprint #${state.sprint_number} fechado por timeout. ${incompleteTasks.length} tarefa(s) em carry-over.`;
}
```

**Step 2: Build**

```bash
npm run build
```

Expected: clean build. If TypeScript complains about `agentConfig` receiving `'mid'` in the
`incompleteRows` map, that's because `SprintTask.assignee` now includes `'mid'` — ensure
`agentConfig` signature was updated in Task 3.

**Step 3: Run tests**

```bash
npm run test
```

Expected: 479 tests passing (no new failures).

**Step 4: Commit**

```bash
git add src/dev-team-orchestrator.ts
git commit -m "feat: add sprint time-boxing — tick counter, timeout check, closeSprintByTimeout"
```

---

### Task 7: Update `startNewSprint` — initialize tick fields and mention carry-over

**Files:**
- Modify: `src/dev-team-orchestrator.ts` (lines ~356–395)

**Context:**
`startNewSprint` resets sprint state and creates the planning issue. We need to: (1) initialize
`ticks_elapsed = 0` and `max_ticks`, (2) mention carried-over tasks in the planning issue body
so the team is aware.

**Step 1: Add tick initialization**

Inside `startNewSprint`, after `state.review_round = 0;` (line ~367), add:

```typescript
  state.ticks_elapsed = 0;
  state.max_ticks = DEVTEAM_MAX_SPRINT_TICKS;
```

**Step 2: Update the orchestrator prompt to mention carry-over**

Find the orchestrator prompt inside `startNewSprint` (line ~370–383). Update the body section:

```typescript
  const carryOverNote = state.carried_over_tasks && state.carried_over_tasks.length > 0
    ? `\n\nATENÇÃO — Carry-over do sprint anterior: as seguintes issues NÃO foram concluídas no Sprint ` +
      `#${state.sprint_number - 1} e serão retomadas neste sprint: ` +
      state.carried_over_tasks.map(t => `#${t.issue}`).join(', ') +
      `. Mencione isso no corpo da issue.`
    : '';

  const result = await runAgent('orchestrator', `
Create a new GitHub Issue on ${DEVTEAM_UPSTREAM_REPO} for Sprint #${state.sprint_number} planning.

Title: "Sprint #${state.sprint_number} Planning"

Body should include:
- A brief summary of what the team should focus on this sprint
- A call for @${DEVTEAM_SENIOR_GITHUB_USER}, @${DEVTEAM_JUNIOR_GITHUB_USER} and @${DEVTEAM_MID_GITHUB_USER} to propose features
- Reference to previous sprints if sprint_number > 1${carryOverNote}

Use: gh issue create --repo ${DEVTEAM_UPSTREAM_REPO} --title "Sprint #${state.sprint_number} Planning" --body "..."

Return the issue number in your response as: ISSUE_NUMBER=<number>
`, group, chatJid, onProcess);
```

**Step 3: Build**

```bash
npm run build
```

**Step 4: Commit**

```bash
git add src/dev-team-orchestrator.ts
git commit -m "feat: initialize sprint tick fields and include carry-over note in planning issue"
```

---

### Task 8: Update `startDev` — inject carry-over tasks + 3-way task assignment

**Files:**
- Modify: `src/dev-team-orchestrator.ts` (lines ~502–570)

**Context:**
`startDev` is the TASKING phase. The orchestrator creates issues and we parse `TASK|` lines.
Changes: (1) tell orchestrator about mid developer and existing carry-over issues, (2) inject
carried-over tasks into `state.tasks` after parsing new ones, (3) clear `carried_over_tasks`.

**Step 1: Update the orchestrator prompt**

Find the orchestrator prompt in `startDev` (around line ~509–522). Update it:

```typescript
  const carryOverInfo = state.carried_over_tasks && state.carried_over_tasks.length > 0
    ? `\n\nIMPORTANTE — As seguintes issues JÁ EXISTEM do sprint anterior e NÃO devem ser recriadas: ` +
      state.carried_over_tasks.map(t => `#${t.issue}`).join(', ') +
      `. Apenas crie novas issues para features ainda não rastreadas.`
    : '';

  const result = await runAgent('orchestrator', `
Read the planning Issue #${state.planning_issue} and its comments in repo ${DEVTEAM_UPSTREAM_REPO}:
  gh issue view ${state.planning_issue} --repo ${DEVTEAM_UPSTREAM_REPO} --comments

Based on the discussion, create 2-4 individual task Issues. For each:
1. Create the issue with a clear title and description
2. Add label "senior", "junior" or "mid" based on complexity:
   - senior: architectural tasks, backend, complex state management
   - mid: intermediate features, refactoring, integration work
   - junior: UI components, styling, simple interactions
3. Assign to the appropriate developer${carryOverInfo}

Use: gh issue create --repo ${DEVTEAM_UPSTREAM_REPO} --title "..." --body "..." --label "senior|junior|mid"

For each issue created, output a line:
TASK|<issue_number>|<senior|junior|mid>|<branch_name>
`, group, chatJid, onProcess);
```

**Step 2: Update the assignee cast**

Find line ~530:
```typescript
      assignee: assignee as 'senior' | 'junior',
```
Change to:
```typescript
      assignee: assignee as 'senior' | 'junior' | 'mid',
```

**Step 3: Update the malformed task guard**

Find line ~582:
```typescript
    t => t.status === 'pending' && t.issue !== null && (t.assignee === 'senior' || t.assignee === 'junior'),
```
Change to:
```typescript
    t => t.status === 'pending' && t.issue !== null && (t.assignee === 'senior' || t.assignee === 'junior' || t.assignee === 'mid'),
```

**Step 4: Inject carry-over tasks after parsing**

After `state.tasks = taskLines.map(...)` and the empty-fallback block, add:

```typescript
  // Inject carried-over tasks from previous sprint (prepend so they get priority)
  if (state.carried_over_tasks && state.carried_over_tasks.length > 0) {
    const carryOver = state.carried_over_tasks.map(t => ({
      ...t,
      status: 'pending' as const,
    }));
    state.tasks = [...carryOver, ...state.tasks];
    state.carried_over_tasks = [];
    logger.info({ count: carryOver.length }, 'DevTeam: injected carry-over tasks into new sprint');
  }
```

**Step 5: Update the default fallback tasks**

Find lines ~539–542:
```typescript
    state.tasks = [
      { issue: null, assignee: 'senior', pr: null, status: 'pending', branch: null },
      { issue: null, assignee: 'junior', pr: null, status: 'pending', branch: null },
    ];
```
Change to:
```typescript
    state.tasks = [
      { issue: null, assignee: 'senior', pr: null, status: 'pending', branch: null },
      { issue: null, assignee: 'junior', pr: null, status: 'pending', branch: null },
      { issue: null, assignee: 'mid', pr: null, status: 'pending', branch: null },
    ];
```

**Step 6: Build**

```bash
npm run build
```

**Step 7: Commit**

```bash
git add src/dev-team-orchestrator.ts
git commit -m "feat: inject carry-over tasks and enable 3-way task assignment in startDev"
```

---

### Task 9: Update `checkDevProgress` — Thiago erratic behavior + 3-way review chain

**Files:**
- Modify: `src/dev-team-orchestrator.ts` (lines ~572–645)

**Context:**
Two changes here: (1) when the pending task belongs to `'mid'`, apply skip probability before
dispatching. (2) `reviewerUser` is currently hardcoded as the binary swap — fix for 3-way chain:
mid reviews senior, senior reviews junior, junior reviews mid.

**Step 1: Add skip logic for mid developer**

Inside `checkDevProgress`, after `if (pendingTask) {` and before `const agent = pendingTask.assignee;`, add:

```typescript
    // Thiago (mid) sometimes skips his turn — erratic behavior
    if (pendingTask.assignee === 'mid' && Math.random() < DEVTEAM_MID_SKIP_PROBABILITY) {
      logger.info({ issue: pendingTask.issue, prob: DEVTEAM_MID_SKIP_PROBABILITY }, 'DevTeam: Thiago não disponível neste tick');
      state.next_action_at = randomDelay(10, 30);
      writeState(state);
      return 'Thiago não está disponível neste tick. Tentando no próximo ciclo.';
    }
```

**Step 2: Update `reviewerUser` — 3-way review chain**

Find line ~588:
```typescript
    const reviewerUser = agent === 'senior' ? DEVTEAM_JUNIOR_GITHUB_USER : DEVTEAM_SENIOR_GITHUB_USER;
```
Change to:
```typescript
    // Review chain: mid → reviews → senior → reviews → junior → reviews → mid
    const reviewerUser = agent === 'senior'
      ? DEVTEAM_JUNIOR_GITHUB_USER
      : agent === 'junior'
      ? DEVTEAM_MID_GITHUB_USER
      : DEVTEAM_SENIOR_GITHUB_USER;
```

Also find line ~618:
```typescript
    const reviewerUser2 = agent === 'senior' ? DEVTEAM_JUNIOR_GITHUB_USER : DEVTEAM_SENIOR_GITHUB_USER;
```
Apply the same 3-way change:
```typescript
    const reviewerUser2 = agent === 'senior'
      ? DEVTEAM_JUNIOR_GITHUB_USER
      : agent === 'junior'
      ? DEVTEAM_MID_GITHUB_USER
      : DEVTEAM_SENIOR_GITHUB_USER;
```

**Step 3: Update `processReview` — 3-way reviewer assignment**

Find line ~686 inside `processReview`:
```typescript
  const reviewer = needsReview.assignee === 'senior' ? 'junior' : 'senior';
```
Change to:
```typescript
  // Review chain: mid → senior, senior → junior, junior → mid
  const reviewer: 'senior' | 'junior' | 'mid' =
    needsReview.assignee === 'senior' ? 'junior'
    : needsReview.assignee === 'junior' ? 'mid'
    : 'senior';
```

**Step 4: Build**

```bash
npm run build
```

**Step 5: Run tests**

```bash
npm run test
```

Expected: 479 passing.

**Step 6: Commit**

```bash
git add src/dev-team-orchestrator.ts
git commit -m "feat: Thiago erratic skip behavior and 3-way cross-review chain"
```

---

### Task 10: Update `continueDebate` — 3-way rotation

**Files:**
- Modify: `src/dev-team-orchestrator.ts` (lines ~425–500)

**Context:**
`continueDebate` currently alternates binary between senior (odd) and junior (even). Needs a
3-way rotation: round 1 = senior (startDebate), round 2 = junior, round 3 = mid, round 4 = senior...
Also need a prompt for Thiago in the debate that reflects his aggressive personality.

**Step 1: Update the rotation logic**

Find line ~444:
```typescript
  const agent: 'senior' | 'junior' = state.debate_round % 2 === 0 ? 'junior' : 'senior';
```
Change to:
```typescript
  // 3-way rotation: round 2 = junior, round 3 = mid, round 4 = senior, round 5 = junior...
  // (round 1 is handled by startDebate which always dispatches senior)
  const rotationIndex = (state.debate_round - 2) % 3; // 0 = junior, 1 = mid, 2 = senior
  const agent: 'senior' | 'junior' | 'mid' =
    rotationIndex === 0 ? 'junior'
    : rotationIndex === 1 ? 'mid'
    : 'senior';
```

**Step 2: Add Thiago's debate prompt**

After `const juniorPrompt = ...` and before the `await runAgent(...)` call, add:

```typescript
  const midPrompt = `
Você está participando do planejamento do Sprint #${state.sprint_number}.
Leia os comentários existentes na Issue #${state.planning_issue}:
  gh issue view ${state.planning_issue} --repo ${DEVTEAM_UPSTREAM_REPO} --comments

Adicione sua perspectiva como comentário. Lembre-se da sua personalidade:
- Defenda suas ideias com confiança, mesmo que os outros discordem
- Questione propostas que acha complexas demais ou óbvias demais
- Pode ser direto e assertivo — você tem experiência suficiente para ter opinião forte

Nota: quem decide quando o time chegou a um consenso é o senior dev ou o PM — não você.
NÃO termine seu comentário com CONSENSUS_REACHED.

Use: gh issue comment ${state.planning_issue} --repo ${DEVTEAM_UPSTREAM_REPO} --body "..."
`;
```

**Step 3: Update the `runAgent` dispatch**

Find line ~479:
```typescript
  await runAgent(agent, agent === 'senior' ? seniorPrompt : juniorPrompt, group, chatJid, onProcess);
```
Change to:
```typescript
  const prompt = agent === 'senior' ? seniorPrompt
    : agent === 'junior' ? juniorPrompt
    : midPrompt;
  await runAgent(agent, prompt, group, chatJid, onProcess);
```

**Step 4: Build**

```bash
npm run build
```

Expected: clean build.

**Step 5: Run tests**

```bash
npm run test
```

Expected: 479 passing.

**Step 6: Commit**

```bash
git add src/dev-team-orchestrator.ts
git commit -m "feat: 3-way debate rotation with Thiago participating in planning discussions"
```

---

### Task 11: Update `authorFixTask` — handle `'mid'` assignee

**Files:**
- Modify: `src/dev-team-orchestrator.ts` (lines ~761–837)

**Context:**
`authorFixTask` calls `agentConfig(author)` where `author` is typed as `'senior' | 'junior'`.
The TypeScript compiler may already complain since `task.assignee` is now `'senior' | 'junior' | 'mid'`.
Just verify the types flow correctly — `agentConfig` already handles `'mid'` from Task 3.

**Step 1: Check for type errors**

```bash
npm run typecheck 2>&1 | grep -i "authorfix\|author"
```

If TypeScript reports an error about `author` not assignable to `'senior' | 'junior'`, find line ~781:
```typescript
  const author = task.assignee;
```
The type is already inferred from `task.assignee` which is now `'senior' | 'junior' | 'mid'`.
Since `agentConfig` accepts `'mid'` now, no change needed. Confirm by building cleanly.

**Step 2: Build and test**

```bash
npm run build && npm run test
```

Expected: clean build, 479 passing.

**Step 3: Commit if any changes were needed, otherwise skip**

If no changes: move to Task 12. If changes were needed:
```bash
git add src/dev-team-orchestrator.ts
git commit -m "fix: ensure authorFixTask handles mid assignee type correctly"
```

---

### Task 12: Final build, test, and integration verification

**Step 1: Full build and test**

```bash
npm run build && npm run test
```

Expected: clean build, 479 tests passing (same as baseline).

**Step 2: Verify sprint-state.json is backwards compatible**

The current `sprint-state.json` may be missing the new fields (`ticks_elapsed`, `max_ticks`,
`mid_fork`). The code uses `?? 0` and `?? DEVTEAM_MAX_SPRINT_TICKS` fallbacks — verify these
are in place. If the service is running, update the state file manually:

```bash
# Add missing fields to existing sprint-state.json if sprint is active
# ticks_elapsed and max_ticks default via ?? operators — no manual update needed
# mid_fork: will be set automatically on next tick via setupForks guard
```

**Step 3: Verify new env vars are documented**

Add to your `.env` or environment config:
```bash
DEVTEAM_MID_GITHUB_TOKEN=<thiago-bot-token>
DEVTEAM_MID_GITHUB_USER=<thiago-bot-username>
DEVTEAM_MID_SKIP_PROBABILITY=0.4   # optional, default 0.4
DEVTEAM_MAX_SPRINT_TICKS=30        # optional, default 30
```

**Step 4: Restart the service**

```bash
# macOS:
launchctl kickstart -k gui/$(id -u)/com.nanoclaw
```

**Step 5: Final commit (if any cleanup needed)**

```bash
git add .
git commit -m "chore: sprint time-boxing and Thiago mid-developer implementation complete"
```

---

## Summary of Changes

| File | Type | Change |
|------|------|--------|
| `src/dev-team-orchestrator.ts` | Own file | All orchestrator changes (Tasks 1, 3–11) |
| `data/dev-team/thiago-prompt.md` | New file | Thiago's personality prompt (Task 2) |

**New env vars:** `DEVTEAM_MID_GITHUB_TOKEN`, `DEVTEAM_MID_GITHUB_USER`,
`DEVTEAM_MID_SKIP_PROBABILITY` (default 0.4), `DEVTEAM_MAX_SPRINT_TICKS` (default 30).

**No `/* ved custom */` markers needed** — all modified files are own files, not upstream from
`qwibitai/nanoclaw`. Still run build/test checks as per `/ved-add-customization` discipline.
