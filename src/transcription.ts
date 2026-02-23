import OpenAI, { toFile } from 'openai';

import { readEnvFile } from './env.js';
import { logger } from './logger.js';

let cachedKey: string | null | undefined;

function getOpenAIKey(): string | null {
  if (cachedKey !== undefined) return cachedKey;
  const env = readEnvFile(['OPENAI_API_KEY']);
  cachedKey = process.env.OPENAI_API_KEY || env.OPENAI_API_KEY || null;
  return cachedKey;
}

/**
 * Transcribe an audio buffer using OpenAI Whisper.
 * Returns the transcript string, or null if unavailable.
 */
export async function transcribeAudioBuffer(
  buffer: Buffer,
  filename = 'voice.ogg',
  mimeType = 'audio/ogg',
): Promise<string | null> {
  const apiKey = getOpenAIKey();
  if (!apiKey) {
    logger.warn('OPENAI_API_KEY not set — skipping voice transcription');
    return null;
  }

  const client = new OpenAI({ apiKey });

  try {
    const file = await toFile(buffer, filename, { type: mimeType });
    const result = await client.audio.transcriptions.create({
      model: 'whisper-1',
      file,
    });
    return result.text || null;
  } catch (err) {
    logger.error({ err }, 'Voice transcription failed');
    return null;
  }
}
