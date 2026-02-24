---
name: sync-upstream
description: "Use when pulling upstream NanoClaw changes into your fork via a review branch and PR, rather than applying directly to main."
---

# Sync Upstream (Fork Workflow)

Pull upstream changes into a dedicated branch, verify, then open a PR for human review before anything lands on `main`.

**Principle:** Never apply upstream changes directly to `main`. Always go through a branch → build/test → PR → review cycle.

**UX Note:** Use `AskUserQuestion` for all user-facing questions.

## 1. Pre-flight

Check that the skills system is initialized:

```bash
test -d .nanoclaw && echo "INITIALIZED" || echo "NOT_INITIALIZED"
```

**If NOT_INITIALIZED:** Run `initSkillsSystem()` first:

```bash
npx tsx -e "import { initNanoclawDir } from './skills-engine/init.js'; initNanoclawDir();"
```

Check for uncommitted git changes:

```bash
git status --porcelain
```

**If there are uncommitted changes:** Warn the user and ask via `AskUserQuestion`:
- "Continue anyway" — proceed
- "Abort (I'll commit first)" — stop here

Confirm we're on `main` before branching:

```bash
git branch --show-current
```

**If not on `main`:** Ask the user to switch to `main` before proceeding.

## 2. Fetch upstream

Run the fetch script:

```bash
./.claude/skills/sync-upstream/scripts/fetch-upstream.sh
```

Parse the structured status block between `<<< STATUS` and `STATUS >>>` markers. Extract:
- `TEMP_DIR` — path to extracted upstream files
- `REMOTE` — which git remote was used
- `CURRENT_VERSION` — version from local `package.json`
- `NEW_VERSION` — version from upstream `package.json`
- `STATUS` — "success" or "error"

**If STATUS=error:** Show the error output and stop.

**If CURRENT_VERSION equals NEW_VERSION:** Tell the user they're already up to date. Ask if they want to force the sync anyway. If no, clean up the temp dir and stop.

## 3. Preview

Run the preview to show what will change:

```bash
npx tsx scripts/update-core.ts --json --preview-only <TEMP_DIR>
```

This outputs JSON with: `currentVersion`, `newVersion`, `filesChanged`, `filesDeleted`, `conflictRisk`, `customPatchesAtRisk`.

Present to the user:
- "Syncing from **{currentVersion}** to **{newVersion}**"
- "{N} files will be changed" — list them if <= 20, otherwise summarize
- If `conflictRisk` is non-empty: "These files have skill modifications and may conflict: {list}"
- If `customPatchesAtRisk` is non-empty: "These custom patches may need re-application: {list}"
- If `filesDeleted` is non-empty: "{N} files will be removed"

## 4. Confirm

Use `AskUserQuestion`: "Create a sync branch and apply this update?" with options:
- "Yes, create branch and apply"
- "No, cancel"

If cancelled, clean up the temp dir (`rm -rf <TEMP_DIR>`) and stop.

## 5. Create branch

```bash
BRANCH="sync-upstream-$(date +%Y%m%d)"
git checkout -b "$BRANCH"
echo "Branch: $BRANCH"
```

**Note the branch name** — you will need it for the push and PR steps.

## 6. Apply

Run the update:

```bash
npx tsx scripts/update-core.ts --json <TEMP_DIR>
```

Parse the JSON output. The result has: `success`, `previousVersion`, `newVersion`, `mergeConflicts`, `backupPending`, `customPatchFailures`, `skillReapplyResults`, `error`.

**If success=true with no issues:** Continue to step 8.

**If customPatchFailures exist:** Warn the user which custom patches failed to re-apply. These may need manual attention after the update.

**If skillReapplyResults has false entries:** Warn the user which skill tests failed after re-application.

## 7. Handle conflicts

**If backupPending=true:** There are unresolved merge conflicts.

**Before resolving any conflict**, search for `ved custom` markers in the conflicted file:

```bash
grep -n "ved custom" <file>
```

Any code between `/* ved custom */` and `/* ved custom end */` (or `# ved custom` / `# ved custom end` in Dockerfile/shell) is a local customization — **always keep our side for those blocks**.

**When still uncertain about what a local change is doing or why it exists**, consult the customizations tracking document in Basic Memory Cloud:
- Project: `nanoclaw`
- Permalink: `nanoclaw/nano-claw-custom-modifications-tracker`
- Fetch it with: `mcp__basic-memory-cloud__read_note` (identifier: `nanoclaw/nano-claw-custom-modifications-tracker`, project: `nanoclaw`)

It lists every active customization, which files are affected, and re-apply difficulty. **Always keep our side** for any customization listed there.

For each file in `mergeConflicts`:
1. Read the file — it contains conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`)
2. Check if there's an intent file for this path in any applied skill (e.g., `.claude/skills/<skill>/modify/<path>.intent.md`)
3. Use the intent file and your understanding of the codebase to resolve the conflict
4. Write the resolved file

After resolving all conflicts:

```bash
npx tsx scripts/post-update.ts
```

**If you cannot confidently resolve a conflict:** Show the user the conflicting sections and ask them to choose or provide guidance.

## 8. Run migrations

```bash
npx tsx scripts/run-migrations.ts <CURRENT_VERSION> <NEW_VERSION> <TEMP_DIR>
```

Parse the JSON output: `migrationsRun` (count), `results` (array of `{version, success, error?}`).

**If any migration fails:** Show the error. The update is already applied — migration failure needs manual attention.

**If no migrations found:** Normal. Continue silently.

## 9. Verify

```bash
npm run build && npm test
```

**If build fails:** Show the error. Common causes:
- Type errors from merged files — read the error, fix, retry
- Missing dependencies — run `npm install` first, retry

**If tests fail:** Show which tests failed. Try to diagnose and fix. If you can't fix automatically, report to the user and stop before pushing.

**Do not push or open a PR if build or tests are failing.**

## 10. Commit and push

Stage and commit everything on the sync branch:

```bash
git add -A
git commit -m "Sync upstream v<NEW_VERSION> from qwibitai/nanoclaw"
git push -u origin <BRANCH>
```

## 11. Open PR

```bash
gh pr create \
  --title "Sync upstream v<NEW_VERSION>" \
  --body "$(cat <<'EOF'
## Upstream sync: v<CURRENT_VERSION> → v<NEW_VERSION>

Pulls changes from [qwibitai/nanoclaw](https://github.com/qwibitai/nanoclaw).

## Changes
- N files changed
- <list any conflict risk or custom patch warnings here>

## Verification
- Build: passing
- Tests: passing

**Review before merging.** After merging, restart the service:
\`\`\`bash
launchctl kickstart -k gui/$(id -u)/com.nanoclaw
\`\`\`
EOF
)"
```

Show the PR URL to the user.

## 12. Regression check

After opening the PR, verify all `ved custom` markers survived the merge:

```bash
grep -rn "ved custom" src/ container/ --include="*.ts" --include="Dockerfile" --include="*.sh"
```

Each marker that existed before the sync must still be present. Count them: there should be **no fewer** than before. If any are missing, the block was dropped — restore it from the customizations tracker in Basic Memory Cloud (`nanoclaw/nano-claw-custom-modifications-tracker`).

For the Dockerfile specifically, also verify ordering: `git safe.directory` must appear **after** `USER node`.

```bash
grep -n "USER node\|safe.directory" container/Dockerfile
```

Also verify custom skills are intact:
```bash
ls container/skills/
```
`flare-monitor/` and `send-link/` must be present.

If anything is missing or misplaced, fix it, commit to the sync branch, and push before requesting review.

**When adding new customizations to upstream files in the future**, always wrap them with `/* ved custom */` ... `/* ved custom end */` (or `# ved custom` / `# ved custom end` in Dockerfile/shell), and update the customizations tracker.

## 13. Cleanup

```bash
rm -rf <TEMP_DIR>
```

Report final status:
- PR URL
- "Synced from **{previousVersion}** to **{newVersion}**"
- Number of files changed
- Any warnings (failed custom patches, failed skill tests, migration issues)
- Reminder: "Review and merge the PR, then restart the service"

## Troubleshooting

**No upstream remote:** The fetch script auto-adds `upstream` pointing to `https://github.com/qwibitai/nanoclaw.git`. If you forked from a different URL, set it manually: `git remote add upstream <url>`.

**Branch already exists:** If `sync-upstream-YYYYMMDD` already exists, append `-2`: `git checkout -b sync-upstream-YYYYMMDD-2`.

**Build fails after update:** Check if `package.json` dependencies changed. Run `npm install` to pick up new dependencies.

**Rollback:** If something goes wrong before the PR is merged, just delete the branch:
```bash
git checkout main
git branch -D <BRANCH>
git push origin --delete <BRANCH>
```

If you need to restore files to pre-update state before deleting the branch:
```bash
npx tsx -e "import { restoreBackup, clearBackup } from './skills-engine/backup.js'; restoreBackup(); clearBackup();"
```
