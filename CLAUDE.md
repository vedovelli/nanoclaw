# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# NanoClaw

Personal Claude assistant. See [README.md](README.md) for philosophy and setup. See [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) for architecture decisions.

## Quick Context

Single Node.js process that connects to WhatsApp, routes messages to Claude Agent SDK running in containers (Linux VMs). Each group has isolated filesystem and memory.

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Orchestrator: state, message loop, agent invocation |
| `src/channels/whatsapp.ts` | WhatsApp connection, auth, send/receive |
| `src/ipc.ts` | IPC watcher and task processing |
| `src/router.ts` | Message formatting and outbound routing |
| `src/group-queue.ts` | Per-group queue with global concurrency limit |
| `src/config.ts` | Trigger pattern, paths, intervals |
| `src/container-runner.ts` | Spawns agent containers with mounts |
| `src/container-runtime.ts` | Runtime detection (Apple Container vs Docker) |
| `src/task-scheduler.ts` | Runs scheduled tasks |
| `src/db.ts` | SQLite operations |
| `src/mount-security.ts` | Validates additional mounts against allowlist |
| `src/types.ts` | Shared types (Channel, RegisteredGroup, ScheduledTask, etc.) |
| `groups/{name}/CLAUDE.md` | Per-group memory (isolated) |
| `container/agent-runner/src/index.ts` | Runs inside container; receives ContainerInput via stdin, streams output with sentinel markers |
| `container/skills/agent-browser.md` | Browser automation tool (available to all agents via Bash) |

## Skills

| Skill | When to Use |
|-------|-------------|
| `/setup` | First-time installation, authentication, service configuration |
| `/customize` | Adding channels, integrations, changing behavior |
| `/debug` | Container issues, logs, troubleshooting |
| `/update` | Pull upstream NanoClaw changes, merge with customizations, run migrations |
| `/ved-sync-upstream` | Pull upstream changes into a branch + PR for human review before merging |
| `/ved-add-customization` | Protocol checklist before customizing any upstream file — markers, tracker, build |

## Code Traversal and Editing — HARD REQUIREMENT

**You MUST use the Serena MCP tools for all code reading, traversal, and editing tasks. This is non-negotiable.**

- Use `mcp__serena__get_symbols_overview` to understand file structure before reading
- Use `mcp__serena__find_symbol` to locate specific functions, classes, or methods
- Use `mcp__serena__search_for_pattern` when you don't know the exact symbol name
- Use `mcp__serena__find_referencing_symbols` to trace usages and call sites
- Use `mcp__serena__replace_symbol_body` to replace an entire function or class
- Use `mcp__serena__insert_after_symbol` / `mcp__serena__insert_before_symbol` to add code
- Only fall back to `Read` / `Edit` / `Grep` for non-code files or when a targeted symbol read is not possible

Do **not** read entire source files to understand structure. Use Serena's symbol tools to navigate precisely and avoid loading unnecessary code into context.

## Development

Run commands directly—don't tell the user to run them.

```bash
npm run dev          # Run with hot reload
npm run build        # Compile TypeScript
npm run typecheck    # Type-check without emitting
npm run test         # Run all tests
npm run format       # Format source files
./container/build.sh # Rebuild agent container
```

Run a single test file:
```bash
npx vitest run src/container-runner.test.ts
```

Skills tests use a separate config:
```bash
npx vitest run --config vitest.skills.config.ts
```

Service management:
```bash
# macOS (launchd)
launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist
launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist
launchctl kickstart -k gui/$(id -u)/com.nanoclaw  # restart

# Linux (systemd)
systemctl --user start nanoclaw
systemctl --user stop nanoclaw
systemctl --user restart nanoclaw
```

## Deploying changes to `container/agent-runner/src/`

Each group has a live copy of the agent-runner source at `data/sessions/{group}/agent-runner-src/` that is mounted into the container at runtime. This copy is created **once** on first run and is never overwritten automatically — so changes to `container/agent-runner/src/` do **not** reach existing groups until you sync manually.

After merging any PR or making any change that touches `container/agent-runner/src/`, run the full deploy sequence:

```bash
# 1. Sync session copies with the updated canonical source
for dir in data/sessions/*/agent-runner-src; do cp -r container/agent-runner/src/. "$dir/"; done

# 2. Compile host TypeScript
npm run build

# 3. Rebuild the agent container image
./container/build.sh

# 4. Restart the service
# macOS:
launchctl kickstart -k gui/$(id -u)/com.nanoclaw
# Linux:
systemctl --user restart nanoclaw
```

Skip step 1 if your changes are only in `src/` (host code). Skip steps 2–3 if your changes are only in `container/agent-runner/src/` (container code). Always run step 4.

## Container Build Cache

The container buildkit caches the build context aggressively. `--no-cache` alone does NOT invalidate COPY steps — the builder's volume retains stale files. To force a truly clean rebuild, prune the builder then re-run `./container/build.sh`.
