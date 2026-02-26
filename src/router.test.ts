import { describe, it, expect, vi, beforeEach } from 'vitest';
import { routeOutbound, formatMessages } from './router.js';
import * as db from './db.js';

vi.mock('./db.js', () => ({ storeMessage: vi.fn() }));

const mockChannel = {
  ownsJid: vi.fn().mockReturnValue(true),
  isConnected: vi.fn().mockReturnValue(true),
  sendMessage: vi.fn().mockResolvedValue(undefined),
};

describe('routeOutbound', () => {
  beforeEach(() => vi.clearAllMocks());

  it('stores bot message after sending', async () => {
    await routeOutbound([mockChannel as any], 'tg:123', 'hello');
    expect(db.storeMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chat_jid: 'tg:123',
        content: 'hello',
        is_bot_message: true,
        is_from_me: true,
      }),
    );
  });
});

describe('formatMessages', () => {
  it('produces plain messages block when no recent context given', () => {
    const msgs = [{ id: '1', chat_jid: 'g', sender: 'u', sender_name: 'User', content: 'hi', timestamp: '1000', is_from_me: false }];
    const result = formatMessages(msgs);
    expect(result).toContain('<messages>');
    expect(result).not.toContain('<recent_context>');
  });

  it('prepends recent_context block when exchanges provided', () => {
    const msgs = [{ id: '1', chat_jid: 'g', sender: 'u', sender_name: 'User', content: 'new', timestamp: '2000', is_from_me: false }];
    const exchanges = [{ userMessage: 'old question', botMessage: 'old answer' }];
    const result = formatMessages(msgs, exchanges);
    expect(result).toContain('<recent_context>');
    expect(result).toContain('<user>old question</user>');
    expect(result).toContain('<assistant>old answer</assistant>');
    expect(result.indexOf('<recent_context>')).toBeLessThan(result.indexOf('<messages>'));
  });

  it('escapes XML in recent context', () => {
    const msgs = [{ id: '1', chat_jid: 'g', sender: 'u', sender_name: 'User', content: 'x', timestamp: '1000', is_from_me: false }];
    const exchanges = [{ userMessage: '<evil>', botMessage: '"quote"' }];
    const result = formatMessages(msgs, exchanges);
    expect(result).toContain('&lt;evil&gt;');
    expect(result).toContain('&quot;quote&quot;');
  });

  it('produces no recent_context block when exchanges is empty array', () => {
    const msgs = [{ id: '1', chat_jid: 'g', sender: 'u', sender_name: 'User', content: 'hi', timestamp: '1000', is_from_me: false }];
    const result = formatMessages(msgs, []);
    expect(result).not.toContain('<recent_context>');
  });
});
