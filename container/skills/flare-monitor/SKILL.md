---
name: flare-monitor
description: Check Flare for new unresolved errors in Gestão Simples. For each new error, create an isolated git worktree, implement the fix, open a PR, and notify Fabio. Continuously monitors open fix PRs for review comments and implements all requested changes. When PRs are merged, resolve the error on Flare with fix details.
---

# Flare Error Monitor — Gestão Simples

## Overview

This skill does three things on every run:

1. **New errors** — fetches unresolved Flare errors, opens a fix PR for each new one
2. **Review comments** — checks all open fix PRs for pending review comments and implements every requested change
3. **Merged PRs** — resolves the corresponding Flare error and adds fix details as a note

Each fix uses an isolated git worktree so multiple errors can be handled in the same run without conflicts.

## Steps

### 1. Load state files

Read `/workspace/group/flare-seen-errors.json`. If it doesn't exist, start with `{"seen": []}`.
Read `/workspace/group/flare-merged-prs.json`. If it doesn't exist, start with `{"notified": []}`.
Read `/workspace/group/flare-pr-reviews.json`. If it doesn't exist, start with `{"addressed": {}}`.

### 2. Initialize the bare repo

The git object store is a bare clone at `/workspace/extra/gestao-simples.git`. Worktrees are created in `/tmp/` — the Herd working copy is never touched.

```bash
cd /workspace/extra/gestao-simples.git
git config credential.helper "!/usr/bin/gh auth git-credential"

# Prune stale worktree references left by previous container runs
git worktree prune

# Fetch latest from GitHub
git fetch --prune origin

# Clean up local fix/flare-* branches whose remote is gone (merged or closed PRs)
git branch | grep 'fix/flare-' | while read branch; do
  if ! git ls-remote --exit-code origin "$branch" > /dev/null 2>&1; then
    git branch -D "$branch"
  fi
done
```

### 3. Check for newly merged PRs

```bash
gh pr list --repo vedovelli/gestao-simples --state merged --head "fix/flare-" --limit 20 --json number,title,headRefName,mergedAt,body,url
```

For each merged PR whose `number` is NOT in `flare-merged-prs.json`:

**a)** Add the PR number to `flare-merged-prs.json` and save immediately.

**b)** Extract the Flare error ID from the branch name: `fix/flare-<error-id>` → `<error-id>`.

**c)** Use Flare MCP to mark the error as resolved.

**d)** Use Flare MCP to add an investigation note to the error with these details:
```
✅ Resolved via PR merge

PR: <url>
Branch: <branch name>
Merged at: <mergedAt>

Fix summary:
<extract the "Fix" section from the PR body>
```

**e)** Notify Fabio via `mcp__nanoclaw__send_message`:
> "✅ Flare error resolved: <error title>\nFix merged and marked resolved on Flare."

### 4. Address review comments on open fix PRs

List all open PRs with `fix/flare-` branches:

```bash
gh pr list --repo vedovelli/gestao-simples --state open --head "fix/flare-" --limit 20 --json number,title,headRefName,url
```

For each open PR:

**a)** Collect all pending feedback not yet in `flare-pr-reviews.json["addressed"]["<number>"]`.

Get review-level feedback (CHANGES_REQUESTED):
```bash
gh api repos/vedovelli/gestao-simples/pulls/<number>/reviews \
  --jq '[.[] | select(.state == "CHANGES_REQUESTED") | {id: .id, body: .body, user: .user.login}]'
```

Get inline review comments:
```bash
gh api repos/vedovelli/gestao-simples/pulls/<number>/comments \
  --jq '[.[] | {id: .id, path: .path, line: .line, body: .body, user: .user.login}]'
```

Filter out IDs already listed in `addressed["<number>"]`. If no new feedback exists, skip to the next PR.

**b)** Mark all collected IDs as addressed in `flare-pr-reviews.json` and save immediately — before making any code changes. This prevents the same comments from being re-processed if the container is interrupted.

**c)** Extract the branch name from `headRefName` (e.g. `fix/flare-<error-id>`). Create a worktree for the existing branch:
```bash
cd /workspace/extra/gestao-simples.git
git worktree add /tmp/review-<pr-number> fix/flare-<error-id>
```

**d)** Work inside the worktree:
```bash
cd /tmp/review-<pr-number>
```
Read every file mentioned in the feedback. Understand all requested changes thoroughly. Implement every single requested change — do not skip any. Apply them in a single coherent edit.

**e)** Commit and push:
```bash
git add -A
git commit -m "fix: address review comments on PR #<number>"
git push origin fix/flare-<error-id>
```

**f)** Clean up the worktree:
```bash
cd /workspace/extra/gestao-simples.git
git worktree remove /tmp/review-<pr-number>
```

**g)** Notify Fabio via `mcp__nanoclaw__send_message`:
> "🔧 Review changes pushed on PR #<number>: <title>"

### 5. Fetch unresolved errors from Flare

Use Flare MCP to list all unresolved errors for the Gestão Simples project.

### 6. For each error NOT in the seen list

**a)** Add its ID to the seen list and save `/workspace/group/flare-seen-errors.json` immediately.

**b)** Fetch full error details via Flare MCP: stack trace, file, line number, request context.

**c)** Create an isolated worktree from the bare clone:
```bash
cd /workspace/extra/gestao-simples.git
git worktree add /tmp/fix-flare-<error-id> -b fix/flare-<error-id> origin/main
```

**d)** Work inside the worktree:
```bash
cd /tmp/fix-flare-<error-id>
```
Read the relevant files. Understand the error thoroughly. Implement the minimal correct fix — don't refactor surrounding code.

**e)** Commit and push:
```bash
git add -A
git commit -m "fix: <concise description>"
git push origin fix/flare-<error-id>
```

**f)** Create the PR:
```bash
gh pr create \
  --title "fix: <description>" \
  --body "## Error
<error title and ID from Flare>

## Stack trace
<relevant stack trace lines>

## Fix
<explanation of what was changed and why>" \
  --base main
```

**g)** Clean up the worktree:
```bash
cd /workspace/extra/gestao-simples.git
git worktree remove /tmp/fix-flare-<error-id>
```

**h)** Notify Fabio via `mcp__nanoclaw__send_message`:
> "🐛 New Flare error — PR opened: <title>\n<pr-url>"

### 7. If nothing was done

If there were no newly merged PRs, no open PRs with new review comments, and no new Flare errors — exit silently. Do not send any message.
