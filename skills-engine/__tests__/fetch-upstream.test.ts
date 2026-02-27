import { execFileSync, execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('fetch-upstream.sh', () => {
  let projectDir: string;
  const scriptPath = path.resolve(
    '.claude/skills/update/scripts/fetch-upstream.sh',
  );

  beforeEach(() => {
    // Create the "project" repo that will run the script
    projectDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'nanoclaw-project-'),
    );
    execSync('git init', { cwd: projectDir, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', {
      cwd: projectDir,
      stdio: 'pipe',
    });
    execSync('git config user.name "Test"', {
      cwd: projectDir,
      stdio: 'pipe',
    });
    fs.writeFileSync(
      path.join(projectDir, 'package.json'),
      JSON.stringify({ name: 'nanoclaw', version: '1.0.0' }),
    );
    execSync('git add -A && git commit -m "init"', {
      cwd: projectDir,
      stdio: 'pipe',
    });

    // Copy skills-engine/constants.ts so fetch-upstream.sh can read BASE_INCLUDES
    const constantsSrc = path.resolve('skills-engine/constants.ts');
    const constantsDest = path.join(projectDir, 'skills-engine/constants.ts');
    fs.mkdirSync(path.dirname(constantsDest), { recursive: true });
    fs.copyFileSync(constantsSrc, constantsDest);

    // Copy the script into the project so it can find PROJECT_ROOT
    const skillScriptsDir = path.join(
      projectDir,
      '.claude/skills/update/scripts',
    );
    fs.mkdirSync(skillScriptsDir, { recursive: true });
    fs.copyFileSync(scriptPath, path.join(skillScriptsDir, 'fetch-upstream.sh'));
    fs.chmodSync(path.join(skillScriptsDir, 'fetch-upstream.sh'), 0o755);
  });

  afterEach(() => {
    if (projectDir && fs.existsSync(projectDir)) {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });

  function runFetchUpstream(): { stdout: string; exitCode: number } {
    try {
      const stdout = execFileSync(
        'bash',
        ['.claude/skills/update/scripts/fetch-upstream.sh'],
        {
          cwd: projectDir,
          encoding: 'utf-8',
          stdio: 'pipe',
          timeout: 30_000,
        },
      );
      return { stdout, exitCode: 0 };
    } catch (err: any) {
      return { stdout: (err.stdout ?? '') + (err.stderr ?? ''), exitCode: err.status ?? 1 };
    }
  }

  it('adds upstream remote when none exists', { timeout: 15_000 }, () => {
    // Remove origin if any
    try {
      execSync('git remote remove origin', {
        cwd: projectDir,
        stdio: 'pipe',
      });
    } catch {
      // No origin
    }

    const { stdout } = runFetchUpstream();

    // It will try to add upstream pointing to github (which will fail to fetch),
    // but we can verify it attempted to add the remote
    expect(stdout).toContain('Adding upstream');

    // Verify the remote was added
    const remotes = execSync('git remote -v', {
      cwd: projectDir,
      encoding: 'utf-8',
    });
    expect(remotes).toContain('upstream');
    expect(remotes).toContain('qwibitai/nanoclaw');
  });
});
