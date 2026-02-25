/**
 * WarmPool — Pre-spawned container pool for eliminating cold-start latency.
 *
 * Keeps one container per registered group running in standby (IPC poll loop).
 * When a message arrives, claim() swaps in the real output handler and writes
 * the message to IPC — no Docker spawn required.
 *
 * Upstream-compatible: no changes to container/agent-runner/.
 */
import fs from 'fs';
import path from 'path';
import { ChildProcess } from 'child_process';

import {
  ASSISTANT_NAME,
  DATA_DIR,
  MAIN_GROUP_FOLDER,
  MAX_CONCURRENT_CONTAINERS,
} from './config.js';
import { ContainerOutput, runContainerAgent } from './container-runner.js';
import { GroupQueue } from './group-queue.js';
import { logger } from './logger.js';
import { RegisteredGroup } from './types.js';

interface WarmEntry {
  group: RegisteredGroup;
  groupFolder: string;
  claimed: boolean;
  onOutputRef: { fn: ((output: ContainerOutput) => Promise<void>) | null };
  process: ChildProcess | null;
  containerName: string | null;
}

export class WarmPool {
  private warmContainers = new Map<string, WarmEntry>();
  private warmCount = 0; // tracks standby containers (not yet claimed)
  private sessions: Record<string, string> = {};
  private queue: GroupQueue;

  constructor(queue: GroupQueue) {
    this.queue = queue;
  }

  /** Store the latest sessionId so the next warm spawn resumes context. */
  updateSession(groupFolder: string, sessionId: string): void {
    this.sessions[groupFolder] = sessionId;
  }

  /** Pre-spawn a warm container for a group. No-op if one already exists. */
  async prewarm(
    chatJid: string,
    group: RegisteredGroup,
    sessionId?: string,
  ): Promise<void> {
    if (
      this.queue.getActiveCount() + this.warmCount >=
      MAX_CONCURRENT_CONTAINERS
    ) {
      logger.debug({ chatJid }, 'At concurrency limit, skipping prewarm');
      return;
    }

    if (this.warmContainers.has(chatJid)) {
      logger.debug({ chatJid }, 'Warm container already exists, skipping');
      return;
    }

    const entry: WarmEntry = {
      group,
      groupFolder: group.folder,
      claimed: false,
      onOutputRef: { fn: null },
      process: null,
      containerName: null,
    };

    this.warmContainers.set(chatJid, entry);
    this.warmCount++;
    logger.info({ chatJid, group: group.name }, 'Prewarming container');

    runContainerAgent(
      group,
      {
        prompt: '[STANDBY]',
        isScheduledTask: true,
        groupFolder: group.folder,
        chatJid,
        isMain: group.folder === MAIN_GROUP_FOLDER,
        sessionId: sessionId ?? this.sessions[group.folder],
        assistantName: ASSISTANT_NAME,
      },
      (proc, containerName) => {
        entry.process = proc;
        entry.containerName = containerName;
      },
      async (output) => {
        if (output.newSessionId) {
          this.sessions[group.folder] = output.newSessionId;
        }
        // Dispatch to real handler only after claim; standby output is discarded.
        if (entry.onOutputRef.fn) {
          await entry.onOutputRef.fn(output);
        }
      },
    )
      .then(() => {
        this._onContainerExit(chatJid, group, entry);
      })
      .catch(() => {
        this._onContainerExit(chatJid, group, entry);
      });
  }

  /** Called when the container process exits (claimed or not). */
  private _onContainerExit(
    chatJid: string,
    group: RegisteredGroup,
    entry: WarmEntry,
  ): void {
    // If claimed, queue.markInactive so the queue can drain waiting work.
    if (entry.claimed) {
      this.queue.markInactive(chatJid);
    } else {
      // Unclaimed exit: remove from warm pool so the respawn can re-register.
      // Deferred via setTimeout so any in-flight prewarm() guards (duplicate
      // suppression) run first before this entry is evicted.
      setTimeout(() => {
        // Only remove if this is still the same entry we set up.
        if (this.warmContainers.get(chatJid) === entry) {
          this.warmContainers.delete(chatJid);
          this.warmCount--;
        }
      }, 0);
    }
    // Respawn after a short delay so the next message finds a warm container.
    setTimeout(() => {
      this.prewarm(chatJid, group, this.sessions[group.folder]);
    }, 2000);
  }

  /**
   * Returns true when a warm container is registered for this chat but its
   * process has not yet been assigned (still booting). Callers should not fall
   * through to a cold start in this state — the container will be ready shortly.
   */
  isBooting(chatJid: string): boolean {
    const entry = this.warmContainers.get(chatJid);
    return entry !== undefined && entry.process === null;
  }

  /**
   * Hand the warm container over for a real message.
   * Sets the real output handler, writes the message to IPC,
   * and registers the container as active in the queue.
   * Returns false if no warm container is available (caller falls through to cold start).
   */
  claim(
    chatJid: string,
    text: string,
    onOutput: (output: ContainerOutput) => Promise<void>,
  ): boolean {
    const entry = this.warmContainers.get(chatJid);
    if (!entry) return false;

    // Guard: fall through to cold start if the process is not yet assigned (container
    // still starting) or has already exited. Both cases mean we can't hand off reliably.
    if (entry.process === null || entry.process.exitCode !== null) {
      logger.debug(
        { chatJid },
        'Warm container not ready or already exited, falling through to cold start',
      );
      return false;
    }

    // Activate real output handling.
    entry.onOutputRef.fn = onOutput;
    entry.claimed = true;

    // Register with queue so follow-up messages pipe via queue.sendMessage().
    this.queue.registerProcess(
      chatJid,
      entry.process,
      entry.containerName!,
      entry.groupFolder,
    );
    this.queue.markActive(chatJid, entry.groupFolder);

    // Write the real message to IPC (same protocol as queue.sendMessage).
    const inputDir = path.join(DATA_DIR, 'ipc', entry.groupFolder, 'input');
    fs.mkdirSync(inputDir, { recursive: true });
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}.json`;
    const filepath = path.join(inputDir, filename);
    const tempPath = `${filepath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify({ type: 'message', text }));
    fs.renameSync(tempPath, filepath);

    // Remove from warm pool — queue now manages this container.
    this.warmContainers.delete(chatJid);
    this.warmCount--;

    logger.info({ chatJid, group: entry.group.name }, 'Warm container claimed');
    return true;
  }
}
