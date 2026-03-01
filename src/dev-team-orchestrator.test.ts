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
  DEVTEAM_MID_GITHUB_TOKEN: 'token-mid',
  DEVTEAM_MID_GITHUB_USER: 'thiago-test',
  DEVTEAM_MID_SKIP_PROBABILITY: 0.4,
  DEVTEAM_MAX_SPRINT_TICKS: 30,
  DEVTEAM_FAST_MODE: false,
  DEVTEAM_PM_GITHUB_TOKEN: 'token-pm',
  DEVTEAM_PM_GITHUB_USER: 'pm-test',
}));
vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), debug: vi.fn() },
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
});
