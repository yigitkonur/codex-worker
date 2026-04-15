import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FakeAppServerClient } from './helpers/fake-app-server.js';
import { CliCodexWorkerService } from '../src/daemon/service.js';

class NotificationStreamFakeClient extends FakeAppServerClient {
  schedule: Array<{ delayMs: number; method: string; params?: Record<string, unknown> }> = [];

  override async request(method: string, params: Record<string, unknown> | undefined): Promise<Record<string, unknown>> {
    const response = await super.request(method, params);
    if (method === 'turn/start') {
      for (const step of this.schedule) {
        setTimeout(() => {
          this.emit('notification', { method: step.method, params: step.params ?? {} });
        }, step.delayMs).unref();
      }
    }
    return response;
  }
}

async function withEnv(name: string, value: string | undefined, body: () => Promise<void>): Promise<void> {
  const prev = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    await body();
  } finally {
    if (prev === undefined) delete process.env[name];
    else process.env[name] = prev;
  }
}

test('idle watchdog fails a turn when the wire stays silent', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'cli-codex-worker-state-'));
  await withEnv('CLI_CODEX_WORKER_STATE_DIR', stateDir, async () => {
    await withEnv('CODEX_HOME_DIRS', '/tmp/fake-codex-home', async () => {
      await withEnv('CODEX_WORKER_TURN_TIMEOUT_MS', '120', async () => {
        const fake = new NotificationStreamFakeClient('/tmp/workspace', '/tmp/fake-codex-home');
        const service = new CliCodexWorkerService({ connectionFactory: () => fake as never });
        await service.initialize();

        const started = await service.run({
          cwd: '/tmp/workspace',
          content: 'be silent',
          inputFilePath: '/tmp/prompt.md',
          async: true,
        });
        const threadId = String(started.threadId);
        assert.ok(threadId);

        await new Promise((r) => setTimeout(r, 350));

        const snapshot = await service.threadRead({ threadId });
        const localThread = snapshot.localThread as { status: string; lastError?: string };
        const turns = snapshot.turns as Array<{ status: string; error?: string }>;

        assert.equal(localThread.status, 'failed');
        assert.match(String(localThread.lastError ?? ''), /Idle turn timeout/);
        assert.equal(turns[0]?.status, 'failed');
      });
    });
  });
});

test('idle watchdog resets on every notification — long turn with activity does not fail', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'cli-codex-worker-state-'));
  await withEnv('CLI_CODEX_WORKER_STATE_DIR', stateDir, async () => {
    await withEnv('CODEX_HOME_DIRS', '/tmp/fake-codex-home', async () => {
      await withEnv('CODEX_WORKER_TURN_TIMEOUT_MS', '300', async () => {
        const fake = new NotificationStreamFakeClient('/tmp/workspace', '/tmp/fake-codex-home');
        // Heartbeats every 100 ms for 500 ms — gaps < 300 ms window, so watchdog never fires.
        fake.schedule = [100, 200, 300, 400, 500].map((delayMs) => ({
          delayMs,
          method: 'item/agentMessage/delta',
          params: { delta: 'x' },
        }));
        fake.schedule.push({
          delayMs: 600,
          method: 'turn/completed',
          params: { turn: { id: 'turn-1', status: 'completed' } },
        });

        const service = new CliCodexWorkerService({ connectionFactory: () => fake as never });
        await service.initialize();

        await service.run({
          cwd: '/tmp/workspace',
          content: 'heartbeat run',
          inputFilePath: '/tmp/prompt.md',
          async: true,
        });

        // Wait for the scheduled completion plus a little slack.
        await new Promise((r) => setTimeout(r, 900));

        const snapshot = await service.threadRead({ threadId: 'thread-1' });
        const localThread = snapshot.localThread as { status: string; lastError?: string };
        const turns = snapshot.turns as Array<{ status: string }>;
        assert.equal(localThread.status, 'idle');
        assert.equal(localThread.lastError, undefined);
        assert.equal(turns[0]?.status, 'completed');
      });
    });
  });
});
