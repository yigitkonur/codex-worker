import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CliCodexWorkerService } from '../src/daemon/service.js';
import { FakeAppServerClient } from './helpers/fake-app-server.js';

test('run alias maps to thread start + turn start and returns ids in async mode', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'cli-codex-worker-state-'));
  const originalState = process.env.CLI_CODEX_WORKER_STATE_DIR;
  const originalHomes = process.env.CODEX_HOME_DIRS;
  process.env.CLI_CODEX_WORKER_STATE_DIR = stateDir;
  process.env.CODEX_HOME_DIRS = '/tmp/fake-codex-home';

  const fake = new FakeAppServerClient('/tmp/workspace', '/tmp/fake-codex-home');
  const service = new CliCodexWorkerService({
    connectionFactory: () => fake as never,
  });
  await service.initialize();

  const result = await service.run({
    cwd: '/tmp/workspace',
    content: 'do something',
    inputFilePath: '/tmp/prompt.md',
    async: true,
  });

  assert.equal(result.threadId, 'thread-1');
  assert.equal(result.turnId, 'turn-1');
  assert.equal(result.status, 'inProgress');
  assert.equal(typeof result.actions, 'object');

  process.env.CLI_CODEX_WORKER_STATE_DIR = originalState;
  process.env.CODEX_HOME_DIRS = originalHomes;
});
