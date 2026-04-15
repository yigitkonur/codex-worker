import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
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
