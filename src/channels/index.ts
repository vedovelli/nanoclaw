// Channel self-registration barrel file.
// Each import triggers the channel module's registerChannel() call.

// discord

// gmail

// slack

/* ved custom */
// telegram
import { TELEGRAM_BOT_TOKEN } from '../config.js';
import { registerChannel } from './registry.js';
import { TelegramChannel } from './telegram.js';

registerChannel('telegram', (opts) => {
  if (!TELEGRAM_BOT_TOKEN) return null;
  return new TelegramChannel(TELEGRAM_BOT_TOKEN, opts);
});
/* ved custom end */

// whatsapp
