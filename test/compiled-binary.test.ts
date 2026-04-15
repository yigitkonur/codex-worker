import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const binaryPath = resolve(process.cwd(), 'dist/bin/codex-worker' + (process.platform === 'win32' ? '.exe' : ''));
const hasBinary = existsSync(binaryPath);
const hasCodex = spawnSync('codex', ['--version'], { encoding: 'utf8' }).status === 0;

test('compiled binary --help exits 0', { skip: !hasBinary }, () => {
  const result = spawnSync(binaryPath, ['--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage: codex-worker/);
});

test('compiled binary doctor --output json returns JSON', { skip: !hasBinary }, () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'codex-worker-bin-'));
  try {
    const result = spawnSync(binaryPath, ['doctor', '--output', 'json'], {
      env: { ...process.env, CODEX_WORKER_STATE_DIR: stateDir },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
    assert.equal(typeof parsed.node, 'string');
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test('compiled binary daemon start/stop cycle', { skip: !hasBinary || !hasCodex, timeout: 30_000 }, () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'codex-worker-bin-'));
  try {
    const env = { ...process.env, CODEX_WORKER_STATE_DIR: stateDir };

    const startResult = spawnSync(binaryPath, ['daemon', 'start', '--output', 'json'], {
      env,
      encoding: 'utf8',
      timeout: 15_000,
    });
    assert.equal(startResult.status, 0, startResult.stderr);

    const statusResult = spawnSync(binaryPath, ['daemon', 'status', '--output', 'json'], {
      env,
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.equal(statusResult.status, 0, statusResult.stderr);
    const parsed = JSON.parse(statusResult.stdout) as Record<string, unknown>;
    assert.equal(parsed.status, 'running');

    const stopResult = spawnSync(binaryPath, ['daemon', 'stop', '--output', 'json'], {
      env,
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.equal(stopResult.status, 0, stopResult.stderr);
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test('compiled binary run completes a simple prompt end to end', { skip: !hasBinary || !hasCodex, timeout: 90_000 }, () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'codex-worker-bin-'));
  const workspaceDir = mkdtempSync(join(tmpdir(), 'codex-worker-run-'));
  const outputPath = join(workspaceDir, 'compiled-run-output.txt');
  const promptPath = join(workspaceDir, 'prompt.md');
  writeFileSync(
    promptPath,
    `Write the exact text "compiled-run-ok" to ${outputPath}.\nUse a single line and no extra text.\n`,
    'utf8',
  );

  try {
    const env = { ...process.env, CODEX_WORKER_STATE_DIR: stateDir };
    const result = spawnSync(binaryPath, [
      '--output',
      'json',
      'run',
      promptPath,
      '--cwd',
      workspaceDir,
      '--timeout',
      '240000',
    ], {
      env,
      encoding: 'utf8',
      timeout: 70_000,
    });
    assert.equal(result.status, 0, [result.stderr, result.stdout].filter(Boolean).join('\n'));

    const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
    assert.equal(parsed.status, 'completed');
    assert.equal(readFileSync(outputPath, 'utf8').trim(), 'compiled-run-ok');
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});
