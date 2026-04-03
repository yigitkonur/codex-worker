import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PersistentStore } from '../src/core/store.js';

test('pending request records persist and can be resolved', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'cli-codex-worker-state-'));
  const original = process.env.CLI_CODEX_WORKER_STATE_DIR;
  process.env.CLI_CODEX_WORKER_STATE_DIR = stateDir;

  const store = new PersistentStore();
  await store.load();
  const pending = store.createPendingRequest({
    requestId: 'sr-1',
    method: 'item/tool/requestUserInput',
    threadId: 'thread-1',
    turnId: 'turn-1',
    connectionKey: 'cwd::home',
    codexHome: '/tmp/home',
    cwd: '/tmp/cwd',
    params: { threadId: 'thread-1' },
  });
  await store.persist();

  const reloaded = new PersistentStore();
  await reloaded.load();
  const loadedPending = reloaded.getPendingRequest(pending.id);
  assert.equal(loadedPending?.status, 'pending');

  reloaded.resolvePendingRequest(pending.id, { decision: 'accept' });
  await reloaded.persist();

  const finalStore = new PersistentStore();
  await finalStore.load();
  const resolved = finalStore.getPendingRequest(pending.id);
  assert.equal(resolved?.status, 'responded');
  assert.deepEqual(resolved?.response, { decision: 'accept' });

  process.env.CLI_CODEX_WORKER_STATE_DIR = original;
});
