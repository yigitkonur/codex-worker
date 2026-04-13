import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

import { ensureStateRoot } from '../src/core/paths.js';
import { runDaemonServer } from '../src/daemon/server.js';

async function waitForSocket(path: string): Promise<void> {
  for (let index = 0; index < 50; index += 1) {
    if (existsSync(path)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Socket not ready: ${path}`);
}

async function send(socketPath: string, token: string, command: string): Promise<Record<string, unknown>> {
  return await new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let buffer = '';
    socket.on('connect', () => {
      socket.write(`${JSON.stringify({ id: '1', token, command })}\n`);
    });
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const line = buffer.trim();
      if (!line) {
        return;
      }
      socket.end();
      const parsed = JSON.parse(line) as Record<string, unknown>;
      resolve(parsed);
    });
    socket.on('error', reject);
  });
}

test('daemon socket responds to daemon.status', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'cli-codex-worker-state-'));
  const token = 'token-test';
  const originalNewState = process.env.CODEX_WORKER_STATE_DIR;
  const originalState = process.env.CLI_CODEX_WORKER_STATE_DIR;
  const originalNewSocket = process.env.CODEX_WORKER_DAEMON_SOCKET;
  const originalSocket = process.env.CLI_CODEX_WORKER_DAEMON_SOCKET;
  const originalNewToken = process.env.CODEX_WORKER_DAEMON_TOKEN;
  const originalToken = process.env.CLI_CODEX_WORKER_DAEMON_TOKEN;

  process.env.CODEX_WORKER_STATE_DIR = stateDir;
  const socketPath = join(stateDir, 'daemon.sock');
  process.env.CODEX_WORKER_DAEMON_SOCKET = socketPath;
  process.env.CODEX_WORKER_DAEMON_TOKEN = token;

  void runDaemonServer();
  await waitForSocket(socketPath);

  const status = await send(socketPath, token, 'daemon.status');
  assert.equal(status.type, 'result');
  assert.equal((status.data as Record<string, unknown>)?.status, 'running');

  const stop = await send(socketPath, token, 'daemon.stop');
  assert.equal(stop.type, 'result');

  process.env.CODEX_WORKER_STATE_DIR = originalNewState;
  process.env.CLI_CODEX_WORKER_STATE_DIR = originalState;
  process.env.CODEX_WORKER_DAEMON_SOCKET = originalNewSocket;
  process.env.CLI_CODEX_WORKER_DAEMON_SOCKET = originalSocket;
  process.env.CODEX_WORKER_DAEMON_TOKEN = originalNewToken;
  process.env.CLI_CODEX_WORKER_DAEMON_TOKEN = originalToken;

  const root = ensureStateRoot();
  assert.ok(root.rootDir.length > 0);
});
