import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock env
vi.mock('./env.js', () => ({
  readEnvFile: vi.fn(() => ({ OPENAI_API_KEY: 'test-key-123' })),
}));

// Mock logger
vi.mock('./logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock openai
const mockCreate = vi.fn();
vi.mock('openai', () => {
  return {
    default: class MockOpenAI {
      audio = { transcriptions: { create: mockCreate } };
    },
    toFile: vi.fn(async (buffer: Buffer, name: string) => ({
      name,
      buffer,
    })),
  };
});

import { transcribeAudioBuffer } from './transcription.js';
import { readEnvFile } from './env.js';
import { logger } from './logger.js';

describe('transcribeAudioBuffer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the cached key by re-importing with fresh state
    vi.mocked(readEnvFile).mockReturnValue({ OPENAI_API_KEY: 'test-key-123' });
  });

  it('returns transcript on success', async () => {
    mockCreate.mockResolvedValueOnce({ text: 'Hello world' });

    const result = await transcribeAudioBuffer(Buffer.from('audio-data'));

    expect(result).toBe('Hello world');
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'whisper-1' }),
    );
  });

  it('returns null on API error', async () => {
    mockCreate.mockRejectedValueOnce(new Error('API rate limit'));

    const result = await transcribeAudioBuffer(Buffer.from('audio-data'));

    expect(result).toBeNull();
    expect(logger.error).toHaveBeenCalled();
  });

  it('returns null when API returns empty text', async () => {
    mockCreate.mockResolvedValueOnce({ text: '' });

    const result = await transcribeAudioBuffer(Buffer.from('audio-data'));

    expect(result).toBeNull();
  });

  it('uses provided filename and mimeType', async () => {
    mockCreate.mockResolvedValueOnce({ text: 'test' });

    await transcribeAudioBuffer(
      Buffer.from('data'),
      'recording.mp3',
      'audio/mpeg',
    );

    expect(mockCreate).toHaveBeenCalled();
  });
});
