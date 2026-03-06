# Sentry Issues Monitor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a scheduled task that fetches unresolved Sentry issues from the last 2 hours every 2 hours and sends a formatted summary to Telegram.

**Architecture:** New module `src/sentry-monitor.ts` calls the Sentry REST API directly from the host process. A special prompt token `__SENTRY_ISSUES__` is intercepted in `task-scheduler.ts` (before spawning a container) — same pattern as `__DEVTEAM_ORCHESTRATOR__`. Config constants are added to `src/config.ts`. All upstream-file edits use `/* ved custom */` markers.

**Tech Stack:** Node.js `fetch` (built-in), Sentry REST API v0, vitest, SQLite via `createTask` from `./db.js`.

---

### Task 1: Add Sentry config constants to `src/config.ts`

> Before editing: run `/ved-add-customization` mentally — wrap all changes in `/* ved custom */` markers.

**Files:**
- Modify: `src/config.ts`

**Step 1: Add keys to `readEnvFile` call**

In `src/config.ts`, the `readEnvFile([...])` call ends at line 28 with the LOG_VIEWER block. Add a new `/* ved custom */` block with the two Sentry keys inside the array, just before the closing `])`:

```typescript
  /* ved custom */
  'SENTRY_ACCESS_TOKEN',
  'SENTRY_ORG_SLUG',
  /* ved custom end */
```

**Step 2: Export constants**

After the `LOG_VIEWER_PORT` constant (currently the last constant around line 130), add:

```typescript
/* ved custom */
export const SENTRY_ACCESS_TOKEN =
  process.env.SENTRY_ACCESS_TOKEN || envConfig.SENTRY_ACCESS_TOKEN || '';
export const SENTRY_ORG_SLUG =
  process.env.SENTRY_ORG_SLUG || envConfig.SENTRY_ORG_SLUG || '';
/* ved custom end */
```

**Step 3: Build and typecheck**

```bash
npm run typecheck
```

Expected: no errors.

**Step 4: Commit**

```bash
git add .
git commit -m "feat: add SENTRY_ACCESS_TOKEN and SENTRY_ORG_SLUG to config"
```

---

### Task 2: Create `src/sentry-monitor.ts` with tests

**Files:**
- Create: `src/sentry-monitor.ts`
- Create: `src/sentry-monitor.test.ts`

**Step 1: Write the failing tests**

Create `src/sentry-monitor.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock config module
vi.mock('./config.js', () => ({
  SENTRY_ACCESS_TOKEN: 'test-token',
  SENTRY_ORG_SLUG: 'test-org',
}));

describe('runSentryMonitor', () => {
  let sendMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sendMessage = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends all-clear message when no issues found', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => [],
    } as any);

    const { runSentryMonitor } = await import('./sentry-monitor.js');
    const result = await runSentryMonitor('group@g.us', sendMessage);

    expect(sendMessage).toHaveBeenCalledOnce();
    expect(sendMessage.mock.calls[0][1]).toContain('All clear');
    expect(result).toContain('0 issues');
  });

  it('formats and sends issues when found', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => [
        {
          id: '123',
          title: 'NullPointerException in checkout',
          project: { slug: 'backend' },
          count: '42',
          userCount: 7,
          permalink: 'https://sentry.io/organizations/test-org/issues/123/',
        },
      ],
    } as any);

    const { runSentryMonitor } = await import('./sentry-monitor.js');
    const result = await runSentryMonitor('group@g.us', sendMessage);

    expect(sendMessage).toHaveBeenCalledOnce();
    const msg = sendMessage.mock.calls[0][1];
    expect(msg).toContain('1 unresolved issue');
    expect(msg).toContain('NullPointerException in checkout');
    expect(msg).toContain('backend');
    expect(msg).toContain('42');
    expect(result).toContain('1 issues');
  });

  it('sends error message when token is missing', async () => {
    vi.mock('./config.js', () => ({
      SENTRY_ACCESS_TOKEN: '',
      SENTRY_ORG_SLUG: 'test-org',
    }));

    const { runSentryMonitor } = await import('./sentry-monitor.js');
    const result = await runSentryMonitor('group@g.us', sendMessage);

    expect(sendMessage).toHaveBeenCalledOnce();
    expect(sendMessage.mock.calls[0][1]).toContain('SENTRY_ACCESS_TOKEN');
    expect(result).toContain('error');
  });

  it('sends error message when Sentry API returns non-ok response', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 401,
    } as any);

    const { runSentryMonitor } = await import('./sentry-monitor.js');
    const result = await runSentryMonitor('group@g.us', sendMessage);

    expect(sendMessage).toHaveBeenCalledOnce();
    expect(sendMessage.mock.calls[0][1]).toContain('401');
    expect(result).toContain('error');
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npx vitest run src/sentry-monitor.test.ts
```

Expected: FAIL — `Cannot find module './sentry-monitor.js'`

**Step 3: Implement `src/sentry-monitor.ts`**

```typescript
import { SENTRY_ACCESS_TOKEN, SENTRY_ORG_SLUG } from './config.js';

interface SentryIssue {
  id: string;
  title: string;
  project: { slug: string };
  count: string;
  userCount: number;
  permalink: string;
}

function formatIssues(issues: SentryIssue[]): string {
  if (issues.length === 0) {
    return 'All clear — no new unresolved issues in the last 2 hours.';
  }

  const count = issues.length;
  const header = `*Sentry Issues — Last 2h*\n${count} unresolved issue${count === 1 ? '' : 's'} found\n`;

  const lines = issues.map((issue, i) => {
    return [
      `${i + 1}. [${issue.project.slug}] ${issue.title}`,
      `   Events: ${issue.count} | Users: ${issue.userCount}`,
      `   ${issue.permalink}`,
    ].join('\n');
  });

  return header + '\n' + lines.join('\n\n');
}

export async function runSentryMonitor(
  chatJid: string,
  sendMessage: (jid: string, text: string) => Promise<void>,
): Promise<string> {
  if (!SENTRY_ACCESS_TOKEN) {
    const msg = 'Sentry monitor error: SENTRY_ACCESS_TOKEN is not configured.';
    await sendMessage(chatJid, msg);
    return 'error: missing token';
  }

  if (!SENTRY_ORG_SLUG) {
    const msg = 'Sentry monitor error: SENTRY_ORG_SLUG is not configured.';
    await sendMessage(chatJid, msg);
    return 'error: missing org slug';
  }

  const url =
    `https://sentry.io/api/0/organizations/${SENTRY_ORG_SLUG}/issues/` +
    `?query=is%3Aunresolved+lastSeen%3A-2h&limit=25&expand=owners`;

  let issues: SentryIssue[];

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${SENTRY_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const msg = `Sentry monitor error: API returned ${response.status}.`;
      await sendMessage(chatJid, msg);
      return `error: HTTP ${response.status}`;
    }

    issues = (await response.json()) as SentryIssue[];
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await sendMessage(chatJid, `Sentry monitor error: ${message}`);
    return `error: ${message}`;
  }

  const text = formatIssues(issues);
  await sendMessage(chatJid, text);
  return `${issues.length} issues`;
}
```

**Step 4: Run tests to verify they pass**

```bash
npx vitest run src/sentry-monitor.test.ts
```

Expected: all 4 tests PASS.

**Step 5: Run full test suite**

```bash
npm run test
```

Expected: all tests pass (no regressions).

**Step 6: Commit**

```bash
git add .
git commit -m "feat: add sentry-monitor module with tests"
```

---

### Task 3: Intercept `__SENTRY_ISSUES__` in `src/task-scheduler.ts`

> This is an upstream file. All edits MUST use `/* ved custom */` markers.

**Files:**
- Modify: `src/task-scheduler.ts`

**Step 1: Add import at top of file**

Find the existing `/* ved custom */` import block near the top of `task-scheduler.ts` (look for the devteam imports). Add `runSentryMonitor` to that block or create a new `/* ved custom */` block:

```typescript
/* ved custom */
import { runSentryMonitor } from './sentry-monitor.js';
/* ved custom end */
```

**Step 2: Add intercept block**

In `runTask`, locate the `/* ved custom end */` that closes the `__DEVTEAM_ORCHESTRATOR__` block (around line 215). Immediately after it, add:

```typescript
/* ved custom */
if (task.prompt === '__SENTRY_ISSUES__') {
  try {
    const result = await runSentryMonitor(task.chat_jid, deps.sendMessage);
    logTaskRun({
      task_id: task.id,
      run_at: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      status: 'success',
      result: result.slice(0, 200),
      error: null,
    });
    const nextRun = new Date(
      Date.now() + parseInt(task.schedule_value, 10),
    ).toISOString();
    updateTaskAfterRun(task.id, nextRun, result.slice(0, 200));
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logTaskRun({
      task_id: task.id,
      run_at: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      status: 'error',
      result: null,
      error,
    });
    const nextRun = new Date(
      Date.now() + parseInt(task.schedule_value, 10),
    ).toISOString();
    updateTaskAfterRun(task.id, nextRun, `Error: ${error.slice(0, 150)}`);
  }
  return;
}
/* ved custom end */
```

**Step 3: Build and typecheck**

```bash
npm run typecheck
```

Expected: no errors.

**Step 4: Run full test suite**

```bash
npm run test
```

Expected: all tests pass.

**Step 5: Commit**

```bash
git add .
git commit -m "feat: intercept __SENTRY_ISSUES__ prompt in task-scheduler"
```

---

### Task 4: Insert scheduled task into SQLite

**Files:**
- Modify: `store/messages.db` (via sqlite3 CLI)

**Step 1: Generate a unique task ID**

```bash
node -e "console.log('sentry-issues-' + Date.now())"
```

Note the output, e.g. `sentry-issues-1741262400000`.

**Step 2: Find your group's chat_jid**

```bash
sqlite3 store/messages.db "SELECT chat_jid, group_folder FROM registered_groups;"
```

Note the `chat_jid` for your main group (the one that receives Telegram messages).

**Step 3: Insert the task**

Replace `<TASK_ID>`, `<CHAT_JID>`, and `<GROUP_FOLDER>` with values from above steps:

```bash
sqlite3 store/messages.db "
INSERT INTO scheduled_tasks
  (id, group_folder, chat_jid, prompt, schedule_type, schedule_value, context_mode, next_run, last_run, last_result, status, created_at)
VALUES
  ('<TASK_ID>', '<GROUP_FOLDER>', '<CHAT_JID>', '__SENTRY_ISSUES__', 'interval', '7200000', 'isolated',
   datetime('now'), NULL, NULL, 'active', datetime('now'));
"
```

**Step 4: Verify insertion**

```bash
sqlite3 store/messages.db "SELECT id, prompt, schedule_type, schedule_value, status FROM scheduled_tasks WHERE prompt = '__SENTRY_ISSUES__';"
```

Expected: one row with the task.

---

### Task 5: Build, deploy and smoke test

**Step 1: Build**

```bash
npm run build
```

**Step 2: Restart service**

```bash
launchctl kickstart -k gui/$(id -u)/com.nanoclaw
```

**Step 3: Trigger a manual run**

Force `next_run` to now so the scheduler picks it up in the next poll:

```bash
sqlite3 store/messages.db "UPDATE scheduled_tasks SET next_run = datetime('now', '-1 minute') WHERE prompt = '__SENTRY_ISSUES__';"
```

**Step 4: Watch logs**

```bash
tail -f ~/Library/Logs/Claude/mcp-server-nanoclaw.log | grep -i sentry
```

Expected: log lines showing the task running and a message sent to Telegram.

**Step 5: Verify message in Telegram**

Check your Telegram group — you should receive either a list of issues or the "All clear" message.

**Step 6: Final commit (if any files changed during smoke test)**

```bash
git add .
git commit -m "chore: verify sentry monitor smoke test"
```
