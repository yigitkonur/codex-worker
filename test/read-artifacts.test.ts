import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CliCodexWorkerService } from '../src/daemon/service.js';
import { FakeAppServerClient } from './helpers/fake-app-server.js';

test('read exposes transcript and execution log artifacts with recent tails', async () => {
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

  service.store.upsertThread({
    id: 'thread-1',
    cwd: '/tmp/workspace',
    codexHome: '/tmp/fake-codex-home',
    model: 'gpt-5.4',
    modelProvider: 'openai',
    status: 'idle',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    latestTurnId: 'turn-1',
  });
  service.store.upsertTurn({
    id: 'turn-1',
    threadId: 'thread-1',
    status: 'completed',
    source: 'alias/run',
    promptPreview: 'write lorem.txt',
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    inputFilePath: '/tmp/workspace/prompt.md',
  });
  await service.store.appendThreadEvent({
    cwd: '/tmp/workspace',
    threadId: 'thread-1',
    payload: { type: 'user', text: 'write lorem.txt' },
    logLine: '> write lorem.txt',
  });
  await service.store.appendThreadEvent({
    cwd: '/tmp/workspace',
    threadId: 'thread-1',
    payload: { type: 'assistant.delta', delta: 'l' },
    logLine: 'l',
  });
  await service.store.appendThreadEvent({
    cwd: '/tmp/workspace',
    threadId: 'thread-1',
    payload: { type: 'assistant.delta', delta: 'orem' },
    logLine: 'orem',
  });
  await service.store.appendThreadEvent({
    cwd: '/tmp/workspace',
    threadId: 'thread-1',
    payload: { type: 'assistant.delta', delta: '-written' },
    logLine: '-written',
  });
  await service.store.appendThreadEvent({
    cwd: '/tmp/workspace',
    threadId: 'thread-1',
    payload: {
      type: 'notification',
      method: 'item/completed',
      params: {
        item: {
          type: 'agentMessage',
          text: 'lorem-written',
        },
      },
    },
    logLine: 'lorem-written',
  });
  await service.store.persist();

  const result = await service.read({
    threadId: 'thread-1',
    tailLines: 5,
  });

  const artifacts = result.artifacts as {
    transcriptPath: string;
    logPath: string;
    recentEvents: Array<Record<string, unknown>>;
    logTail: string[];
    displayLog: string[];
  };
  assert.ok(artifacts.transcriptPath.endsWith('thread-1.jsonl'));
  assert.ok(artifacts.logPath.endsWith('thread-1.output'));
  assert.deepEqual(artifacts.logTail.slice(-4), ['l', 'orem', '-written', 'lorem-written']);
  assert.equal(artifacts.recentEvents.length, 5);
  assert.equal(artifacts.recentEvents.at(-1)?.type, 'notification');
  assert.deepEqual(artifacts.displayLog, ['> write lorem.txt', 'lorem-written']);

  process.env.CLI_CODEX_WORKER_STATE_DIR = originalState;
  process.env.CODEX_HOME_DIRS = originalHomes;
});
