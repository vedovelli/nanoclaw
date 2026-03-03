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
): ((output: ContainerOutput) => Promise<boolean>) | null {
  if (!isStreamingCapable(channel)) return null;

  let streamMsgId: number | undefined;
  let streamAccumulated = '';

  return async (output: ContainerOutput): Promise<boolean> => {
    if (!output.result) return false;

    const raw = output.result;

    // Strip <internal> blocks — same logic as processGroupMessages
    const text = raw.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
    if (!text) return false;

    const separator = streamAccumulated ? '\n\n' : '';
    const candidate = streamAccumulated + separator + text;

    // Chunk would overflow the current message — start a new Telegram message.
    // The previous message's content is already visible to the user; only the new chunk goes here.
    if (candidate.length > MAX_TELEGRAM_LENGTH) {
      const newId = await channel.sendMessageWithId(jid, text);
      streamMsgId = newId;
      streamAccumulated = text;
      return true;
    }

    streamAccumulated = candidate;

    if (streamMsgId === undefined) {
      // First chunk — send new message
      const newId = await channel.sendMessageWithId(jid, streamAccumulated);
      streamMsgId = newId;
    } else {
      // Subsequent chunk — edit existing message
      try {
        await channel.editMessage(jid, streamMsgId, streamAccumulated);
      } catch (err) {
        logger.warn({ jid, streamMsgId, err }, 'editMessage failed, starting new message');
        const newId = await channel.sendMessageWithId(jid, text);
        streamMsgId = newId;
        streamAccumulated = text;
      }
    }
    return true;
  };
}
