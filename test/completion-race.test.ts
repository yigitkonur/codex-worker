import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FakeAppServerClient } from './helpers/fake-app-server.js';
import { CliCodexWorkerService } from '../src/daemon/service.js';

class CompletingFakeAppServerClient extends FakeAppServerClient {
  private exited = false;
  private sawTurnStart = false;

  override async request(method: string, params: Record<string, unknown> | undefined): Promise<Record<string, unknown>> {
    const response = await super.request(method, params);
    if (method === 'turn/start') {
      this.sawTurnStart = true;
      setTimeout(() => {
        this.emit('notification', {
          method: 'turn/completed',
          params: {
            turn: {
              id: 'turn-1',
              status: 'completed',
            },
          },
        });
      }, 0).unref();
    }
    return response;
  }

  override async stop(): Promise<void> {
    await super.stop();
    if (this.exited || !this.sawTurnStart) {
      return;
    }
    this.exited = true;
    this.emit('exit', { code: 0, signal: 'SIGTERM' });
  }
}

test('sync run stays completed when client exit follows turn completion', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'cli-codex-worker-state-'));
  const originalState = process.env.CLI_CODEX_WORKER_STATE_DIR;
  const originalHomes = process.env.CODEX_HOME_DIRS;
  process.env.CLI_CODEX_WORKER_STATE_DIR = stateDir;
  process.env.CODEX_HOME_DIRS = '/tmp/fake-codex-home';

  const fake = new CompletingFakeAppServerClient('/tmp/workspace', '/tmp/fake-codex-home');
  const service = new CliCodexWorkerService({
    connectionFactory: () => fake as never,
  });
  await service.initialize();

  const result = await service.run({
    cwd: '/tmp/workspace',
    content: 'write smoke-ok',
    inputFilePath: '/tmp/prompt.md',
    async: false,
  });

  assert.equal(result.status, 'completed');

  const threadState = await service.threadRead({ threadId: 'thread-1' });
  const localThread = threadState.localThread as { status: string; lastError?: string };
  const turns = threadState.turns as Array<{ status: string; error?: string }>;

  assert.equal(localThread.status, 'idle');
  assert.equal(localThread.lastError, undefined);
  assert.equal(turns[0]?.status, 'completed');
  assert.equal(turns[0]?.error, undefined);

  process.env.CLI_CODEX_WORKER_STATE_DIR = originalState;
  process.env.CODEX_HOME_DIRS = originalHomes;
});
