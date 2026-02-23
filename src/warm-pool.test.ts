import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { WarmPool } from './warm-pool.js';

vi.mock('./config.js', () => ({
  DATA_DIR: '/tmp/nanoclaw-test-data',
  MAX_CONCURRENT_CONTAINERS: 3,
  MAIN_GROUP_FOLDER: 'main',
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    default: {
      ...actual,
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn(),
      renameSync: vi.fn(),
    },
  };
});

vi.mock('./container-runner.js', () => ({
  runContainerAgent: vi.fn(),
}));

vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const makeQueue = () => ({
  getActiveCount: vi.fn(() => 0),
  markActive: vi.fn(),
  markInactive: vi.fn(),
  registerProcess: vi.fn(),
});

const makeGroup = (folder = 'test-group') => ({
  name: 'Test Group',
  folder,
  jid: 'group1@g.us',
  channel: 'telegram',
  requiresTrigger: false,
  containerConfig: {},
});

describe('WarmPool', () => {
  let queue: ReturnType<typeof makeQueue>;
  let pool: WarmPool;

  beforeEach(async () => {
    vi.useFakeTimers();
    queue = makeQueue();
    pool = new WarmPool(queue as any);
    vi.clearAllMocks();

    const { runContainerAgent } = await import('./container-runner.js');
    vi.mocked(runContainerAgent).mockResolvedValue({
      status: 'success',
      result: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('prewarm spawns a container with standby prompt', async () => {
    const { runContainerAgent } = await import('./container-runner.js');
    await pool.prewarm('group1@g.us', makeGroup() as any);
    expect(runContainerAgent).toHaveBeenCalledOnce();
    const [, input] = vi.mocked(runContainerAgent).mock.calls[0];
    expect(input.prompt).toBe('[STANDBY]');
    expect(input.isScheduledTask).toBe(true);
    expect(input.groupFolder).toBe('test-group');
  });

  it('prewarm skips if warm container already exists', async () => {
    const { runContainerAgent } = await import('./container-runner.js');
    await pool.prewarm('group1@g.us', makeGroup() as any);
    await pool.prewarm('group1@g.us', makeGroup() as any);
    expect(runContainerAgent).toHaveBeenCalledOnce();
  });

  it('prewarm skips if at concurrency limit', async () => {
    const { runContainerAgent } = await import('./container-runner.js');
    queue.getActiveCount.mockReturnValue(3);
    await pool.prewarm('group1@g.us', makeGroup() as any);
    expect(runContainerAgent).not.toHaveBeenCalled();
  });

  it('claim returns false when no warm container exists', () => {
    expect(pool.claim('group1@g.us', 'hello', vi.fn())).toBe(false);
  });

  it('claim returns true and writes IPC file when warm container exists', async () => {
    const fs = await import('fs');
    pool.prewarm('group1@g.us', makeGroup() as any);
    const result = pool.claim('group1@g.us', 'hello world', vi.fn());
    expect(result).toBe(true);
    expect(vi.mocked(fs.default.writeFileSync)).toHaveBeenCalledWith(
      expect.stringContaining('.tmp'),
      JSON.stringify({ type: 'message', text: 'hello world' }),
    );
    expect(vi.mocked(fs.default.renameSync)).toHaveBeenCalledOnce();
  });

  it('claim calls queue.markActive with correct groupFolder', () => {
    pool.prewarm('group1@g.us', makeGroup('my-group') as any);
    pool.claim('group1@g.us', 'hi', vi.fn());
    expect(queue.markActive).toHaveBeenCalledWith('group1@g.us', 'my-group');
  });

  it('claim removes entry from warm pool so second claim returns false', () => {
    pool.prewarm('group1@g.us', makeGroup() as any);
    pool.claim('group1@g.us', 'first', vi.fn());
    expect(pool.claim('group1@g.us', 'second', vi.fn())).toBe(false);
  });

  it('standby output is discarded before claim', async () => {
    const { runContainerAgent } = await import('./container-runner.js');
    let capturedOnOutput: ((output: any) => Promise<void>) | undefined;
    vi.mocked(runContainerAgent).mockImplementation(async (_g, _i, _op, onOutput) => {
      capturedOnOutput = onOutput;
      return { status: 'success', result: null };
    });
    await pool.prewarm('group1@g.us', makeGroup() as any);
    const userHandler = vi.fn();
    await capturedOnOutput?.({ status: 'success', result: 'some output' });
    expect(userHandler).not.toHaveBeenCalled();
  });

  it('output after claim is dispatched to real handler', async () => {
    const { runContainerAgent } = await import('./container-runner.js');
    let capturedOnOutput: ((output: any) => Promise<void>) | undefined;
    vi.mocked(runContainerAgent).mockImplementation(async (_g, _i, _op, onOutput) => {
      capturedOnOutput = onOutput;
      return { status: 'success', result: null };
    });
    pool.prewarm('group1@g.us', makeGroup() as any);
    const userHandler = vi.fn();
    pool.claim('group1@g.us', 'hi', userHandler);
    const fakeOutput = { status: 'success', result: 'Hello!', newSessionId: undefined };
    await capturedOnOutput?.(fakeOutput);
    expect(userHandler).toHaveBeenCalledWith(fakeOutput);
  });

  it('updateSession stores sessionId used for next prewarm', async () => {
    const { runContainerAgent } = await import('./container-runner.js');
    pool.updateSession('my-group', 'sess-abc');
    await pool.prewarm('group1@g.us', makeGroup('my-group') as any);
    const [, input] = vi.mocked(runContainerAgent).mock.calls[0];
    expect(input.sessionId).toBe('sess-abc');
  });

  it('respawns after container exits with 2s delay', async () => {
    const { runContainerAgent } = await import('./container-runner.js');
    let resolveContainer!: () => void;
    vi.mocked(runContainerAgent).mockImplementation(
      () => new Promise<any>((resolve) => { resolveContainer = () => resolve({ status: 'success', result: null }); }),
    );
    await pool.prewarm('group1@g.us', makeGroup() as any);
    expect(vi.mocked(runContainerAgent)).toHaveBeenCalledTimes(1);
    resolveContainer();
    await vi.advanceTimersByTimeAsync(2001);
    expect(vi.mocked(runContainerAgent)).toHaveBeenCalledTimes(2);
  });
});
