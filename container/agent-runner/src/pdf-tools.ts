/**
 * PDF generation and file sending MCP tools for NanoClaw.
 * Registered into the MCP server by ipc-mcp-stdio.ts.
 */

import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

import { marked } from 'marked';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const execFileAsync = promisify(execFile);

const WORKSPACE_GROUP = '/workspace/group';
const IPC_FILES_DIR = '/workspace/ipc/files';
const CHROMIUM = '/usr/bin/chromium';

function writeIpcFile(dir: string, data: object): void {
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
  const filepath = path.join(dir, filename);
  const tempPath = `${filepath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
  fs.renameSync(tempPath, filepath);
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function withinDir(base: string, relPath: string): string | null {
  const normalized = path.normalize(relPath);
  if (path.isAbsolute(normalized)) return null;
  const full = path.join(base, normalized);
  const rel = path.relative(base, full);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return full;
}

export function registerPdfTools(
  server: McpServer,
  chatJid: string,
  groupFolder: string,
): void {
  server.tool(
    'generate_pdf',
    `Generate a nicely formatted PDF from markdown or HTML content. Saves to /workspace/group/ and returns the path.

Use this when the user asks for information as a PDF document. After generating, use send_file to deliver it via Telegram, or mcp__gmail__send_email with the full path as an attachment.`,
    {
      content: z.string().describe('The document content (markdown or HTML)'),
      filename: z
        .string()
        .describe('Output filename, e.g. "report.pdf". Saved to /workspace/group/'),
      title: z.string().optional().describe('Document title shown at the top'),
      format: z
        .enum(['markdown', 'html'])
        .default('markdown')
        .describe('"markdown" auto-converts to HTML; "html" is used as-is'),
    },
    async (args) => {
      const safeFilename = path
        .basename(args.filename)
        .replace(/[^a-zA-Z0-9._-]/g, '_');
      const outputPath = path.join(WORKSPACE_GROUP, safeFilename);
      const tmpHtml = `/tmp/nanoclaw-pdf-${Date.now()}.html`;

      try {
        const bodyHtml =
          args.format === 'markdown'
            ? await marked(args.content)
            : args.content;

        const title = args.title || safeFilename.replace(/\.pdf$/i, '');

        const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      font-size: 14px;
      line-height: 1.6;
      color: #24292e;
      max-width: 800px;
      margin: 40px auto;
      padding: 0 20px;
    }
    h1, h2, h3, h4, h5, h6 {
      margin-top: 24px;
      margin-bottom: 16px;
      font-weight: 600;
      line-height: 1.25;
    }
    h1 { font-size: 2em; border-bottom: 1px solid #eaecef; padding-bottom: .3em; }
    h2 { font-size: 1.5em; border-bottom: 1px solid #eaecef; padding-bottom: .3em; }
    h3 { font-size: 1.25em; }
    p { margin-top: 0; margin-bottom: 16px; }
    code {
      background-color: #f6f8fa;
      border-radius: 3px;
      font-size: 85%;
      padding: .2em .4em;
      font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
    }
    pre {
      background-color: #f6f8fa;
      border-radius: 6px;
      font-size: 85%;
      line-height: 1.45;
      overflow: auto;
      padding: 16px;
    }
    pre code { background: none; padding: 0; }
    table {
      border-collapse: collapse;
      width: 100%;
      margin-bottom: 16px;
    }
    table th, table td {
      border: 1px solid #dfe2e5;
      padding: 6px 13px;
    }
    table tr:nth-child(even) { background-color: #f6f8fa; }
    table th { background-color: #f1f1f1; font-weight: 600; }
    blockquote {
      border-left: 4px solid #dfe2e5;
      color: #6a737d;
      margin: 0;
      padding: 0 16px;
    }
    ul, ol { margin-bottom: 16px; padding-left: 2em; }
    a { color: #0366d6; }
    .page-title {
      font-size: 1.8em;
      font-weight: 700;
      border-bottom: 2px solid #0366d6;
      padding-bottom: 8px;
      margin-bottom: 8px;
    }
    .generated-at {
      color: #6a737d;
      font-size: 12px;
      margin-bottom: 24px;
    }
  </style>
</head>
<body>
  <div class="page-title">${escapeHtml(title)}</div>
  <div class="generated-at">Generated on ${new Date().toLocaleString()}</div>
  ${bodyHtml}
</body>
</html>`;

        fs.writeFileSync(tmpHtml, html);

        await execFileAsync(CHROMIUM, [
          '--headless',
          '--no-sandbox',
          '--disable-gpu',
          '--disable-dev-shm-usage',
          `--print-to-pdf=${outputPath}`,
          `file://${tmpHtml}`,
        ]);

        fs.unlinkSync(tmpHtml);

        const stat = fs.statSync(outputPath);
        const sizeKb = Math.round(stat.size / 1024);

        return {
          content: [
            {
              type: 'text' as const,
              text: [
                `PDF generated successfully: ${safeFilename} (${sizeKb}KB)`,
                ``,
                `To send via Telegram: use send_file with file_path="${safeFilename}"`,
                `To email: use mcp__gmail__send_email with attachments=["${outputPath}"]`,
              ].join('\n'),
            },
          ],
        };
      } catch (err) {
        try {
          fs.unlinkSync(tmpHtml);
        } catch {}
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error generating PDF: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'send_file',
    `Send a file from /workspace/group/ to the user via Telegram. Use after generate_pdf to deliver a PDF.

The file must exist in /workspace/group/. Use a relative path like "report.pdf".`,
    {
      file_path: z
        .string()
        .describe(
          'Relative path to the file within /workspace/group/, e.g. "report.pdf"',
        ),
      filename: z
        .string()
        .describe('Display filename shown in Telegram, e.g. "Monthly Report.pdf"'),
      mime_type: z
        .string()
        .optional()
        .describe('MIME type, e.g. "application/pdf". Auto-detected if omitted.'),
      caption: z
        .string()
        .optional()
        .describe('Optional caption shown below the file in Telegram'),
    },
    async (args) => {
      const fullPath = withinDir(WORKSPACE_GROUP, args.file_path);
      if (!fullPath) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Error: file_path must be a relative path within /workspace/group/',
            },
          ],
          isError: true,
        };
      }

      if (!fs.existsSync(fullPath)) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: File not found: ${fullPath}`,
            },
          ],
          isError: true,
        };
      }

      const stat = fs.statSync(fullPath);

      if (!stat.isFile()) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: ${args.file_path} is not a file`,
            },
          ],
          isError: true,
        };
      }

      const MAX_SIZE = 50 * 1024 * 1024;
      if (stat.size > MAX_SIZE) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: File is ${Math.round(stat.size / 1024 / 1024)}MB — exceeds Telegram's 50MB limit`,
            },
          ],
          isError: true,
        };
      }

      const normalizedRelPath = path.normalize(args.file_path);

      writeIpcFile(IPC_FILES_DIR, {
        type: 'file',
        chatJid,
        groupFolder,
        filePath: normalizedRelPath,
        filename: args.filename,
        mimeType: args.mime_type,
        caption: args.caption,
        timestamp: new Date().toISOString(),
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: `File queued for delivery: ${args.filename}`,
          },
        ],
      };
    },
  );
}
