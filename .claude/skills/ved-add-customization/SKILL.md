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
