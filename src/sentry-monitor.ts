import { SENTRY_ACCESS_TOKEN, SENTRY_ORG_SLUG } from './config.js';

interface SentryIssue {
  id: string;
  title: string;
  project: { slug: string };
  count: string;
  userCount: number;
  permalink: string;
}

function formatIssues(issues: SentryIssue[]): string {
  if (issues.length === 0) {
    return 'All clear — no new unresolved issues in the last 2 hours.';
  }

  const count = issues.length;
  const header = `*Sentry Issues — Last 2h*\n${count} unresolved issue${count === 1 ? '' : 's'} found\n`;

  const lines = issues.map((issue, i) => {
    return [
      `${i + 1}. [${issue.project.slug}] ${issue.title}`,
      `   Events: ${issue.count} | Users: ${issue.userCount}`,
      `   ${issue.permalink}`,
    ].join('\n');
  });

  return header + '\n' + lines.join('\n\n');
}

export async function runSentryMonitor(
  chatJid: string,
  sendMessage: (jid: string, text: string) => Promise<void>,
): Promise<string> {
  if (!SENTRY_ACCESS_TOKEN) {
    const msg = 'Sentry monitor error: SENTRY_ACCESS_TOKEN is not configured.';
    await sendMessage(chatJid, msg);
    return 'error: missing token';
  }

  if (!SENTRY_ORG_SLUG) {
    const msg = 'Sentry monitor error: SENTRY_ORG_SLUG is not configured.';
    await sendMessage(chatJid, msg);
    return 'error: missing org slug';
  }

  const url =
    `https://sentry.io/api/0/organizations/${SENTRY_ORG_SLUG}/issues/` +
    `?query=is%3Aunresolved+lastSeen%3A-2h&limit=25`;

  let issues: SentryIssue[];

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${SENTRY_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const msg = `Sentry monitor error: API returned ${response.status}.`;
      await sendMessage(chatJid, msg);
      return `error: HTTP ${response.status}`;
    }

    issues = (await response.json()) as SentryIssue[];
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await sendMessage(chatJid, `Sentry monitor error: ${message}`);
    return `error: ${message}`;
  }

  const text = formatIssues(issues);
  await sendMessage(chatJid, text);
  return `${issues.length} issues`;
}
