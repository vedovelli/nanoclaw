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
