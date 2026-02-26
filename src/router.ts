import { Channel, NewMessage } from './types.js';
/* ved custom */
import { storeMessage } from './db.js';
/* ved custom end */
/* ved custom */
import { TIMEZONE } from './config.js';

/** Format UTC ISO timestamp as local date-time string for agent prompts.
 * Prevents Claude from misreading UTC Z timestamps as local time.
 * Falls back to the raw string if the input is not a valid date.
 * Seconds are intentionally omitted — minute precision is sufficient
 * for conversational context; scheduling uses cron/interval values, not these strings.
 */
function toLocalTime(isoStr: string): string {
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return isoStr;
  return d.toLocaleString('sv-SE', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}
/* ved custom end */

export function escapeXml(s: string): string {
  if (!s) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatMessages(messages: NewMessage[]): string {
  const lines = messages.map(
    (m) =>
      `<message sender="${escapeXml(m.sender_name)}" time="${toLocalTime(m.timestamp)}">${escapeXml(m.content)}</message>`,
  );
  return `<messages>\n${lines.join('\n')}\n</messages>`;
}

export function stripInternalTags(text: string): string {
  return text.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
}

export function formatOutbound(rawText: string): string {
  const text = stripInternalTags(rawText);
  if (!text) return '';
  return text;
}

export async function routeOutbound(
  channels: Channel[],
  jid: string,
  text: string,
): Promise<void> {
  const channel = channels.find((c) => c.ownsJid(jid) && c.isConnected());
  if (!channel) throw new Error(`No channel for JID: ${jid}`);
  await channel.sendMessage(jid, text);
  /* ved custom */
  storeMessage({
    id: `bot-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    chat_jid: jid,
    sender: 'assistant',
    sender_name: 'Assistant',
    content: text,
    timestamp: new Date().toISOString(),
    is_from_me: true,
    is_bot_message: true,
  });
  /* ved custom end */
}

export function findChannel(
  channels: Channel[],
  jid: string,
): Channel | undefined {
  return channels.find((c) => c.ownsJid(jid));
}
