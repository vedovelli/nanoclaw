# Sentry Issues Monitor — Design

**Date:** 2026-03-06
**Status:** Approved

## Goal

Scheduled task that runs every 2 hours, fetches unresolved Sentry issues from the last 2 hours across the whole org, and sends a summary to Telegram.

## Approach: Dedicated module + scheduler intercept

Create `src/sentry-monitor.ts` (Opção C), following the same pattern as other host-side task interceptors. A special prompt token (`__SENTRY_ISSUES__`) is intercepted in `task-scheduler.ts` before spawning any container, so the task runs entirely in the host process.

## Architecture

### New file: `src/sentry-monitor.ts`

Exports a single function:

```ts
export async function runSentryMonitor(
  chatJid: string,
  sendMessage: (jid: string, text: string) => Promise<void>,
): Promise<string>
```

Responsibilities:
- Read `SENTRY_ACCESS_TOKEN` and `SENTRY_ORG_SLUG` from config
- Call `GET https://sentry.io/api/0/organizations/{slug}/issues/?query=is:unresolved+lastSeen:-2h&limit=25`
- Format the result as a Telegram-friendly text summary
- Call `sendMessage` with the formatted result
- Return a short summary string for task logging

### Config changes: `src/config.ts`

Add two new exports inside a `/* ved custom */` block:

```ts
export const SENTRY_ACCESS_TOKEN = process.env.SENTRY_ACCESS_TOKEN || envConfig.SENTRY_ACCESS_TOKEN || '';
export const SENTRY_ORG_SLUG = process.env.SENTRY_ORG_SLUG || envConfig.SENTRY_ORG_SLUG || '';
```

Also register both keys in the `readEnvFile([...])` call.

### Scheduler intercept: `src/task-scheduler.ts`

Inside `runTask`, add a `/* ved custom */` block before the `runContainerAgent` call:

```ts
if (task.prompt === '__SENTRY_ISSUES__') {
  const result = await runSentryMonitor(task.chat_jid, deps.sendMessage);
  // log + updateTaskAfterRun
  return;
}
```

### Scheduled task record (SQLite)

Insert once via the Telegram agent or direct SQL:

```
prompt:         __SENTRY_ISSUES__
schedule_type:  interval
schedule_value: 7200000   (2h in ms)
group_folder:   main
context_mode:   isolated
status:         active
```

## Message format

```
*Sentry Issues — Last 2h*
3 unresolved issues found

1. [PROJECT] NullPointerException in checkout
   Events: 42 | Users: 7
   https://sentry.io/organizations/myorg/issues/123/

2. ...

(no issues if list is empty: "All clear — no new issues in the last 2 hours.")
```

## Error handling

- Missing token/org slug: send an error message to Telegram and return early
- HTTP error from Sentry API: send error message with status code
- Empty result: send "all clear" message

## Files changed

| File | Change |
|------|--------|
| `src/config.ts` | Add `SENTRY_ACCESS_TOKEN`, `SENTRY_ORG_SLUG` exports (ved custom) |
| `src/task-scheduler.ts` | Intercept `__SENTRY_ISSUES__` prompt (ved custom) |
| `src/sentry-monitor.ts` | New file — Sentry API fetch + formatting |
| `store/messages.db` | Insert scheduled task record |

## Not in scope

- Auth token rotation / OAuth flow
- Per-project filtering (whole org only)
- Configurable query or limit via Telegram
