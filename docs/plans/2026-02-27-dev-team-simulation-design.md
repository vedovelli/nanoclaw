# Dev Team Simulation — Design Document

**Date**: 2026-02-27
**Status**: Approved

## Purpose

Create two autonomous AI developer agents (senior + junior) that continuously develop a React/TypeScript SPA, generating realistic GitHub activity (PRs, code reviews, comments, merges). The purpose is to feed a temporal database ingestion tool with real development data.

## Architecture

```
┌─────────────────────────────────────────────────┐
│                   NanoClaw                       │
│                                                  │
│  ┌───────────────────────────────────────────┐   │
│  │         Sprint Orchestrator               │   │
│  │    (scheduled task, Sonnet, loop)         │   │
│  └──────────┬────────────────┬───────────────┘   │
│             │                │                   │
│     ┌───────▼──────┐  ┌─────▼────────┐          │
│     │ Agent Carlos │  │  Agent Ana   │          │
│     │  (Haiku)     │  │  (Haiku)     │          │
│     └───────┬──────┘  └─────┬────────┘          │
└─────────────┼────────────────┼───────────────────┘
              │                │
        ┌─────▼────┐    ┌─────▼────┐
        │ Fork Sr  │    │ Fork Jr  │
        └─────┬────┘    └─────┬────┘
              └───────┬────────┘
                      ▼
              ┌──────────────┐
              │   Upstream   │
              └──────────────┘
```

### Components

1. **Sprint Orchestrator** — Scheduled task (NanoClaw), Sonnet model. Controls the state machine. Wakes every 5 minutes, reads state, executes next action if due.

2. **Agent Carlos (Senior)** — Container agent, Haiku model. 10 years exp, fullstack React/TS. Favors clean abstractions, custom hooks, composition. Detailed but constructive reviewer.

3. **Agent Ana (Junior)** — Container agent, Haiku model. 3 years exp, frontend React. Pragmatic, direct code. Asks genuine questions in reviews. Pushes back on over-engineering.

4. **3 GitHub repos** — Upstream (fabiovedovelli) + 2 forks (one per agent account).

## Sprint State Machine

```
PLANNING → DEBATE → TASKING → DEV → REVIEW → MERGE → (loop)
```

### States

- **PLANNING**: Orchestrator creates GitHub Issue "Sprint Planning #N"
- **DEBATE**: Senior proposes features, Junior responds. 2-4 rounds of comments.
- **TASKING**: Orchestrator detects consensus, creates individual Issues with labels (senior/junior)
- **DEV**: Agents work in parallel on their forks, each on their assigned Issue
- **REVIEW**: Cross-review — each agent reviews the other's PR. Comments, request changes, loop until approval.
- **MERGE**: Reviewer approves, orchestrator merges. Both forks sync with upstream.
- After all tasks merged → back to PLANNING.

### Semi-realistic Delays

| Transition | Delay |
|-----------|-------|
| Each debate comment | 3-8 min |
| DEBATE → TASKING | 5 min |
| TASKING → DEV | 2-5 min |
| Intermediate commits | 10-30 min |
| PR created → review starts | 15-45 min |
| Each review comment | 5-15 min |
| Approval → merge | 3-5 min |
| Sprint complete → new PLANNING | 30 min |

Delays are randomized within ranges for organic feel.

### State Persistence

```json
{
  "sprint_number": 3,
  "state": "REVIEW",
  "started_at": "2026-02-27T14:00:00Z",
  "planning_issue": 42,
  "tasks": [
    { "issue": 43, "assignee": "senior", "pr": 12, "status": "in_review" },
    { "issue": 44, "assignee": "junior", "pr": null, "status": "dev" }
  ],
  "next_action_at": "2026-02-27T16:30:00Z"
}
```

## Agent Personas

### Carlos (Senior)

- 10 years experience, fullstack with React/TS focus
- Code style: Clean abstractions, custom hooks, separation of concerns, generic types, composition over inheritance
- Review style: Detailed, constructive. Requests refactors for code smells. Suggests patterns with inline code examples. Praises junior on difficult wins.
- Planning: Pushes for architectural features (state management, routing, reusable abstractions). Sometimes over-engineers.
- Commits: Conventional (`feat:`, `fix:`, `refactor:`), atomic.

### Ana (Junior)

- 3 years experience, frontend only, trending mid-level
- Code style: Direct, pragmatic. Sometimes duplicates where senior would abstract. Occasional `any`. Improves sprint over sprint.
- Review style: Asks genuine questions. Less assertive suggestions but catches real bugs. Asks for explanations on complex abstractions.
- Planning: Suggests visual/UX features (components, interactions, responsiveness). Pushes for simplicity.
- Commits: Conventional, slightly longer/descriptive messages.

### Review Dynamics

- ~20% PRs approved first round
- ~70% approved second round
- ~10% need 3+ rounds
- Carlos requests refactors → Ana implements or pushes back with YAGNI
- Ana asks about abstractions → Carlos explains with inline code examples

## File Structure (NanoClaw)

```
data/dev-team/
├── sprint-state.json
├── orchestrator-prompt.md
├── carlos-prompt.md
├── ana-prompt.md
└── sprint-history/
    ├── sprint-001.json
    └── sprint-002.json
```

## Environment Variables

```
DEVTEAM_UPSTREAM_REPO=fabiovedovelli/repo-name
DEVTEAM_SENIOR_GITHUB_TOKEN=ghp_xxx
DEVTEAM_SENIOR_GITHUB_USER=carlos-xxx
DEVTEAM_JUNIOR_GITHUB_TOKEN=ghp_yyy
DEVTEAM_JUNIOR_GITHUB_USER=ana-xxx
DEVTEAM_ENABLED=true
```

## Telegram Control

- `/devteam stop` — Pauses orchestrator (sets state to PAUSED)
- `/devteam start` — Resumes from where it stopped
- `/devteam status` — Reports current sprint, state, next action

Requires a command handler in the Telegram router that intercepts `/devteam` messages and modifies `sprint-state.json`.

## Models

- **Orchestrator**: Sonnet — makes judgment calls (detect consensus, evaluate quality, decide merges)
- **Carlos & Ana**: Haiku — writes code, reviews, comments (60x cheaper than Opus)

## Upstream Repo Scaffold

Created once during setup:
- Vite + React + TypeScript
- TanStack Router, Query, Table, Form, Virtual
- MSW for API mocking
- Tailwind CSS
- ESLint + Prettier
- GitHub Issue templates
- CLAUDE.md with project conventions
- README.md

## Cost Estimate

Per sprint (~3 days):
- Planning debate: ~4-6 invocations
- Dev (2 tasks): ~4-8 invocations
- Review: ~4-8 invocations
- **Total per sprint: ~12-22 Haiku invocations + ~5-8 Sonnet invocations**

## Stop Mechanism

- `/devteam stop` via Telegram (primary)
- Set `DEVTEAM_ENABLED=false` in .env + restart (fallback)
- Delete `sprint-state.json` (emergency)
