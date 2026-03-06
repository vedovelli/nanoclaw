import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

// Mock dependencies
vi.mock('./container-runner.js', () => ({
  runContainerAgent: vi.fn().mockResolvedValue({ status: 'success', result: 'ISSUE_NUMBER=1' }),
}));
vi.mock('./config.js', () => ({
  DEVTEAM_UPSTREAM_REPO: 'test/repo',
  DEVTEAM_SENIOR_GITHUB_TOKEN: 'token-sr',
  DEVTEAM_SENIOR_GITHUB_USER: 'carlos-test',
  DEVTEAM_JUNIOR_GITHUB_TOKEN: 'token-jr',
  DEVTEAM_JUNIOR_GITHUB_USER: 'ana-test',
  DEVTEAM_PM_GITHUB_TOKEN: 'token-pm',
  DEVTEAM_FAST_MODE: false,
}));
vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));

const BASE_STATE = {
  sprint_number: 0,
  state: 'IDLE' as const,
  paused: false,
  started_at: null,
  planning_issue: null,
  tasks: [],
  next_action_at: null,
  upstream_repo: 'test/repo',
  senior_fork: '',
  junior_fork: '',
  debate_round: 0,
  review_round: 0,
  task_under_review: null,
  dysfunctionMode: false,
};

describe('DevTeam Orchestrator', () => {
  it('should read and write sprint state', () => {
    const stateFile = '/tmp/test-sprint-state.json';
    fs.writeFileSync(stateFile, JSON.stringify(BASE_STATE, null, 2));
    const read = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    expect(read.state).toBe('IDLE');
    fs.unlinkSync(stateFile);
  });

  it('should return early when paused', async () => {
    const { runDevTeamOrchestrator } = await import('./dev-team-orchestrator.js');
    const { runContainerAgent } = await import('./container-runner.js');

    // Mock fs.readFileSync to return paused state
    const readSpy = vi.spyOn(fs, 'readFileSync').mockReturnValueOnce(
      JSON.stringify({ ...BASE_STATE, paused: true }) as any
    );

    const mockGroup = { folder: 'background', name: 'background' } as any;
    const result = await runDevTeamOrchestrator(mockGroup, 'test-jid', vi.fn());

    expect(result).toBe('Dev team is paused.');
    expect(runContainerAgent).not.toHaveBeenCalled();
    readSpy.mockRestore();
  });

  it('readState() defaults dysfunctionMode to false when field is absent', async () => {
    const stateWithoutDysf = { ...BASE_STATE };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (stateWithoutDysf as any).dysfunctionMode;

    const readSpy = vi.spyOn(fs, 'readFileSync').mockReturnValueOnce(
      JSON.stringify(stateWithoutDysf) as any,
    );

    const { readState } = await import('./dev-team-orchestrator.js');
    const state = readState();

    expect(state.dysfunctionMode).toBe(false);
    readSpy.mockRestore();
  });

  it('runAgent selects ana-dysfunction-prompt when dysfunctionMode is true', async () => {
    const { runContainerAgent } = await import('./container-runner.js');
    const { runAgent } = await import('./dev-team-orchestrator.js');
    vi.mocked(runContainerAgent).mockClear();
    vi.mocked(runContainerAgent).mockResolvedValueOnce({ status: 'success', result: 'done' } as any);

    const readFileSpy = vi.spyOn(fs, 'readFileSync').mockImplementation((filePath: any) => {
      const p = String(filePath);
      if (p.endsWith('ana-dysfunction-prompt.md')) return '# Ana Dysfunction Prompt';
      if (p.endsWith('ana-prompt.md')) return '# Ana Normal Prompt';
      if (p.endsWith('carlos-prompt.md')) return '# Carlos Prompt';
      if (p.endsWith('orchestrator-prompt.md')) return '# Orchestrator Prompt';
      if (p.endsWith('sprint-state.json')) return JSON.stringify({ ...BASE_STATE, dysfunctionMode: false });
      return '';
    });

    const mockGroup = { folder: 'background', name: 'background' } as any;
    await runAgent('junior', 'do something', mockGroup, 'test-jid', vi.fn(), true);

    const calls = readFileSpy.mock.calls.map((c) => String(c[0]));
    expect(calls.some((p) => p.endsWith('ana-dysfunction-prompt.md'))).toBe(true);
    expect(calls.some((p) => p.endsWith('ana-prompt.md'))).toBe(false);

    readFileSpy.mockRestore();
  });

  it('checkDevProgress skips junior task and does not call runContainerAgent when dysfunctionMode is true', async () => {
    const { runContainerAgent } = await import('./container-runner.js');
    vi.mocked(runContainerAgent).mockClear();

    const stateWithDysfunction = {
      ...BASE_STATE,
      state: 'DEV' as const,
      dysfunctionMode: true,
      senior_fork: 'carlos-test/repo',
      junior_fork: 'ana-test/repo',
      tasks: [
        {
          issue: 'FAB-1',
          assignee: 'junior' as const,
          status: 'pending' as const,
          branch: 'feature/fab-1',
          pr: null,
          merge_attempts: 0,
        },
      ],
    };

    const readSpy = vi.spyOn(fs, 'readFileSync').mockReturnValue(
      JSON.stringify(stateWithDysfunction) as any
    );
    const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});

    const mockGroup = { folder: 'background', name: 'background' } as any;
    const { runDevTeamOrchestrator } = await import('./dev-team-orchestrator.js');
    const result = await runDevTeamOrchestrator(mockGroup, 'test-jid', vi.fn());

    expect(runContainerAgent).not.toHaveBeenCalled();
    expect(result).toContain('skipped');

    // Verify state was written with skipped_dysfunction status
    const writeCall = writeSpy.mock.calls.find(c => String(c[0]).endsWith('sprint-state.json'));
    expect(writeCall).toBeDefined();
    const writtenState = JSON.parse(writeCall![1] as string);
    expect(writtenState.tasks[0].status).toBe('skipped_dysfunction');

    readSpy.mockRestore();
    writeSpy.mockRestore();
  });

  it('processReview skips junior reviewer and auto-advances when dysfunctionMode is true', async () => {
    const { runContainerAgent } = await import('./container-runner.js');
    vi.mocked(runContainerAgent).mockClear();

    const stateInReview = {
      ...BASE_STATE,
      state: 'REVIEW' as const,
      dysfunctionMode: true,
      review_round: 0,
      senior_fork: 'carlos-test/repo',
      junior_fork: 'ana-test/repo',
      tasks: [
        {
          issue: 'FAB-2',
          assignee: 'senior' as const,  // Carlos's task — reviewer would be Ana (junior)
          status: 'pr_created' as const,
          branch: 'feature/fab-2',
          pr: 42,
          merge_attempts: 0,
        },
      ],
    };

    const readSpy = vi.spyOn(fs, 'readFileSync').mockReturnValue(
      JSON.stringify(stateInReview) as any
    );
    const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});

    const mockGroup = { folder: 'background', name: 'background' } as any;
    const { runDevTeamOrchestrator } = await import('./dev-team-orchestrator.js');
    const result = await runDevTeamOrchestrator(mockGroup, 'test-jid', vi.fn());

    // Ana should NOT be dispatched
    expect(runContainerAgent).not.toHaveBeenCalled();
    // Result should mention the skip
    expect(result).toContain('skipped');

    // Written state should have the task as 'approved' and sprint moved to 'MERGE'
    const writeCall = writeSpy.mock.calls.find(c => String(c[0]).endsWith('sprint-state.json'));
    expect(writeCall).toBeDefined();
    const writtenState = JSON.parse(writeCall![1] as string);
    expect(writtenState.tasks[0].status).toBe('approved');
    expect(writtenState.state).toBe('MERGE');

    readSpy.mockRestore();
    writeSpy.mockRestore();
  });
});
