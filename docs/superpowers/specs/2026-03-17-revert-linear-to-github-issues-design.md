# Revert AI Dev Team from Linear to GitHub Issues

**Date:** 2026-03-17
**Motivation:** Linear free tier limit reached. All sprint planning and issue tracking must return to GitHub Issues.

## Scope

### Files Modified

| File | Action |
|------|--------|
| `src/dev-team-orchestrator.ts` | Base from pre-Linear commit (`947757e~1`) + re-apply post-Linear improvements |
| `data/dev-team/orchestrator-prompt.md` | Restore pre-Linear version (6 rules, no Linear references) |
| `container/agent-runner/src/index.ts` | Remove Linear MCP server config and `mcp__linear__*` from allowed tools |
| `src/container-runner.ts` | Remove `LINEAR_API_KEY` from env passthrough. Update `~/.mcp-auth` comment to remove Linear reference. Keep mount. |
| `data/dev-team/sprint-state.json` | Reset to IDLE with `number` types |

### Post-deploy Propagation

After editing `container/agent-runner/src/index.ts`, the session copies at `data/sessions/*/agent-runner-src/` must be synced (step 9). These are the actually-mounted copies at runtime.

### Files NOT Touched

`src/types.ts`, `src/config.ts`, `src/container-runtime.ts`

## Approach: Checkout Pre-Linear + Cherry-pick

1. Extract `dev-team-orchestrator.ts` from `947757e~1` (pre-Linear baseline, 1048 lines)
2. Re-apply post-Linear improvements on top of GitHub Issues base
3. Edit remaining files to remove Linear references

## Changes to `dev-team-orchestrator.ts`

Starting from the pre-Linear file, apply these layers:

### Layer 1: Types

- `SprintTask.issue`: stays `number | null` (original)
- `SprintTask.status`: add `'skipped_dysfunction'` (from dysfunction mode)
- `SprintTask.merge_attempts?`: `number` (from hardening)
- `SprintState.task_under_review`: stays `number | null` (original)
- `SprintState.planning_issue`: stays `number | null` (original)
- `SprintState.dysfunctionMode`: `boolean` (new field)

### Layer 2: Exports

- `readState()` -> `export function readState()`
- `runAgent()` -> `export async function runAgent()` + param `dysfunctionMode = false`

### Layer 3: readState() defaults

- Add `state.dysfunctionMode = state.dysfunctionMode ?? false`

### Layer 4: runAgent() dysfunction prompt selection

- Ana uses `ana-dysfunction-prompt.md` when `dysfunctionMode = true`

### Layer 5: MERGE state hardening (from ac97338, 53f642f)

- Pre-check of already-merged PRs on GitHub via `gh api`
- `processMerge` uses `execSync gh pr merge` directly (no LLM output dependency)
- Auto-pause after 3 consecutive `merge_attempts` on same PR

### Layer 6: DEV state hardening (from 53f642f)

- Validate PR exists on upstream after agent reports creation
- Fallback to branch-based search if PR not found
- Reset task to pending if PR is invalid

### Layer 7: Dysfunction mode behaviors (from 6badb52, e8815df, 81a9a0d)

- `continueDebate`: skip Ana with 60% probability, Carlos acknowledges absence
- `checkDevProgress`: skip Ana task 60% -> `skipped_dysfunction`
- `processReview`: skip Ana review 60% -> auto-approve
- `allApproved` checks include `skipped_dysfunction`

### Layer 8: Prompts revert to `gh` CLI

All agent prompts use `gh issue`/`gh api` instead of Linear MCP:
- `startNewSprint`: `gh issue create`
- `continueDebate`: `gh issue view --comments`
- `startDev`: `gh issue view` + `postPlanningProgress()`
- `processReview`: `gh api pulls/comments` + `postPlanningProgress()`
- `authorFixTask`: `gh api pulls/comments`
- `processMerge`: `postPlanningProgress()`
- `finishSprint`: `gh issue comment` + `gh issue close`

### Layer 9: Restore `postPlanningProgress()`

Helper function that posts timeline comments on the planning issue via `gh issue comment` with tmpFile for body.

### Layer 10: Remove Linear constants

Remove `LINEAR_PROJECT` and `LINEAR_TEAM` constants.

## Changes to `orchestrator-prompt.md`

Restore pre-Linear version:
- 6 rules total
- Rule 6: "Always use GitHub CLI (`gh`) for all GitHub operations"
- No "Linear Issue Hierarchy" section
- No "Linear Status Management" section

## Changes to `agent-runner/src/index.ts`

- Remove `linear` entry from `mcpServers` object (url: `https://mcp.linear.app/mcp`)
- Remove `'mcp__linear__*'` from allowed tools array

## Changes to `container-runner.ts`

- Remove `'LINEAR_API_KEY'` from env vars array passed to container
- Keep `~/.mcp-auth` mount (may be used by other MCP servers in the future)

## Changes to `sprint-state.json`

Reset to clean IDLE state preserving current sprint number:
```json
{
  "sprint_number": 78,
  "state": "IDLE",
  "paused": false,
  "started_at": null,
  "planning_issue": null,
  "tasks": [],
  "next_action_at": null,
  "upstream_repo": "<preserved>",
  "senior_fork": "<preserved>",
  "junior_fork": "<preserved>",
  "debate_round": 0,
  "review_round": 0,
  "task_under_review": null,
  "dysfunctionMode": false
}
```

## Execution Order

0. Stop service or pause sprint to prevent orchestrator ticks during edits
1. Extract pre-Linear `dev-team-orchestrator.ts` as base
2. Apply layers 1-10 (hardening, dysfunction, exports, prompt rewrites)
3. Restore `orchestrator-prompt.md` to pre-Linear
4. Edit `agent-runner/src/index.ts` — remove Linear MCP
5. Edit `container-runner.ts` — remove `LINEAR_API_KEY`, update `~/.mcp-auth` comment
6. Reset `sprint-state.json`
7. `npm run typecheck` + `npm run build`
8. `./container/build.sh`
9. Sync agent-runner-src to sessions: `for dir in data/sessions/*/agent-runner-src; do cp -r container/agent-runner/src/. "$dir/"; done`
10. Restart service

## Validation

- `npm run typecheck` — types consistent (`number` fields)
- `npm run build` — compiles clean
- `grep -ri linear src/ container/agent-runner/src/ data/dev-team/ --include="*.ts" --include="*.md"` — zero matches
- `grep -i linear data/sessions/*/agent-runner-src/index.ts` — zero matches (confirms session sync)
- `npm run test` — all tests pass

## Risks

- Hardening commits (`ac97338`/`53f642f`) were written on Linear code. Re-applying on GitHub base requires careful porting of `processMerge` logic (execSync merge, pre-check, merge_attempts).
- `postPlanningProgress()` original used `tmpFile` for body — preserve exact implementation.
