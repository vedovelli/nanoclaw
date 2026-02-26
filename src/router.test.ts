import { describe, it, expect, vi, beforeEach } from 'vitest';
import { routeOutbound } from './router.js';
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
    const call = (db.storeMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call).toMatchObject({
      chat_jid: 'tg:123',
      content: 'hello',
      is_bot_message: true,
    });
    // timestamp must be ISO 8601 so SQL lexicographic ordering works correctly
    expect(new Date(call.timestamp).toISOString()).toBe(call.timestamp);
  });
});
