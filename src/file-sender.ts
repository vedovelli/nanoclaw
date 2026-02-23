/**
 * File Sender for NanoClaw
 *
 * Watches DATA_DIR/ipc/{group}/files/*.json and sends files via the
 * appropriate channel. Self-contained with its own poll loop.
 * Does not modify ipc.ts or types.ts.
 */

import fs from 'fs';
import path from 'path';

import { DATA_DIR, IPC_POLL_INTERVAL, MAIN_GROUP_FOLDER } from './config.js';
import { resolveGroupFolderPath } from './group-folder.js';
import { logger } from './logger.js';
import { Channel, RegisteredGroup } from './types.js';

export interface FileSenderDeps {
  channels: Channel[];
  registeredGroups: () => Record<string, RegisteredGroup>;
}

export function startFileSender(deps: FileSenderDeps): void {
  const ipcBaseDir = path.join(DATA_DIR, 'ipc');

  const processFiles = async () => {
    if (!fs.existsSync(ipcBaseDir)) {
      setTimeout(processFiles, IPC_POLL_INTERVAL);
      return;
    }

    let groupFolders: string[];
    try {
      groupFolders = fs.readdirSync(ipcBaseDir).filter((f) => {
        const stat = fs.statSync(path.join(ipcBaseDir, f));
        return stat.isDirectory() && f !== 'errors';
      });
    } catch (err) {
      logger.error({ err }, 'File sender: error reading IPC base directory');
      setTimeout(processFiles, IPC_POLL_INTERVAL);
      return;
    }

    const registeredGroups = deps.registeredGroups();

    for (const sourceGroup of groupFolders) {
      const isMain = sourceGroup === MAIN_GROUP_FOLDER;
      const filesDir = path.join(ipcBaseDir, sourceGroup, 'files');
      if (!fs.existsSync(filesDir)) continue;

      let fileNames: string[];
      try {
        fileNames = fs
          .readdirSync(filesDir)
          .filter((f) => f.endsWith('.json'));
      } catch {
        continue;
      }

      for (const file of fileNames) {
        const filePath = path.join(filesDir, file);
        try {
          const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

          if (
            data.type !== 'file' ||
            !data.chatJid ||
            !data.filePath ||
            !data.filename
          ) {
            fs.unlinkSync(filePath);
            continue;
          }

          // Authorization: non-main groups can only send to their own JID
          const targetGroup = registeredGroups[data.chatJid];
          if (!isMain && (!targetGroup || targetGroup.folder !== sourceGroup)) {
            logger.warn(
              { chatJid: data.chatJid, sourceGroup },
              'File sender: unauthorized file send attempt blocked',
            );
            fs.unlinkSync(filePath);
            continue;
          }

          // Find the channel for this JID
          const channel = deps.channels.find((ch) =>
            ch.ownsJid(data.chatJid),
          );
          if (!channel) {
            logger.warn(
              { chatJid: data.chatJid },
              'File sender: no channel found for JID',
            );
            fs.unlinkSync(filePath);
            continue;
          }

          // Duck-type check: channel must support sendFile
          if (typeof (channel as any).sendFile !== 'function') {
            logger.warn(
              { chatJid: data.chatJid, channel: channel.name },
              'File sender: channel does not support sendFile',
            );
            fs.unlinkSync(filePath);
            continue;
          }

          // Resolve host-side path: /workspace/group/ → GROUPS_DIR/{folder}/
          let groupDir: string;
          try {
            groupDir = resolveGroupFolderPath(sourceGroup);
          } catch (err) {
            logger.warn(
              { sourceGroup, err },
              'File sender: invalid group folder',
            );
            fs.unlinkSync(filePath);
            continue;
          }

          const normalizedRel = path.normalize(data.filePath);
          if (
            path.isAbsolute(normalizedRel) ||
            normalizedRel.startsWith('..')
          ) {
            logger.warn(
              { filePath: data.filePath, sourceGroup },
              'File sender: path traversal rejected',
            );
            fs.unlinkSync(filePath);
            continue;
          }

          const hostFilePath = path.join(groupDir, normalizedRel);
          const rel = path.relative(groupDir, hostFilePath);
          if (rel.startsWith('..') || path.isAbsolute(rel)) {
            logger.warn(
              { hostFilePath, groupDir },
              'File sender: resolved path escapes group directory',
            );
            fs.unlinkSync(filePath);
            continue;
          }

          if (!fs.existsSync(hostFilePath)) {
            logger.warn(
              { hostFilePath },
              'File sender: file not found on host',
            );
            fs.unlinkSync(filePath);
            continue;
          }

          await (channel as any).sendFile(
            data.chatJid,
            hostFilePath,
            data.filename,
            data.mimeType,
            data.caption,
          );

          logger.info(
            { chatJid: data.chatJid, filename: data.filename, sourceGroup },
            'File sent via IPC',
          );
          fs.unlinkSync(filePath);
        } catch (err) {
          logger.error(
            { file, sourceGroup, err },
            'File sender: error processing file IPC',
          );
          const errorDir = path.join(ipcBaseDir, 'errors');
          fs.mkdirSync(errorDir, { recursive: true });
          try {
            fs.renameSync(
              filePath,
              path.join(errorDir, `${sourceGroup}-${file}`),
            );
          } catch {}
        }
      }
    }

    setTimeout(processFiles, IPC_POLL_INTERVAL);
  };

  processFiles();
  logger.info('File sender started');
}
