import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { appendRawEvent } from '../src/core/raw-log.js';
import { rawLogPath } from '../src/core/paths.js';

function withTempStateRoot(body: (cwd: string) => Promise<void> | void): Promise<void> {
  const tmp = mkdtempSync(join(tmpdir(), 'codex-raw-'));
  const prev = process.env.CODEX_WORKER_STATE_DIR;
  process.env.CODEX_WORKER_STATE_DIR = tmp;
  return Promise.resolve(body(tmp)).finally(() => {
    if (prev === undefined) delete process.env.CODEX_WORKER_STATE_DIR;
    else process.env.CODEX_WORKER_STATE_DIR = prev;
    rmSync(tmp, { recursive: true, force: true });
  });
}

test('appendRawEvent writes newline-delimited JSON with timestamp', () => {
  return withTempStateRoot(async (tmp) => {
    const cwd = join(tmp, 'project');
    const threadId = 'tid-1';
    await appendRawEvent(cwd, threadId, {
      dir: 'notification',
      method: 'turn/started',
      params: { threadId },
    });
    await appendRawEvent(cwd, threadId, {
      dir: 'rpc_out',
      id: 'client-1',
      method: 'initialize',
    });

    const path = rawLogPath(cwd, threadId);
    const lines = readFileSync(path, 'utf8').trim().split('\n');
    assert.equal(lines.length, 2);

    const first = JSON.parse(lines[0] ?? '{}');
    assert.equal(first.dir, 'notification');
    assert.equal(first.method, 'turn/started');
    assert.equal(typeof first.ts, 'string');
    assert.ok(!Number.isNaN(Date.parse(first.ts)));

    const second = JSON.parse(lines[1] ?? '{}');
    assert.equal(second.dir, 'rpc_out');
    assert.equal(second.method, 'initialize');
  });
});

test('appendRawEvent is a no-op when CODEX_WORKER_RAW_LOG=0', () => {
  return withTempStateRoot(async (tmp) => {
    const cwd = join(tmp, 'project');
    const threadId = 'tid-2';
    const prev = process.env.CODEX_WORKER_RAW_LOG;
    process.env.CODEX_WORKER_RAW_LOG = '0';
    try {
      await appendRawEvent(cwd, threadId, { dir: 'notification', method: 'x' });
      assert.throws(() => readFileSync(rawLogPath(cwd, threadId), 'utf8'));
    } finally {
      if (prev === undefined) delete process.env.CODEX_WORKER_RAW_LOG;
      else process.env.CODEX_WORKER_RAW_LOG = prev;
    }
  });
});
