---
name: ved-sync-upstream
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

### Capture ved custom baseline (CRITICAL)

Before any changes are made, capture a per-file snapshot of all `ved custom` markers. This baseline is used in step 12 to detect silently dropped customizations.

```bash
grep -rn "ved custom" src/ container/ scripts/ --include="*.ts" --include="Dockerfile" --include="*.sh" | grep -v "ved custom end" | awk -F: '{print $1}' | sort | uniq -c | sort -rn
```

Hold this output in your working context — you will compare against it in steps 6b and 12. Do not write it to a file. Record:
- The total count of opening `ved custom` markers
- The list of files and how many opening markers each file has

This data is essential — without it, steps 6b and 12 cannot detect dropped customizations.

## 2. Fetch upstream

Run the fetch script:

```bash
./.claude/skills/ved-sync-upstream/scripts/fetch-upstream.sh
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

### Cross-reference with marker baseline (CRITICAL)

Compare `filesChanged` from the preview against the marker baseline captured in step 1. Any file that:
1. Has `ved custom` markers in the baseline, AND
2. Appears in `filesChanged`, BUT
3. Does NOT appear in `conflictRisk`

...is a **silent overwrite risk**. The merge tool will replace it with the upstream version without triggering a conflict, silently dropping our customizations.

**Flag these files to the user** with a warning: "These files have our customizations but the merge tool does not detect a conflict — they may be silently overwritten: {list}". These files will be verified immediately after the merge in step 6b.

Also check `filesDeleted` against the marker baseline. Any file in `filesDeleted` that has markers in the baseline is a **guaranteed customization loss** — upstream is removing a file that contains our code. **Flag this as a blocker** and ask the user how to handle it (relocate the customization to another file, or keep our version of the file).

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

## 6b. Protect flagged customizations (CRITICAL)

**This step fires regardless of whether there are conflicts.** Immediately after step 6, check every file that was flagged as a "silent overwrite risk" in step 3:

```bash
grep -c "ved custom" <flagged-file>
```

For each flagged file, compare the marker count against the baseline from step 1:

- **If the count matches the baseline:** The file survived the merge intact. Move on.
- **If the count is 0 or lower than the baseline:** The file was silently overwritten. Restore the `ved custom` blocks immediately:

  1. Extract the original version from main: `git show main:<file>`
  2. Identify the `ved custom` blocks in the main version
  3. Splice them back into the current (upstream) version at the correct locations
  4. Write the restored file

**Do not proceed to step 7 until every flagged file has been verified and restored if needed.** This is the proactive fix — step 12 is only the safety net.

## 7. Handle conflicts

**If backupPending=true:** There are unresolved merge conflicts.

**Before resolving any conflict**, search for `ved custom` markers in the conflicted file:

```bash
grep -n "ved custom" <file>
```

Any code between `/* ved custom */` and `/* ved custom end */` (or `# ved custom` / `# ved custom end` in Dockerfile/shell) is a local customization — **always keep our side for those blocks**.

**When still uncertain about what a local change is doing or why it exists**, consult the customizations tracking document in Obsidian:
- Vault path: `nanoclaw/nano-claw-custom-modifications-tracker.md`
- Fetch it with: `mcp__mcp-obsidian__obsidian_get_file_contents` (filepath: `nanoclaw/nano-claw-custom-modifications-tracker.md`)

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
- `better-sqlite3` native module mismatch — run `npm rebuild better-sqlite3`. If it persists, delete `node_modules/better-sqlite3` and `npm install better-sqlite3`. The `.nvmrc` and launchd plist must agree on the same Node major version.

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

This is the most important step. A silent overwrite can remove our customizations without any conflict or build error — the only way to catch it is explicit per-file verification.

### 12a. Per-file marker comparison (CRITICAL — DO NOT SKIP)

Capture the current per-file marker counts:

```bash
grep -rn "ved custom" src/ container/ scripts/ --include="*.ts" --include="Dockerfile" --include="*.sh" | grep -v "ved custom end" | awk -F: '{print $1}' | sort | uniq -c | sort -rn
```

Compare this output **line by line** against the marker baseline captured in step 1:

1. Every file that had markers in the baseline **must still have the same number of markers** (or more, if new customizations were added during conflict resolution).
2. If any file has **fewer markers** than the baseline, a customization was dropped — restore it.
3. If any file from the baseline is **completely absent** from the current output, all its customizations were silently overwritten — this is the most dangerous case. Restore the `ved custom` blocks from `main` using `git show main:<file>`.

**This per-file check is what prevents silent overwrites.** A global count can be misleading — a new marker in one file can mask a dropped marker in another.

To identify which specific block was dropped, diff the current file against main: `git diff main -- <file>` and look for removed `ved custom` sections. Restore only the missing blocks, keeping the upstream changes around them.

### 12b. Cross-reference with silent overwrite warnings

If step 3 flagged any files as "silent overwrite risk" (files with markers that were in `filesChanged` but not in `conflictRisk`), verify each one individually now. Read the file and confirm the `ved custom` blocks are intact.

### 12c. Structural checks

For the Dockerfile specifically, verify ordering: `git safe.directory` must appear **after** `USER node`.

```bash
grep -n "USER node\|safe.directory" container/Dockerfile
```

Verify custom skills are intact:
```bash
ls container/skills/
```
`flare-monitor/`, `send-link/` and `competitor-monitor/` must be present.

Verify the X integration IPC handler is intact in `src/ipc.ts` (the `spawn` import and the `x_*` handler block in the `default` case) and the X MCP tools block is intact in `container/agent-runner/src/ipc-mcp-stdio.ts`.

Verify that the `mcpServers` block in `container/agent-runner/src/index.ts` does not have duplicate keys:

```bash
grep -c "flare:" container/agent-runner/src/index.ts
grep -c "'mcp-obsidian':" container/agent-runner/src/index.ts
```

Each must return exactly `1`. If either returns `2`, remove the upstream-added entry (outside the `ved custom` block) and keep ours.

### 12d. Fix and push

If anything is missing or misplaced, fix it, commit to the sync branch, and push before requesting review. **Do not proceed to step 13 until every file passes the per-file check.**

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

## 14. Session report

**Write this note immediately after cleanup** — do not wait for the PR to be merged.

Use `mcp__mcp-obsidian__obsidian_patch_content` to write the report to the Obsidian vault:

- Filepath: `nanoclaw/reports/Upstream Sync v<NEW_VERSION> — Session Report (YYYY-MM-DD).md`

The report **must** cover all of the following sections:

### What's new in v<NEW_VERSION> (upstream changes)

For every commit between the previous version and the new version, document what actually changed functionally. Check `git log` on the upstream remote and inspect the key file diffs. Describe:
- New features added upstream
- Bug fixes
- Refactors that affect runtime behavior
- Infrastructure/tooling changes (CI, `.nvmrc`, etc.)
- New or updated skills bundled with upstream

### Conflicts resolved

A table listing every conflicted file, what we kept from our side, and what we adopted from upstream.

### Regressions found

Any issues caught during the regression check (step 12), how they were fixed, and how they were discovered. If none, say so explicitly.

### New customizations added

Any new `ved custom` blocks or skills created during this session.

### Infrastructure changes

Node version changes, plist updates, container rebuild notes, etc.

### Lessons learned

Anything that should inform future syncs — tricky conflict patterns, pre-existing test failures, ordering issues, etc.

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
