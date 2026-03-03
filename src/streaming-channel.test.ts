import { describe, it, expect, vi } from 'vitest';
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
      await handler!(makeOutput('hello'));

      expect(channel.sendMessageWithId).toHaveBeenCalledWith(JID, 'hello');
      expect(channel.editMessage).not.toHaveBeenCalled();
    });
  });

  describe('second chunk', () => {
    it('calls editMessage with accumulated text', async () => {
      const channel = makeStreamingChannel();
      channel.sendMessageWithId.mockResolvedValue(42);

      const handler = buildStreamingOnOutput(channel, JID);
      await handler!(makeOutput('first'));
      await handler!(makeOutput('second'));

      expect(channel.editMessage).toHaveBeenCalledWith(JID, 42, 'first\n\nsecond');
    });
  });

  describe('4096 char overflow', () => {
    it('starts a new message when accumulated text exceeds 4096 chars', async () => {
      const channel = makeStreamingChannel();
      channel.sendMessageWithId
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(2);

      const handler = buildStreamingOnOutput(channel, JID);
      await handler!(makeOutput('x'.repeat(4000))); // first message, id=1
      await handler!(makeOutput('y'.repeat(200)));  // would push to 4200+separator, exceeds limit → new message, id=2
      await handler!(makeOutput('small'));           // edits message 2

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
      await handler!(makeOutput('first'));   // sends → id=10
      await handler!(makeOutput('second')); // edit fails → sends new → id=20
      await handler!(makeOutput('third'));  // edits id=20

      expect(channel.sendMessageWithId).toHaveBeenCalledTimes(2);
      expect(channel.editMessage).toHaveBeenCalledTimes(2);
    });
  });

  describe('empty text after strip', () => {
    it('skips chunks with only whitespace', async () => {
      const channel = makeStreamingChannel();
      const handler = buildStreamingOnOutput(channel, JID);
      await handler!(makeOutput('   '));

      expect(channel.sendMessageWithId).not.toHaveBeenCalled();
    });

    it('strips <internal> blocks and skips if nothing remains', async () => {
      const channel = makeStreamingChannel();
      const handler = buildStreamingOnOutput(channel, JID);
      await handler!(makeOutput('<internal>reasoning</internal>'));

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

  describe('null result', () => {
    it('skips output with null result', async () => {
      const channel = makeStreamingChannel();
      const handler = buildStreamingOnOutput(channel, JID);
      await handler!(makeOutput(null));

      expect(channel.sendMessageWithId).not.toHaveBeenCalled();
    });
  });
});
