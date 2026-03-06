import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./config.js', () => ({
  SENTRY_ACCESS_TOKEN: 'test-token',
  SENTRY_ORG_SLUG: 'test-org',
}));

describe('runSentryMonitor', () => {
  let sendMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sendMessage = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('sends all-clear message when no issues found', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => [],
    } as any);

    const { runSentryMonitor } = await import('./sentry-monitor.js');
    const result = await runSentryMonitor('group@g.us', sendMessage as (jid: string, text: string) => Promise<void>);

    expect(sendMessage).toHaveBeenCalledOnce();
    expect(sendMessage.mock.calls[0][1]).toContain('All clear');
    expect(result).toContain('0 issues');
  });

  it('formats and sends issues when found', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => [
        {
          id: '123',
          title: 'NullPointerException in checkout',
          project: { slug: 'backend' },
          count: '42',
          userCount: 7,
          permalink: 'https://sentry.io/organizations/test-org/issues/123/',
        },
      ],
    } as any);

    const { runSentryMonitor } = await import('./sentry-monitor.js');
    const result = await runSentryMonitor('group@g.us', sendMessage as (jid: string, text: string) => Promise<void>);

    expect(sendMessage).toHaveBeenCalledOnce();
    const msg = sendMessage.mock.calls[0][1] as string;
    expect(msg).toContain('1 unresolved issue');
    expect(msg).toContain('NullPointerException in checkout');
    expect(msg).toContain('backend');
    expect(msg).toContain('42');
    expect(result).toContain('1 issues');
  });

  it('sends error message when Sentry API returns non-ok response', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 401,
    } as any);

    const { runSentryMonitor } = await import('./sentry-monitor.js');
    const result = await runSentryMonitor('group@g.us', sendMessage as (jid: string, text: string) => Promise<void>);

    expect(sendMessage).toHaveBeenCalledOnce();
    expect(sendMessage.mock.calls[0][1]).toContain('401');
    expect(result).toContain('error');
  });

  it('sends error message when fetch throws', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('Network failure'));

    const { runSentryMonitor } = await import('./sentry-monitor.js');
    const result = await runSentryMonitor('group@g.us', sendMessage as (jid: string, text: string) => Promise<void>);

    expect(sendMessage).toHaveBeenCalledOnce();
    expect(sendMessage.mock.calls[0][1]).toContain('Network failure');
    expect(result).toContain('error');
  });
});
