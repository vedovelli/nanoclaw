import path from 'path';

import { readEnvFile } from './env.js';

// Read config values from .env (falls back to process.env).
// Secrets are NOT read here — they stay on disk and are loaded only
// where needed (container-runner.ts) to avoid leaking to child processes.
const envConfig = readEnvFile([
  'ASSISTANT_NAME',
  'ASSISTANT_HAS_OWN_NUMBER',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_ONLY',
  'WARM_POOL_ENABLED',
  /* ved custom */
  'DEVTEAM_ENABLED',
  'DEVTEAM_FAST_MODE',
  'DEVTEAM_UPSTREAM_REPO',
  'DEVTEAM_PM_GITHUB_TOKEN',
  'DEVTEAM_PM_GITHUB_USER',
  'DEVTEAM_SENIOR_GITHUB_TOKEN',
  'DEVTEAM_SENIOR_GITHUB_USER',
  'DEVTEAM_JUNIOR_GITHUB_TOKEN',
  'DEVTEAM_JUNIOR_GITHUB_USER',
  'DEVTEAM_MID_GITHUB_TOKEN',
  'DEVTEAM_MID_GITHUB_USER',
  'DEVTEAM_MID_SKIP_PROBABILITY',
  'DEVTEAM_MAX_SPRINT_TICKS',
  /* ved custom end */
  /* ved custom */
  'LOG_VIEWER_ENABLED',
  'LOG_VIEWER_PORT',
  /* ved custom end */
]);

export const ASSISTANT_NAME =
  process.env.ASSISTANT_NAME || envConfig.ASSISTANT_NAME || 'Andy';
export const ASSISTANT_HAS_OWN_NUMBER =
  (process.env.ASSISTANT_HAS_OWN_NUMBER ||
    envConfig.ASSISTANT_HAS_OWN_NUMBER) === 'true';
export const POLL_INTERVAL = 2000;
export const SCHEDULER_POLL_INTERVAL = 60000;

// Absolute paths needed for container mounts
const PROJECT_ROOT = process.cwd();
const HOME_DIR = process.env.HOME || '/Users/user';

// Mount security: allowlist stored OUTSIDE project root, never mounted into containers
export const MOUNT_ALLOWLIST_PATH = path.join(
  HOME_DIR,
  '.config',
  'nanoclaw',
  'mount-allowlist.json',
);
export const STORE_DIR = path.resolve(PROJECT_ROOT, 'store');
export const GROUPS_DIR = path.resolve(PROJECT_ROOT, 'groups');
export const DATA_DIR = path.resolve(PROJECT_ROOT, 'data');
export const MAIN_GROUP_FOLDER = 'main';

export const CONTAINER_IMAGE =
  process.env.CONTAINER_IMAGE || 'nanoclaw-agent:latest';
export const CONTAINER_TIMEOUT = parseInt(
  process.env.CONTAINER_TIMEOUT || '1800000',
  10,
);
export const CONTAINER_MAX_OUTPUT_SIZE = parseInt(
  process.env.CONTAINER_MAX_OUTPUT_SIZE || '10485760',
  10,
); // 10MB default
export const IPC_POLL_INTERVAL = 1000;
export const IDLE_TIMEOUT = parseInt(process.env.IDLE_TIMEOUT || '1800000', 10); // 30min default — how long to keep container alive after last result
export const MAX_CONCURRENT_CONTAINERS = Math.max(
  1,
  parseInt(process.env.MAX_CONCURRENT_CONTAINERS || '5', 10) || 5,
);

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const TRIGGER_PATTERN = new RegExp(
  `^@${escapeRegex(ASSISTANT_NAME)}\\b`,
  'i',
);

// Timezone for scheduled tasks (cron expressions, etc.)
// Uses system timezone by default
export const TIMEZONE =
  process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;

// Telegram configuration
export const TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN || envConfig.TELEGRAM_BOT_TOKEN || '';
export const TELEGRAM_ONLY =
  (process.env.TELEGRAM_ONLY || envConfig.TELEGRAM_ONLY) === 'true';

// Defaults to enabled — set WARM_POOL_ENABLED=false in .env or environment to disable
export const WARM_POOL_ENABLED =
  (process.env.WARM_POOL_ENABLED || envConfig.WARM_POOL_ENABLED || 'true') !==
  'false';

/* ved custom */
// Dev Team Simulation
export const DEVTEAM_ENABLED =
  (process.env.DEVTEAM_ENABLED || envConfig.DEVTEAM_ENABLED) === 'true';
export const DEVTEAM_FAST_MODE =
  (process.env.DEVTEAM_FAST_MODE || envConfig.DEVTEAM_FAST_MODE) === 'true';
export const DEVTEAM_UPSTREAM_REPO =
  process.env.DEVTEAM_UPSTREAM_REPO || envConfig.DEVTEAM_UPSTREAM_REPO || '';
export const DEVTEAM_PM_GITHUB_TOKEN =
  process.env.DEVTEAM_PM_GITHUB_TOKEN || envConfig.DEVTEAM_PM_GITHUB_TOKEN || '';
export const DEVTEAM_PM_GITHUB_USER =
  process.env.DEVTEAM_PM_GITHUB_USER || envConfig.DEVTEAM_PM_GITHUB_USER || '';
export const DEVTEAM_SENIOR_GITHUB_TOKEN =
  process.env.DEVTEAM_SENIOR_GITHUB_TOKEN || envConfig.DEVTEAM_SENIOR_GITHUB_TOKEN || '';
export const DEVTEAM_SENIOR_GITHUB_USER =
  process.env.DEVTEAM_SENIOR_GITHUB_USER || envConfig.DEVTEAM_SENIOR_GITHUB_USER || '';
export const DEVTEAM_JUNIOR_GITHUB_TOKEN =
  process.env.DEVTEAM_JUNIOR_GITHUB_TOKEN || envConfig.DEVTEAM_JUNIOR_GITHUB_TOKEN || '';
export const DEVTEAM_JUNIOR_GITHUB_USER =
  process.env.DEVTEAM_JUNIOR_GITHUB_USER || envConfig.DEVTEAM_JUNIOR_GITHUB_USER || '';
export const DEVTEAM_MID_GITHUB_TOKEN =
  process.env.DEVTEAM_MID_GITHUB_TOKEN || envConfig.DEVTEAM_MID_GITHUB_TOKEN || '';
export const DEVTEAM_MID_GITHUB_USER =
  process.env.DEVTEAM_MID_GITHUB_USER || envConfig.DEVTEAM_MID_GITHUB_USER || '';
export const DEVTEAM_MID_SKIP_PROBABILITY =
  parseFloat(process.env.DEVTEAM_MID_SKIP_PROBABILITY || envConfig.DEVTEAM_MID_SKIP_PROBABILITY || '0.4');
export const DEVTEAM_MAX_SPRINT_TICKS =
  parseInt(process.env.DEVTEAM_MAX_SPRINT_TICKS || envConfig.DEVTEAM_MAX_SPRINT_TICKS || '30', 10);
/* ved custom end */

/* ved custom */
/** Number of recent user+bot exchange pairs to inject into each agent prompt. */
export const RECENT_CONTEXT_PAIRS = 3;
/* ved custom end */

/* ved custom */
export const LOG_VIEWER_ENABLED =
  (process.env.LOG_VIEWER_ENABLED || envConfig.LOG_VIEWER_ENABLED) === 'true';
export const LOG_VIEWER_PORT =
  parseInt(
    process.env.LOG_VIEWER_PORT || envConfig.LOG_VIEWER_PORT || '4242',
    10,
  ) || 4242;
/* ved custom end */
