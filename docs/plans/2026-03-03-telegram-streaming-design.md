# Telegram Message Streaming — Design

**Date:** 2026-03-03
**Status:** Approved

## Problem

Currently, each result chunk from the Claude agent is sent as a separate Telegram message. This creates a fragmented UX. The goal is to give users a "progressive editing" experience: a single message appears and grows as the agent generates content — similar to ChatGPT web.

## Approach: Duck-typed optional streaming on TelegramChannel

The upstream `Channel` interface (`src/types.ts`) is left untouched. `TelegramChannel` gains two new optional methods (wrapped in `/* ved custom */` markers). `processGroupMessages` detects streaming capability via duck-typing and activates the streaming path if available, falling back to the current `sendMessage` behavior otherwise.

## What Changes

### `src/channels/telegram.ts`

Two new methods, added with `/* ved custom */` markers:

```typescript
// Sends a message and returns the Telegram message_id
async sendMessageWithId(jid: string, text: string): Promise<number | undefined>

// Edits an existing message with full replacement text
async editMessage(jid: string, messageId: number, text: string): Promise<void>
```

`sendMessageWithId` respects the 4096-char limit: if the text exceeds it, it splits and returns the ID of the first chunk.

`editMessage` catches 400 "message not found" errors silently (warn-level log only).

### `src/index.ts`

`processGroupMessages` gains streaming state in its closure (wrapped in `/* ved custom */`):

```typescript
let streamMsgId: number | undefined;
let streamAccumulated = '';
```

Duck-type detection:

```typescript
interface StreamingCapable {
  sendMessageWithId(jid: string, text: string): Promise<number | undefined>;
  editMessage(jid: string, messageId: number, text: string): Promise<void>;
}

function isStreamingCapable(ch: Channel): ch is Channel & StreamingCapable {
  return typeof (ch as any).sendMessageWithId === 'function';
}
```

`onOutput` streaming logic:

- **First chunk:** `sendMessageWithId` → capture `streamMsgId`
- **Subsequent chunks:** accumulate text, call `editMessage(streamMsgId, accumulated)`
- **4096-char overflow:** start a new message, reset `streamMsgId` and accumulator
- **`editMessage` failure:** log warn, reset `streamMsgId`, send chunk as new message and continue

## Data Flow

```
User sends message
  → processGroupMessages starts
  → setTyping(true)
  → streamMsgId = undefined, streamAccumulated = ''

Container emits result chunk #1
  → streamAccumulated = chunk1
  → sendMessageWithId(jid, chunk1) → streamMsgId = 42

Container emits result chunk #2
  → streamAccumulated = chunk1 + '\n\n' + chunk2
  → editMessage(jid, 42, streamAccumulated)

...repeat for N chunks...

Container finishes
  → setTyping(false)
  → streamMsgId and streamAccumulated are local to closure → discarded
```

## Edge Cases

| Scenario | Handling |
|----------|----------|
| `editMessage` fails (deleted msg, network) | Warn log, reset ID, send new message |
| `sendMessageWithId` fails on first chunk | Same as current `sendMessage` failure |
| Text > 4096 chars | Start new message, reset accumulator |
| Empty chunk after `<internal>` strip | Existing `if (text)` guard handles it |
| Multiple groups running concurrently | State is local to each closure invocation — no shared state |
| Channel without `sendMessageWithId` | Falls back to current `sendMessage` behavior |

## Rate Limiting

Each result chunk represents a full Claude assistant turn — not individual tokens. Responses rarely produce more than 5–6 chunks. No debounce needed.

## Tests

- `TelegramChannel.sendMessageWithId`: returns numeric message_id, respects 4096-char split
- `TelegramChannel.editMessage`: calls correct API, swallows 400 "not found" errors
- `processGroupMessages` streaming:
  - First chunk → `sendMessageWithId` called, `editMessage` not called
  - Second chunk → `editMessage` called with accumulated text
  - Channel without `sendMessageWithId` → falls back to `sendMessage`

## What Does Not Change

- Upstream `Channel` interface (`src/types.ts`)
- Container and `container/agent-runner/`
- Database schema
- Configuration
- Other channels (automatic fallback)
- Deploy process: `npm run build` + service restart
