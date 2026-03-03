# Telegram Message Streaming Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace per-chunk Telegram messages with progressive message editing — the first result chunk sends a new message and subsequent chunks edit it in place, giving users a ChatGPT-like streaming UX.

**Architecture:** Add `sendMessageWithId` and `editMessage` to `TelegramChannel` (with `/* ved custom */` markers). Extract streaming accumulator logic into a testable `buildStreamingOnOutput` factory in `src/streaming-channel.ts`. Wire the factory into `processGroupMessages` via duck-typing. The upstream `Channel` interface is untouched; non-Telegram channels fall back to existing behavior automatically.

**Tech Stack:** grammy (Telegram bot library), Vitest, TypeScript

---

## Before You Start

Read these files to orient yourself:
- `src/channels/telegram.ts` — `TelegramChannel` class, `sendMessage` method (lines 338–363)
- `src/index.ts` — `processGroupMessages` function (lines 249–376), particularly the `onOutput` callback
- `docs/plans/2026-03-03-telegram-streaming-design.md` — approved design doc

**Critical: every new or modified block in `src/` MUST be wrapped in `/* ved custom */` ... `/* ved custom end */` markers. No exceptions.**

Run tests with: `npx vitest run <file>`
Run typecheck with: `npm run typecheck`

---

## Task 1: Add `sendMessageWithId` to TelegramChannel

**Files:**
- Create: `src/channels/telegram.test.ts`
- Modify: `src/channels/telegram.ts` (after line 363, inside the class)

### Step 1: Write the failing test

Create `src/channels/telegram.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TelegramChannel } from './telegram.js';

function makeTelegramChannel() {
  const channel = new TelegramChannel({
    onMessage: vi.fn(),
    onChatMetadata: vi.fn(),
    registeredGroups: () => ({}),
  });

  // Inject a mock bot directly — avoids real Telegram connection
  const mockApi = {
    sendMessage: vi.fn(),
    editMessageText: vi.fn(),
  };
  (channel as any).bot = { api: mockApi };

  return { channel, mockApi };
}

describe('TelegramChannel.sendMessageWithId', () => {
  it('sends a message and returns its message_id', async () => {
    const { channel, mockApi } = makeTelegramChannel();
    mockApi.sendMessage.mockResolvedValue({ message_id: 42 });

    const id = await channel.sendMessageWithId('tg:123', 'hello');

    expect(mockApi.sendMessage).toHaveBeenCalledWith('123', 'hello');
    expect(id).toBe(42);
  });

  it('splits long messages and returns the first message_id', async () => {
    const { channel, mockApi } = makeTelegramChannel();
    mockApi.sendMessage.mockResolvedValue({ message_id: 10 });

    const longText = 'x'.repeat(5000); // exceeds 4096
    const id = await channel.sendMessageWithId('tg:123', longText);

    expect(mockApi.sendMessage).toHaveBeenCalledTimes(2);
    expect(id).toBe(10);
  });

  it('returns undefined when bot is not initialized', async () => {
    const channel = new TelegramChannel({
      onMessage: vi.fn(),
      onChatMetadata: vi.fn(),
      registeredGroups: () => ({}),
    });
    // bot is null by default

    const id = await channel.sendMessageWithId('tg:123', 'hello');

    expect(id).toBeUndefined();
  });
});
```

### Step 2: Run test to verify it fails

```bash
npx vitest run src/channels/telegram.test.ts
```

Expected: FAIL — `channel.sendMessageWithId is not a function`

### Step 3: Implement `sendMessageWithId`

In `src/channels/telegram.ts`, add after the `sendMessage` method (after line 363) but still inside the class:

```typescript
  /* ved custom */
  async sendMessageWithId(jid: string, text: string): Promise<number | undefined> {
    if (!this.bot) {
      logger.warn('Telegram bot not initialized');
      return undefined;
    }

    try {
      const numericId = jid.replace(/^tg:/, '');
      const MAX_LENGTH = 4096;

      if (text.length <= MAX_LENGTH) {
        const msg = await this.bot.api.sendMessage(numericId, text);
        return msg.message_id;
      }

      // Split: send first chunk, capture ID; send remaining chunks silently
      let firstId: number | undefined;
      for (let i = 0; i < text.length; i += MAX_LENGTH) {
        const msg = await this.bot.api.sendMessage(numericId, text.slice(i, i + MAX_LENGTH));
        if (firstId === undefined) firstId = msg.message_id;
      }
      return firstId;
    } catch (err) {
      logger.error({ jid, err }, 'Failed to send Telegram message (streaming)');
      return undefined;
    }
  }
  /* ved custom end */
```

### Step 4: Run test to verify it passes

```bash
npx vitest run src/channels/telegram.test.ts
```

Expected: tests for `sendMessageWithId` pass (editMessage tests will fail — that's fine for now)

### Step 5: Commit

```bash
git add src/channels/telegram.ts src/channels/telegram.test.ts
git commit -m "feat: add sendMessageWithId to TelegramChannel"
```

---

## Task 2: Add `editMessage` to TelegramChannel

**Files:**
- Modify: `src/channels/telegram.ts` (after `sendMessageWithId`, inside the class)
- Modify: `src/channels/telegram.test.ts` (add new describe block)

### Step 1: Write the failing test

Add to `src/channels/telegram.test.ts`:

```typescript
describe('TelegramChannel.editMessage', () => {
  it('calls editMessageText with correct args', async () => {
    const { channel, mockApi } = makeTelegramChannel();
    mockApi.editMessageText.mockResolvedValue({});

    await channel.editMessage('tg:123', 42, 'updated text');

    expect(mockApi.editMessageText).toHaveBeenCalledWith('123', 42, 'updated text');
  });

  it('does not throw when message is not found (400 error)', async () => {
    const { channel, mockApi } = makeTelegramChannel();
    const err = Object.assign(new Error('Bad Request: message to edit not found'), {
      error_code: 400,
    });
    mockApi.editMessageText.mockRejectedValue(err);

    // Should not throw
    await expect(channel.editMessage('tg:123', 42, 'text')).resolves.toBeUndefined();
  });

  it('does nothing when bot is not initialized', async () => {
    const channel = new TelegramChannel({
      onMessage: vi.fn(),
      onChatMetadata: vi.fn(),
      registeredGroups: () => ({}),
    });

    await expect(channel.editMessage('tg:123', 42, 'text')).resolves.toBeUndefined();
  });
});
```

### Step 2: Run test to verify it fails

```bash
npx vitest run src/channels/telegram.test.ts
```

Expected: FAIL — `channel.editMessage is not a function`

### Step 3: Implement `editMessage`

In `src/channels/telegram.ts`, add after `sendMessageWithId`, still inside the class:

```typescript
  /* ved custom */
  async editMessage(jid: string, messageId: number, text: string): Promise<void> {
    if (!this.bot) return;

    try {
      const numericId = jid.replace(/^tg:/, '');
      await this.bot.api.editMessageText(numericId, messageId, text);
    } catch (err) {
      logger.warn({ jid, messageId, err }, 'Failed to edit Telegram message (streaming)');
      // Swallow — caller handles recovery
    }
  }
  /* ved custom end */
```

### Step 4: Run test to verify it passes

```bash
npx vitest run src/channels/telegram.test.ts
```

Expected: all tests pass

### Step 5: Commit

```bash
git add src/channels/telegram.ts src/channels/telegram.test.ts
git commit -m "feat: add editMessage to TelegramChannel"
```

---

## Task 3: Streaming output handler utility

This task extracts the streaming accumulation logic into a testable factory function. It is the core of the feature.

**Files:**
- Create: `src/streaming-channel.ts`
- Create: `src/streaming-channel.test.ts`

### Step 1: Write the failing tests

Create `src/streaming-channel.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isStreamingCapable, buildStreamingOnOutput } from './streaming-channel.js';
import type { Channel } from './types.js';
import type { ContainerOutput } from './container-runner.js';

// Minimal Channel stub
function makeBaseChannel(): Channel {
  return {
    name: 'mock',
    connect: vi.fn(),
    disconnect: vi.fn(),
    isConnected: vi.fn().mockReturnValue(true),
    ownsJid: vi.fn().mockReturnValue(true),
    sendMessage: vi.fn().mockResolvedValue(undefined),
  };
}

// Streaming-capable channel stub
function makeStreamingChannel() {
  const base = makeBaseChannel();
  return Object.assign(base, {
    sendMessageWithId: vi.fn(),
    editMessage: vi.fn().mockResolvedValue(undefined),
  });
}

describe('isStreamingCapable', () => {
  it('returns true for a channel with sendMessageWithId', () => {
    expect(isStreamingCapable(makeStreamingChannel())).toBe(true);
  });

  it('returns false for a base channel without sendMessageWithId', () => {
    expect(isStreamingCapable(makeBaseChannel())).toBe(false);
  });
});

describe('buildStreamingOnOutput', () => {
  const JID = 'tg:123';

  function makeOutput(result: string | null, status: 'success' | 'error' = 'success'): ContainerOutput {
    return { status, result, newSessionId: undefined };
  }

  describe('first chunk', () => {
    it('calls sendMessageWithId and captures the message ID', async () => {
      const channel = makeStreamingChannel();
      channel.sendMessageWithId.mockResolvedValue(42);

      const handler = buildStreamingOnOutput(channel, JID);
      await handler(makeOutput('hello'));

      expect(channel.sendMessageWithId).toHaveBeenCalledWith(JID, 'hello');
      expect(channel.editMessage).not.toHaveBeenCalled();
    });
  });

  describe('second chunk', () => {
    it('calls editMessage with accumulated text', async () => {
      const channel = makeStreamingChannel();
      channel.sendMessageWithId.mockResolvedValue(42);

      const handler = buildStreamingOnOutput(channel, JID);
      await handler(makeOutput('first'));
      await handler(makeOutput('second'));

      expect(channel.editMessage).toHaveBeenCalledWith(JID, 42, 'first\n\nsecond');
    });
  });

  describe('4096 char overflow', () => {
    it('starts a new message when accumulated text exceeds 4096 chars', async () => {
      const channel = makeStreamingChannel();
      channel.sendMessageWithId.mockResolvedValue(1).mockResolvedValueOnce(1).mockResolvedValueOnce(2);

      const handler = buildStreamingOnOutput(channel, JID);
      await handler(makeOutput('x'.repeat(4000))); // first message, id=1
      await handler(makeOutput('y'.repeat(200)));  // would push to 4200, exceeds limit → new message, id=2
      await handler(makeOutput('small'));           // edits message 2

      expect(channel.sendMessageWithId).toHaveBeenCalledTimes(2);
      expect(channel.editMessage).toHaveBeenLastCalledWith(JID, 2, expect.stringContaining('small'));
    });
  });

  describe('editMessage failure recovery', () => {
    it('resets streamMsgId and sends new message on edit failure', async () => {
      const channel = makeStreamingChannel();
      channel.sendMessageWithId
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(20);
      channel.editMessage.mockRejectedValueOnce(new Error('not found'));

      const handler = buildStreamingOnOutput(channel, JID);
      await handler(makeOutput('first'));   // sends → id=10
      await handler(makeOutput('second')); // edit fails → sends new → id=20
      await handler(makeOutput('third'));  // edits id=20

      expect(channel.sendMessageWithId).toHaveBeenCalledTimes(2);
      expect(channel.editMessage).toHaveBeenCalledTimes(2);
    });
  });

  describe('empty text after strip', () => {
    it('skips chunks with only whitespace', async () => {
      const channel = makeStreamingChannel();
      const handler = buildStreamingOnOutput(channel, JID);
      await handler(makeOutput('   '));

      expect(channel.sendMessageWithId).not.toHaveBeenCalled();
    });
  });

  describe('non-streaming channel fallback', () => {
    it('returns null for channels without sendMessageWithId', () => {
      const base = makeBaseChannel();
      const result = buildStreamingOnOutput(base, JID);
      expect(result).toBeNull();
    });
  });
});
```

### Step 2: Run test to verify it fails

```bash
npx vitest run src/streaming-channel.test.ts
```

Expected: FAIL — module not found

### Step 3: Implement `src/streaming-channel.ts`

Create `src/streaming-channel.ts`:

```typescript
import { logger } from './logger.js';
import type { Channel } from './types.js';
import type { ContainerOutput } from './container-runner.js';

const MAX_TELEGRAM_LENGTH = 4096;

export interface StreamingCapable {
  sendMessageWithId(jid: string, text: string): Promise<number | undefined>;
  editMessage(jid: string, messageId: number, text: string): Promise<void>;
}

export function isStreamingCapable(ch: Channel): ch is Channel & StreamingCapable {
  return typeof (ch as any).sendMessageWithId === 'function';
}

/**
 * Returns an onOutput handler that accumulates result chunks into a single
 * Telegram message, editing it progressively. Returns null if the channel
 * does not support streaming (caller falls back to sendMessage).
 */
export function buildStreamingOnOutput(
  channel: Channel,
  jid: string,
): ((output: ContainerOutput) => Promise<void>) | null {
  if (!isStreamingCapable(channel)) return null;

  const streaming = channel as Channel & StreamingCapable;
  let streamMsgId: number | undefined;
  let streamAccumulated = '';

  return async (output: ContainerOutput) => {
    if (!output.result) return;

    const raw = typeof output.result === 'string'
      ? output.result
      : JSON.stringify(output.result);

    // Strip <internal> blocks — same logic as processGroupMessages
    const text = raw.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
    if (!text) return;

    const separator = streamAccumulated ? '\n\n' : '';
    const candidate = streamAccumulated + separator + text;

    // If adding the new chunk would overflow the Telegram limit, start fresh
    if (candidate.length > MAX_TELEGRAM_LENGTH) {
      const newId = await streaming.sendMessageWithId(jid, text);
      streamMsgId = newId;
      streamAccumulated = text;
      return;
    }

    streamAccumulated = candidate;

    if (streamMsgId === undefined) {
      // First chunk — send new message
      const newId = await streaming.sendMessageWithId(jid, streamAccumulated);
      streamMsgId = newId;
    } else {
      // Subsequent chunk — edit existing message
      try {
        await streaming.editMessage(jid, streamMsgId, streamAccumulated);
      } catch (err) {
        logger.warn({ jid, streamMsgId, err }, 'editMessage failed, starting new message');
        const newId = await streaming.sendMessageWithId(jid, text);
        streamMsgId = newId;
        streamAccumulated = text;
      }
    }
  };
}
```

### Step 4: Run test to verify it passes

```bash
npx vitest run src/streaming-channel.test.ts
```

Expected: all tests pass

### Step 5: Typecheck

```bash
npm run typecheck
```

Expected: no errors

### Step 6: Commit

```bash
git add src/streaming-channel.ts src/streaming-channel.test.ts
git commit -m "feat: add streaming channel utility with buildStreamingOnOutput"
```

---

## Task 4: Wire streaming into `processGroupMessages`

**Files:**
- Modify: `src/index.ts` — `processGroupMessages` function (lines 249–376)

### Step 1: Locate the onOutput callback in processGroupMessages

In `src/index.ts`, find the `onOutput` callback inside `processGroupMessages`. It currently starts:

```typescript
const output = await runAgent(group, prompt, chatJid, async (result) => {
    // Streaming output callback — called for each agent result
    if (result.result) {
      const raw = ...
      const text = raw.replace(...)
      ...
      if (text) {
        await channel.sendMessage(chatJid, text);
```

### Step 2: Add import for streaming utility

At the top of `src/index.ts`, find the existing imports block. Add the streaming import inside `/* ved custom */` markers near other custom imports:

```typescript
/* ved custom */
import { buildStreamingOnOutput } from './streaming-channel.js';
/* ved custom end */
```

### Step 3: Replace the onOutput callback in processGroupMessages

Wrap the existing `runAgent` call's `onOutput` with streaming logic. Replace from `const output = await runAgent(...)` through the callback, keeping `outputSentToUser` tracking intact.

The new block (inside `/* ved custom */` markers around only the streaming-specific additions):

```typescript
  /* ved custom */
  const streamingOnOutput = buildStreamingOnOutput(channel, chatJid);
  /* ved custom end */

  const output = await runAgent(group, prompt, chatJid, async (result) => {
    // Streaming output callback — called for each agent result
    if (result.result) {
      /* ved custom */
      if (streamingOnOutput) {
        // Progressive editing path: accumulate chunks into one Telegram message
        await streamingOnOutput(result);
        outputSentToUser = true;
        resetIdleTimer();
      } else {
      /* ved custom end */
        const raw =
          typeof result.result === 'string'
            ? result.result
            : JSON.stringify(result.result);
        // Strip <internal>...</internal> blocks — agent uses these for internal reasoning
        const text = raw.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
        logger.info({ group: group.name }, `Agent output: ${raw.slice(0, 200)}`);
        if (text) {
          await channel.sendMessage(chatJid, text);
          /* ved custom */
          try {
            storeMessage({
              id: `bot-${new Date().toISOString()}-${Math.random().toString(36).slice(2)}`,
              chat_jid: chatJid,
              sender: 'assistant',
              sender_name: 'Assistant',
              content: text,
              timestamp: new Date().toISOString(),
              is_from_me: true,
              is_bot_message: true,
            });
          } catch {
            // persistence is best-effort
          }
          /* ved custom end */
          outputSentToUser = true;
        }
        // Only reset idle timer on actual results, not session-update markers (result: null)
        resetIdleTimer();
      /* ved custom */
      }
      /* ved custom end */
    }

    if (result.status === 'error') {
      hadError = true;
    }
  });
```

**Important:** The non-streaming path (the `else` branch) must be left exactly as it was, including the existing `/* ved custom */` storeMessage block already in the code.

### Step 4: Typecheck

```bash
npm run typecheck
```

Expected: no errors. Fix any type issues before continuing.

### Step 5: Run full test suite

```bash
npm run test
```

Expected: all existing tests pass plus the new ones.

### Step 6: Commit

```bash
git add src/index.ts
git commit -m "feat: wire Telegram streaming into processGroupMessages"
```

---

## Task 5: Manual smoke test

### Step 1: Build

```bash
npm run build
```

### Step 2: Restart service and verify logs

```bash
launchctl kickstart -k gui/$(id -u)/com.nanoclaw
```

Send a message from Telegram that requires a non-trivial agent response (e.g., "summarize the last 5 messages").

Watch logs for:
```
Telegram message sent   ← sendMessageWithId
Failed to edit Telegram message (streaming)  ← only if something goes wrong
```

And in Telegram: you should see a single message appear and its content grow as the agent responds.

### Step 3: Verify ved custom marker count didn't decrease

```bash
grep -rn "ved custom" src/ container/ --include="*.ts" --include="Dockerfile" --include="*.sh" | wc -l
```

Compare against the known count. The number should be **higher** than before (new markers added).

### Step 4: Final commit if smoke test passes

```bash
git add -A
git commit -m "chore: verify telegram streaming smoke test passed"
```

---

## Summary of Changes

| File | Action | Markers |
|------|--------|---------|
| `src/channels/telegram.ts` | Add `sendMessageWithId` + `editMessage` | `/* ved custom */` |
| `src/channels/telegram.test.ts` | Create new test file | N/A (new custom file) |
| `src/streaming-channel.ts` | Create utility module | N/A (new custom file) |
| `src/streaming-channel.test.ts` | Create test file | N/A (new custom file) |
| `src/index.ts` | Wire streaming into `processGroupMessages` | `/* ved custom */` |
