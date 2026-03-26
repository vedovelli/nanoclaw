# Basic Memory Cloud → Obsidian MCP Migration

**Date:** 2026-03-26
**Status:** Approved

## Context

NanoClaw uses Basic Memory Cloud as its persistent knowledge store — customization tracker, competitor snapshots, sync reports, and plans. Basic Memory Cloud is a remote MCP server accessed via HTTP Stream, authenticated with `BASIC_MEMORY_API_KEY`.

We are replacing it with Obsidian, which runs a local REST API on the host machine (`127.0.0.1:27124`). The Obsidian MCP is stdio-based (`uvx mcp-obsidian`) and communicates with the REST API via env vars. All Basic Memory content has already been migrated to the Obsidian vault.

## Approach

**Option A (chosen):** Install `uv` in the container Docker image so `uvx mcp-obsidian` works as a stdio MCP server inside the container. The container reaches the host API via `host.docker.internal:27124`.

## Changes

### 1. Environment Variables

**`.env.example` and `.env`:**

| Remove | Add |
|--------|-----|
| `BASIC_MEMORY_API_KEY=` | `OBSIDIAN_API_KEY=` |
| — | `OBSIDIAN_HOST=127.0.0.1` |
| — | `OBSIDIAN_PORT=27124` |

### 2. Host Code — `src/container-runner.ts`

- Remove `BASIC_MEMORY_API_KEY` from the env vars passthrough list.
- Add `OBSIDIAN_API_KEY`, `OBSIDIAN_HOST`, `OBSIDIAN_PORT`.
- Override `OBSIDIAN_HOST` to `host.docker.internal` when passing to the container (so the container can reach the host's localhost).

### 3. Container Dockerfile

Add `uv` binary:

```dockerfile
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
```

### 4. Agent Runner — `container/agent-runner/src/index.ts`

Replace MCP server config:

**Remove:**
```js
'basic-memory-cloud': {
  url: '...',
  headers: { Authorization: `Bearer ${sdkEnv.BASIC_MEMORY_API_KEY || ''}` },
}
```

**Add:**
```js
'mcp-obsidian': {
  command: 'uvx',
  args: ['mcp-obsidian'],
  env: {
    OBSIDIAN_API_KEY: sdkEnv.OBSIDIAN_API_KEY || '',
    OBSIDIAN_HOST: sdkEnv.OBSIDIAN_HOST || 'host.docker.internal',
    OBSIDIAN_PORT: sdkEnv.OBSIDIAN_PORT || '27124',
  },
}
```

Replace allowed tools: `'mcp__basic-memory-cloud__*'` → `'mcp__mcp-obsidian__*'`.

### 5. Skills — Tool Call Mapping

| Basic Memory Cloud | Obsidian MCP |
|--------------------|-------------|
| `mcp__basic-memory-cloud__read_note` | `mcp__mcp-obsidian__obsidian_get_file_contents` |
| `mcp__basic-memory-cloud__write_note` | `mcp__mcp-obsidian__obsidian_patch_content` |
| `mcp__basic-memory-cloud__edit_note` (prepend) | `mcp__mcp-obsidian__obsidian_patch_content` |
| `mcp__basic-memory-cloud__search_notes` | `mcp__mcp-obsidian__obsidian_simple_search` |
| `project: "dev-visibility-product"` | Folder path in vault (e.g., `dev-visibility-product/`) |

**Files to update:**
- `container/skills/competitor-monitor/SKILL.md` — heaviest changes, all BM calls → Obsidian
- `.claude/skills/ved-sync-upstream/SKILL.md` — tracker reads, report writes
- `.claude/skills/ved-add-customization/SKILL.md` — tracker reads/writes, customization notes

### 6. ved-sync-upstream Verification

The grep check `grep -c "'basic-memory-cloud':"` changes to `grep -c "'mcp-obsidian':"`.

### 7. Memory and Cleanup

- `MEMORY.md` — Update plan-saving workflow reference from Basic Memory to Obsidian.
- `.bm-nanoclaw/` — Delete directory (untracked, content already in Obsidian vault).

## Out of Scope

- Content migration (already done).
- Obsidian MCP server setup on host (already configured).
- Changes to tools available in host Claude Code sessions (already has `mcp__mcp-obsidian__*`).
