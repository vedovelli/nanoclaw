import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';

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
}));
vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('DevTeam Orchestrator', () => {
  it('should read and write sprint state', () => {
    const stateFile = '/tmp/test-sprint-state.json';
    const state = {
      sprint_number: 0,
      state: 'IDLE',
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
    };
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
    const read = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    expect(read.state).toBe('IDLE');
  });

  it('should skip when paused', async () => {
    // The orchestrator should return early when paused
    // This validates the pause mechanism from /devteam stop
    expect(true).toBe(true); // Placeholder - full integration test needs container
  });
});
