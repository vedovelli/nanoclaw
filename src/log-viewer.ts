import fs from 'node:fs';
import http, { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';

import { LOG_VIEWER_ENABLED, LOG_VIEWER_PORT } from './config.js';
import { logger } from './logger.js';

const LOG_DIR = path.join(process.cwd(), 'logs');
const MAIN_LOG = path.join(LOG_DIR, 'nanoclaw.log');
const BACKFILL_LINES = 200;

function readLastLines(filePath: string, n: number): string[] {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter((l) => l.length > 0);
    return lines.slice(Math.max(0, lines.length - n));
  } catch {
    return [];
  }
}

function tailFile(filePath: string, onLine: (line: string) => void): () => void {
  let pos = 0;
  try {
    pos = fs.statSync(filePath).size;
  } catch {
    // file doesn't exist yet — start at 0
  }

  let watcher: fs.FSWatcher | null = null;

  function read(): void {
    try {
      const stat = fs.statSync(filePath);
      if (stat.size < pos) pos = 0; // rotated or truncated
      if (stat.size === pos) return;
      const len = stat.size - pos;
      const buf = Buffer.allocUnsafe(len);
      const fd = fs.openSync(filePath, 'r');
      try {
        fs.readSync(fd, buf, 0, len, pos);
      } finally {
        fs.closeSync(fd);
      }
      pos = stat.size;
      for (const line of buf.toString('utf-8').split('\n')) {
        if (line.length > 0) onLine(line);
      }
    } catch {
      // file temporarily unavailable — ignore
    }
  }

  let stopped = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  function tryWatch(): void {
    if (stopped) return;   // connection already closed, don't create watcher
    try {
      watcher = fs.watch(filePath, read);
    } catch {
      // File doesn't exist yet — retry in 5 seconds
      retryTimer = setTimeout(tryWatch, 5000);
    }
  }
  tryWatch();

  return () => {
    stopped = true;   // prevent any pending retry from creating a new watcher
    if (retryTimer) clearTimeout(retryTimer);
    if (watcher) {
      try {
        watcher.close();
      } catch {
        // ignore
      }
    }
  };
}

function handleSSE(
  req: IncomingMessage,
  res: ServerResponse,
  logFile: string,
): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // Backfill last N lines immediately
  for (const line of readLastLines(logFile, BACKFILL_LINES)) {
    res.write(`data: ${JSON.stringify(line)}\n\n`);
  }

  // Stream new lines as they arrive.
  // `stop` is declared with let so the callback can reference it before tailFile
  // returns — safe because fs.watch only fires asynchronously (after this tick).
  let stop: (() => void) | undefined;
  stop = tailFile(logFile, (line) => {
    try {
      res.write(`data: ${JSON.stringify(line)}\n\n`);
    } catch {
      stop?.();
    }
  });

  req.on('close', () => stop?.());
}

const HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>NanoClaw Live Logs</title>
  <script src="https://cdn.jsdelivr.net/npm/ansi_up@5/ansi_up.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #1a1a1a; color: #d4d4d4;
      font-family: 'Menlo', 'Consolas', monospace; font-size: 12.5px;
      height: 100vh; display: flex; flex-direction: column;
    }
    header {
      padding: 6px 16px; background: #252525;
      border-bottom: 1px solid #333;
      display: flex; align-items: center; gap: 12px;
    }
    h1 { font-size: 13px; font-weight: normal; color: #666; flex: 1; }
    .status { font-size: 11px; color: #555; }
    .status.connected { color: #4ec9b0; }
    .panels { display: flex; flex: 1; overflow: hidden; }
    .panel { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
    .panel + .panel { border-left: 1px solid #2a2a2a; }
    .panel-header {
      padding: 4px 12px; background: #1e1e1e; color: #555;
      font-size: 11px; border-bottom: 1px solid #2a2a2a; flex-shrink: 0;
    }
    .panel-content { flex: 1; overflow-y: scroll; padding: 6px 12px; }
    .line { white-space: pre-wrap; line-height: 1.6; }
  </style>
</head>
<body>
  <header>
    <h1>NanoClaw Live Logs</h1>
    <span class="status" id="status-main">main: connecting\u2026</span>
  </header>
  <div class="panels">
    <div class="panel">
      <div class="panel-header">nanoclaw.log</div>
      <div class="panel-content" id="panel-main"></div>
    </div>
    <div class="panel">
      <div class="panel-header">Dev Visibility</div>
      <iframe src="https://devvis.com.br/admin" style="flex:1;border:none;width:100%;height:100%;"></iframe>
    </div>
  </div>
  <script>
    /* global AnsiUp */
    const au = new AnsiUp();
    au.use_classes = false;

    function connect(url, panelId, statusId) {
      const panel = document.getElementById(panelId);
      const statusEl = document.getElementById(statusId);
      let autoScroll = true;

      panel.addEventListener('scroll', () => {
        const atBottom = panel.scrollHeight - panel.scrollTop - panel.clientHeight < 60;
        autoScroll = atBottom;
      });

      const es = new EventSource(url);

      es.onopen = () => {
        panel.innerHTML = '';   // clear stale lines before backfill arrives
        autoScroll = true;      // reset so backfill auto-scrolls after reconnect
        statusEl.textContent = panelId.replace('panel-', '') + ': live';
        statusEl.className = 'status connected';
      };

      es.onmessage = (e) => {
        const raw = JSON.parse(e.data);
        const div = document.createElement('div');
        div.className = 'line';
        div.innerHTML = au.ansi_to_html(raw);
        panel.appendChild(div);
        if (autoScroll) panel.scrollTop = panel.scrollHeight;
      };

      es.onerror = () => {
        statusEl.textContent = panelId.replace('panel-', '') + ': reconnecting\u2026';
        statusEl.className = 'status';
      };
    }

    connect('/stream/main', 'panel-main', 'status-main');
  </script>
</body>
</html>`;

function serveHtml(res: ServerResponse): void {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(HTML);
}

export function startLogViewer(): void {
  if (!LOG_VIEWER_ENABLED) return;

  const server = http.createServer(
    (req: IncomingMessage, res: ServerResponse) => {
      const url = req.url ?? '/';
      if (url === '/stream/main') return handleSSE(req, res, MAIN_LOG);
      if (url === '/' || url === '/index.html') return serveHtml(res);
      res.writeHead(404);
      res.end('Not found');
    },
  );

  server.listen(LOG_VIEWER_PORT, '127.0.0.1', () => {
    logger.info(
      { port: LOG_VIEWER_PORT },
      `Log viewer started at http://localhost:${LOG_VIEWER_PORT}`,
    );
  });

  server.on('error', (err) => {
    logger.error({ err }, 'Log viewer server error');
  });
}
