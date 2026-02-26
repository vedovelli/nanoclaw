import { Channel, NewMessage } from './types.js';
/* ved custom */
import { storeMessage } from './db.js';
/* ved custom end */

export function escapeXml(s: string): string {
  if (!s) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatMessages(
  messages: NewMessage[],
  /* ved custom */
  recentExchanges?: Array<{ userMessage: string; botMessage: string }>,
  /* ved custom end */
): string {
  const lines = messages.map(
    (m) =>
      `<message sender="${escapeXml(m.sender_name)}" time="${m.timestamp}">${escapeXml(m.content)}</message>`,
  );
  /* ved custom */
  if (recentExchanges && recentExchanges.length > 0) {
    const pairs = recentExchanges
      .map(
        (e) =>
          `  <exchange>\n    <user>${escapeXml(e.userMessage)}</user>\n    <assistant>${escapeXml(e.botMessage)}</assistant>\n  </exchange>`,
      )
      .join('\n');
    return `<recent_context>\n${pairs}\n</recent_context>\n<messages>\n${lines.join('\n')}\n</messages>`;
  }
  /* ved custom end */
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

/* ved custom */
export async function routeOutbound(
  channels: Channel[],
  jid: string,
  text: string,
): Promise<void> {
  const channel = channels.find((c) => c.ownsJid(jid) && c.isConnected());
  if (!channel) throw new Error(`No channel for JID: ${jid}`);
  await channel.sendMessage(jid, text);
  try {
    storeMessage({
      id: `bot-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      chat_jid: jid,
      sender: 'assistant',
      sender_name: 'Assistant',
      content: text,
      timestamp: Date.now().toString(),
      is_from_me: true,
      is_bot_message: true,
    });
  } catch {
    // persistence is best-effort; do not surface as a send failure
  }
}
/* ved custom end */

export function findChannel(
  channels: Channel[],
  jid: string,
): Channel | undefined {
  return channels.find((c) => c.ownsJid(jid));
}
