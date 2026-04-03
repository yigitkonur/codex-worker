import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CliCodexWorkerService } from '../src/daemon/service.js';
import { FakeAppServerClient } from './helpers/fake-app-server.js';

test('server request is persisted and can be responded later', async () => {
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

  await service.threadStart({ cwd: '/tmp/workspace' });
  await service.turnStart({
    threadId: 'thread-1',
    prompt: 'question?',
    async: true,
  });

  fake.emit('serverRequest', {
    id: 'request-1',
    method: 'item/tool/requestUserInput',
    params: {
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'item-1',
      questions: [{ id: 'q1', question: 'continue?', header: '', isOther: true, isSecret: false, options: null }],
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  const requests = await service.requestList({});
  const entries = requests.data as Array<{ id: string; status: string }>;
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.status, 'pending');

  const response = await service.requestRespond({
    requestId: entries[0]?.id,
    answer: 'yes',
  });
  assert.equal(response.status, 'responded');
  assert.equal(fake.responses.length, 1);

  process.env.CLI_CODEX_WORKER_STATE_DIR = originalState;
  process.env.CODEX_HOME_DIRS = originalHomes;
});
