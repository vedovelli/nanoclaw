# Design: ved- Skills Naming Convention + Customization Protocol Skill

**Date:** 2026-02-24
**Status:** Approved

## Context

NanoClaw is a fork of qwibitai/nanoclaw. Upstream syncs periodically merge upstream changes. To distinguish our local skills from upstream skills, and to enforce a consistent protocol when customizing upstream files, we're making two changes:

1. Prefix all local (ved-owned) skills with `ved-`
2. Create a `ved-add-customization` skill that enforces the customization protocol before any upstream file is modified

## What We're Building

### 1. Rename `sync-upstream` → `ved-sync-upstream`

The existing local skill for syncing upstream changes gets the `ved-` prefix. Only the directory name and `name:` frontmatter change — the git branch naming convention (`sync-upstream-YYYYMMDD`) stays as-is since it describes the operation, not the skill.

### 2. New skill: `ved-add-customization`

A protocol checklist skill auto-invoked before any customization work on upstream files. It does not replace the upstream `customize` skill — it runs alongside it as a local companion.

**Steps:**

1. **Identify the file type** — Is the target an upstream file (came from qwibitai/nanoclaw, lives in `src/`, `container/`, `scripts/`) or a new local file we're creating? Upstream files require markers; local-only files do not.

2. **Check the tracker** — Before touching anything, read `nanoclaw/nano-claw-custom-modifications-tracker` from Basic Memory Cloud to understand existing customizations in the target files. Avoid duplicating or conflicting with existing work.

3. **Implement with markers** — Every change inside an upstream file must be wrapped:
   - TypeScript/JS: `/* ved custom */` … `/* ved custom end */`
   - Dockerfile/shell: `# ved custom` … `# ved custom end`
   Keep each block minimal — only the changed lines, not surrounding context.

4. **Verify markers** — After implementing, grep the changed file:
   ```bash
   grep -n "ved custom" <changed-file>
   ```
   Confirm every customization has both opening and closing markers.

5. **Update the tracker** — Add a new entry to the Basic Memory Cloud tracker with:
   - File path
   - What was changed
   - Why it exists
   - Re-apply difficulty (easy / medium / hard)

6. **Build check** — Run `npm run build`. Don't leave with a broken build.

7. **Should this be a skill?** — If the customization is substantial (new MCP server, new mount, new integration), prompt: "This looks big enough to be its own `ved-` skill. Want to create one so it's documented and repeatable?"

### 3. Update `CLAUDE.md` Skills table

Add both local skills to the Skills table (currently missing):

```
| `/ved-sync-upstream`     | Pull upstream changes into a branch + PR for review |
| `/ved-add-customization` | Protocol checklist before customizing any upstream file |
```

## What We're NOT Doing

- Not touching the upstream `customize` skill (avoids merge conflicts)
- Not renaming upstream skills (only local `ved-` skills get the prefix)
- Not changing git branch naming convention (`sync-upstream-YYYYMMDD` stays)

## File Changes Summary

| Action | Path |
|--------|------|
| Rename dir | `.claude/skills/sync-upstream/` → `.claude/skills/ved-sync-upstream/` |
| Update name | `.claude/skills/ved-sync-upstream/SKILL.md` (frontmatter + script path) |
| Create | `.claude/skills/ved-add-customization/SKILL.md` |
| Update | `CLAUDE.md` (Skills table) |
