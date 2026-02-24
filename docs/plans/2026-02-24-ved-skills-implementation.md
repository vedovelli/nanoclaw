# ved- Skills: Naming Convention + Customization Protocol

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rename the local `sync-upstream` skill to `ved-sync-upstream`, create a new `ved-add-customization` protocol skill, and update `CLAUDE.md` to list both.

**Architecture:** Three independent file operations — a git rename, a new skill file, and a CLAUDE.md edit. No code changes, no tests needed. Each task ends with a commit.

**Tech Stack:** Bash (git mv), Markdown skill files.

**Design doc:** `docs/plans/2026-02-24-ved-skills-customization-protocol.md`

---

### Task 1: Rename `sync-upstream` → `ved-sync-upstream`

**Files:**
- Rename dir: `.claude/skills/sync-upstream/` → `.claude/skills/ved-sync-upstream/`
- Modify: `.claude/skills/ved-sync-upstream/SKILL.md` (frontmatter + script path)

**Step 1: Git-move the directory**

```bash
git mv .claude/skills/sync-upstream .claude/skills/ved-sync-upstream
```

Expected: no output, directory renamed.

**Step 2: Update the `name:` frontmatter**

In `.claude/skills/ved-sync-upstream/SKILL.md`, line 2:

Old:
```yaml
name: sync-upstream
```

New:
```yaml
name: ved-sync-upstream
```

**Step 3: Update the script path reference**

Same file, in the "Fetch upstream" section (Step 2), find:

```
./.claude/skills/sync-upstream/scripts/fetch-upstream.sh
```

Replace with:

```
./.claude/skills/ved-sync-upstream/scripts/fetch-upstream.sh
```

**Step 4: Verify no other references remain**

```bash
grep -rn "skills/sync-upstream" .claude/ CLAUDE.md
```

Expected: no output.

**Step 5: Commit**

```bash
git add .claude/skills/ved-sync-upstream
git commit -m "feat: rename sync-upstream skill to ved-sync-upstream"
```

---

### Task 2: Create `ved-add-customization` skill

**Files:**
- Create: `.claude/skills/ved-add-customization/SKILL.md`

**Step 1: Write the skill file**

Create `.claude/skills/ved-add-customization/SKILL.md` with this exact content:

```markdown
---
name: ved-add-customization
description: Use before implementing any customization in an upstream NanoClaw file. Enforces ved custom marker protocol, tracker check, and build verification. Triggers on any task that modifies src/, container/, or scripts/ files that came from qwibitai/nanoclaw.
---

# Customization Protocol (ved-add-customization)

Run this protocol before and after every change to an upstream file. Upstream files are anything in `src/`, `container/`, `scripts/` that originated from qwibitai/nanoclaw. New files you create from scratch are local-only and skip this protocol.

## Step 1: Identify file ownership

Is the target file upstream (came from qwibitai/nanoclaw) or a new local file?

```bash
git log --oneline --follow <file> | tail -1
```

If the earliest commit is an upstream sync (message contains "Sync upstream" or "Initial commit"), it's an upstream file — markers required. If it's a file you're creating fresh, skip to implementation directly.

## Step 2: Check the customizations tracker

Before touching anything, read the existing customizations tracker:

- Project: `nanoclaw`
- Permalink: `nanoclaw/nano-claw-custom-modifications-tracker`
- Tool: `mcp__basic-memory-cloud__read_note` (identifier: `nanoclaw/nano-claw-custom-modifications-tracker`, project: `nanoclaw`)

Understand what's already customized in the target files. Do not duplicate or conflict with existing marked blocks.

## Step 3: Implement with markers

Wrap every change inside an upstream file:

**TypeScript / JavaScript:**
```typescript
/* ved custom */
// your changes here
/* ved custom end */
```

**Dockerfile / shell scripts:**
```dockerfile
# ved custom
# your changes here
# ved custom end
```

Rules:
- Keep each marker block minimal — only the changed lines, not surrounding context
- One block per logical customization (don't group unrelated changes under one marker)
- Inline single-line changes: `/* ved custom */ yourCode; /* ved custom end */`

## Step 4: Verify markers

After implementing, confirm every customization has both opening and closing markers:

```bash
grep -n "ved custom" <changed-file>
```

The output should show balanced pairs: each opening marker has a corresponding closing marker.

## Step 5: Update the tracker

Add a new entry to the Basic Memory Cloud customizations tracker:
- Project: `nanoclaw`
- Permalink: `nanoclaw/nano-claw-custom-modifications-tracker`
- Tool: `mcp__basic-memory-cloud__edit_note`

Include for each new customization:
- **File path** — exact path relative to repo root
- **What** — one sentence describing the change
- **Why** — why this customization exists (the business reason)
- **Re-apply difficulty** — easy / medium / hard (how hard to restore after a future merge conflict)

## Step 6: Build check

```bash
npm run build
```

Fix any TypeScript errors before proceeding. Never leave the session with a broken build.

## Step 7: Should this be a skill?

If the customization is substantial — adding a new MCP server, a new container mount, a new integration — ask:

> "This change is significant enough to become its own `ved-` skill. Want me to create `.claude/skills/ved-<name>/SKILL.md` so it's documented, repeatable, and shows up in `/help`?"

If yes, create the skill file before committing.
```

**Step 2: Verify the file was written correctly**

```bash
head -5 .claude/skills/ved-add-customization/SKILL.md
```

Expected output:
```
---
name: ved-add-customization
description: Use before implementing any customization...
```

**Step 3: Commit**

```bash
git add .claude/skills/ved-add-customization/SKILL.md
git commit -m "feat: add ved-add-customization protocol skill"
```

---

### Task 3: Update `CLAUDE.md` Skills table

**Files:**
- Modify: `CLAUDE.md` (Skills table, lines 35–40)

**Step 1: Add both local skills to the table**

Find this block in `CLAUDE.md`:

```markdown
| Skill | When to Use |
|-------|-------------|
| `/setup` | First-time installation, authentication, service configuration |
| `/customize` | Adding channels, integrations, changing behavior |
| `/debug` | Container issues, logs, troubleshooting |
| `/update` | Pull upstream NanoClaw changes, merge with customizations, run migrations |
```

Replace with:

```markdown
| Skill | When to Use |
|-------|-------------|
| `/setup` | First-time installation, authentication, service configuration |
| `/customize` | Adding channels, integrations, changing behavior |
| `/debug` | Container issues, logs, troubleshooting |
| `/update` | Pull upstream NanoClaw changes, merge with customizations, run migrations |
| `/ved-sync-upstream` | Pull upstream changes into a branch + PR for human review before merging |
| `/ved-add-customization` | Protocol checklist before customizing any upstream file — markers, tracker, build |
```

**Step 2: Verify the table looks right**

```bash
grep -A 10 "## Skills" CLAUDE.md
```

Expected: table with 6 rows including both `ved-` skills.

**Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add ved-sync-upstream and ved-add-customization to skills table"
```
