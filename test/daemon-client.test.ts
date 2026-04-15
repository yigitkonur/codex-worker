import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { sendDaemonRequest } from '../src/daemon/client.js';

function withSettleTimeout<T>(promise: Promise<T>, timeoutMs = 600): Promise<{ type: 'fulfilled'; value: T } | { type: 'rejected'; error: unknown } | { type: 'timeout' }> {
  return Promise.race([
    promise.then((value) => ({ type: 'fulfilled' as const, value }), (error: unknown) => ({ type: 'rejected' as const, error })),
    new Promise<{ type: 'timeout' }>((resolve) => {
      setTimeout(() => resolve({ type: 'timeout' }), timeoutMs).unref();
    }),
  ]);
}

test('sendDaemonRequest rejects when daemon socket closes before a newline-delimited envelope', async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'codex-worker-daemon-client-'));
  const socketDir = join(stateRoot, 'sock');
  await mkdir(socketDir, { recursive: true });
  const socketPath = join(socketDir, 'daemon.sock');

  const previousStateDir = process.env.CODEX_WORKER_STATE_DIR;
  process.env.CODEX_WORKER_STATE_DIR = stateRoot;

  const server = net.createServer((socket) => {
    socket.once('data', () => {
      socket.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => resolve());
  });

  await writeFile(join(stateRoot, 'daemon.json'), JSON.stringify({
    pid: process.pid,
    socketPath,
    token: 'test-token',
    startedAt: new Date().toISOString(),
  }));

  try {
    const settled = await withSettleTimeout(sendDaemonRequest('doctor'));
    assert.equal(settled.type, 'rejected');
    if (settled.type === 'rejected') {
      assert.match(String(settled.error), /closed|ended|connection/i);
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (previousStateDir === undefined) {
      delete process.env.CODEX_WORKER_STATE_DIR;
    } else {
      process.env.CODEX_WORKER_STATE_DIR = previousStateDir;
    }
  }
});
