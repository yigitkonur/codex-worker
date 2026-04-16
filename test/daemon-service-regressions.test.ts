import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CliCodexWorkerService } from '../src/daemon/service.js';
import { FakeAppServerClient } from './helpers/fake-app-server.js';

async function createServiceHarness() {
  const stateDir = await mkdtemp(join(tmpdir(), 'codex-worker-state-'));
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

  const cleanup = () => {
    if (originalState === undefined) delete process.env.CLI_CODEX_WORKER_STATE_DIR;
    else process.env.CLI_CODEX_WORKER_STATE_DIR = originalState;
    if (originalHomes === undefined) delete process.env.CODEX_HOME_DIRS;
    else process.env.CODEX_HOME_DIRS = originalHomes;
  };

  return { fake, service, cleanup };
}

test('turn.steer reuses the live execution client and existing job/turn records', async () => {
  const { fake, service, cleanup } = await createServiceHarness();
  try {
    const started = await service.turnStart({
      threadId: 'thread-1',
      prompt: 'first prompt',
      async: true,
    });

    const beforeResumeCount = fake.requests.filter((entry) => entry.method === 'thread/resume').length;
    const beforeTurnCount = service.store.listTurns('thread-1').length;
    const beforeJobCount = service.store.listJobs().filter((job) => job.threadId === 'thread-1').length;

    fake.turnSteerResponseTurnId = 'turn-1';
    const result = await service.turnSteer({
      threadId: 'thread-1',
      expectedTurnId: 'turn-1',
      prompt: 'follow the same live turn',
      async: true,
    });

    const afterResumeCount = fake.requests.filter((entry) => entry.method === 'thread/resume').length;
    assert.equal(afterResumeCount, beforeResumeCount);
    assert.equal(result.turnId, started.turnId);
    assert.equal((result.job as { id?: string })?.id, (started.job as { id?: string })?.id);
    assert.equal(service.store.listTurns('thread-1').length, beforeTurnCount);
    assert.equal(service.store.listJobs().filter((job) => job.threadId === 'thread-1').length, beforeJobCount);
    assert.equal(fake.requests.at(-1)?.method, 'turn/steer');
  } finally {
    cleanup();
  }
});

test('retryable notification errors do not fail the active execution', async () => {
  const { fake, service, cleanup } = await createServiceHarness();
  try {
    await service.turnStart({
      threadId: 'thread-1',
      prompt: 'keep running on retryable error',
      async: true,
    });

    fake.emit('notification', {
      method: 'error',
      params: {
        willRetry: true,
        error: {
          message: 'temporary disconnect',
          codexErrorInfo: { type: 'connection' },
        },
      },
    });

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.notEqual(service.store.getTurn('turn-1')?.status, 'failed');
  assert.equal(service.store.getThread('thread-1')?.status, 'running');
  } finally {
    cleanup();
  }
});

test('terminal notification errors persist structured detail', async () => {
  const { fake, service, cleanup } = await createServiceHarness();
  try {
    await service.turnStart({
      threadId: 'thread-1',
      prompt: 'fail with structured detail',
      async: true,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    fake.emit('notification', {
      method: 'error',
      params: {
        willRetry: false,
        error: {
          message: 'backend rejected the turn',
          codexErrorInfo: { type: 'other', reason: 'provider_failure' },
        },
      },
    });

    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (service.store.getTurn('turn-1')?.status === 'failed') {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const snapshot = await service.read({ threadId: 'thread-1', tailLines: 0 });
    const turns = snapshot.turns as Array<{ error?: string; errorInfo?: { tag?: string; message?: string; raw?: Record<string, unknown> } }>;
    assert.equal(turns[0]?.error, 'backend rejected the turn');
    assert.equal(turns[0]?.errorInfo?.tag, 'other');
    assert.equal(turns[0]?.errorInfo?.message, 'backend rejected the turn');
    assert.deepEqual(turns[0]?.errorInfo?.raw, { type: 'other', reason: 'provider_failure' });
  } finally {
    cleanup();
  }
});

test('turn/completed failure preserves structured turn.error detail', async () => {
  const { fake, service, cleanup } = await createServiceHarness();
  try {
    await service.turnStart({
      threadId: 'thread-1',
      prompt: 'fail from turn/completed',
      async: true,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    fake.emit('notification', {
      method: 'turn/completed',
      params: {
        turn: {
          id: 'turn-1',
          status: 'failed',
          error: {
            message: 'review failed',
            codexErrorInfo: { type: 'other', reason: 'review_failure' },
          },
        },
      },
    });

    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (service.store.getTurn('turn-1')?.status === 'failed') {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const snapshot = await service.read({ threadId: 'thread-1', tailLines: 0 });
    const turns = snapshot.turns as Array<{ error?: string; errorInfo?: { tag?: string; message?: string; raw?: Record<string, unknown> } }>;
    assert.equal(turns[0]?.error, 'review failed');
    assert.equal(turns[0]?.errorInfo?.tag, 'other');
    assert.equal(turns[0]?.errorInfo?.message, 'review failed');
    assert.deepEqual(turns[0]?.errorInfo?.raw, { type: 'other', reason: 'review_failure' });
  } finally {
    cleanup();
  }
});

test('error notification with codexErrorInfo string maps to correct tag', async () => {
  const { fake, service, cleanup } = await createServiceHarness();
  try {
    await service.turnStart({
      threadId: 'thread-1',
      prompt: 'fail with string codexErrorInfo',
      async: true,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    fake.emit('notification', {
      method: 'error',
      params: {
        willRetry: false,
        error: {
          message: 'Context window exceeded',
          codexErrorInfo: 'contextWindowExceeded',
        },
      },
    });

    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (service.store.getTurn('turn-1')?.status === 'failed') break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const turn = service.store.getTurn('turn-1');
    assert.equal(turn?.error, 'Context window exceeded');
    assert.equal(turn?.errorInfo?.tag, 'context_window_exceeded');
    assert.deepEqual(turn?.errorInfo?.raw, { value: 'contextWindowExceeded' });
  } finally {
    cleanup();
  }
});

test('error notification with httpConnectionFailed extracts httpStatusCode', async () => {
  const { fake, service, cleanup } = await createServiceHarness();
  try {
    await service.turnStart({
      threadId: 'thread-1',
      prompt: 'fail with http status',
      async: true,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    fake.emit('notification', {
      method: 'error',
      params: {
        willRetry: false,
        error: {
          message: 'Upstream connection failed',
          codexErrorInfo: { httpConnectionFailed: { httpStatusCode: 502 } },
          additionalDetails: 'Retry 3 of 3 exhausted',
        },
      },
    });

    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (service.store.getTurn('turn-1')?.status === 'failed') break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const turn = service.store.getTurn('turn-1');
    assert.equal(turn?.errorInfo?.tag, 'http_connection_failed');
    assert.equal(turn?.errorInfo?.httpStatusCode, 502);
    assert.equal(turn?.errorInfo?.additionalDetails, 'Retry 3 of 3 exhausted');
    assert.equal(turn?.errorInfo?.message, 'Upstream connection failed');
  } finally {
    cleanup();
  }
});

test('willRetry error writes retrying transcript event without failing turn', async () => {
  const { fake, service, cleanup } = await createServiceHarness();
  try {
    await service.turnStart({
      threadId: 'thread-1',
      prompt: 'retry scenario',
      async: true,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    fake.emit('notification', {
      method: 'error',
      params: {
        willRetry: true,
        error: {
          message: 'server overloaded',
          codexErrorInfo: 'serverOverloaded',
        },
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    const turn = service.store.getTurn('turn-1');
    assert.notEqual(turn?.status, 'failed');
    assert.equal(service.store.getThread('thread-1')?.status, 'running');

    // Check transcript has the retrying event
    const snapshot = await service.read({ threadId: 'thread-1', tailLines: 20 });
    const artifacts = snapshot.artifacts as Record<string, unknown>;
    const events = artifacts.recentEvents as Array<Record<string, unknown>>;
    const retryingEvent = events.find((e) => e.type === 'turn.retrying');
    assert.ok(retryingEvent, 'transcript should contain a turn.retrying event');
    assert.equal(retryingEvent?.tag, 'server_overloaded');
  } finally {
    cleanup();
  }
});

test('idle timeout failure has idle_timeout tag', async () => {
  const originalTimeout = process.env.CODEX_WORKER_TURN_TIMEOUT_MS;
  process.env.CODEX_WORKER_TURN_TIMEOUT_MS = '200';
  const { fake, service, cleanup } = await createServiceHarness();
  try {
    await service.turnStart({
      threadId: 'thread-1',
      prompt: 'idle timeout test',
      async: true,
    });

    // Wait for the idle watchdog to fire (200ms timeout + buffer)
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (service.store.getTurn('turn-1')?.status === 'failed') break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const turn = service.store.getTurn('turn-1');
    assert.equal(turn?.status, 'failed');
    assert.equal(turn?.errorInfo?.tag, 'idle_timeout');
    assert.ok(turn?.error?.includes('Idle turn timeout'));
  } finally {
    if (originalTimeout === undefined) delete process.env.CODEX_WORKER_TURN_TIMEOUT_MS;
    else process.env.CODEX_WORKER_TURN_TIMEOUT_MS = originalTimeout;
    cleanup();
  }
});

test('raw log captures the first rpc_out and rpc_in frame for turn start', async () => {
  const { fake, service, cleanup } = await createServiceHarness();
  try {
    fake.emitLowLevelRpcFrames = true;
    const result = await service.turnStart({
      threadId: 'thread-1',
      prompt: 'capture the first frame',
      async: true,
    });

    const rawPath = String(((await service.read({ threadId: String(result.threadId), tailLines: 0 })).artifacts as Record<string, unknown>).rawLogPath);
    let lines: Array<Record<string, unknown>> = [];
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        lines = (await readFile(rawPath, 'utf8'))
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line) as Record<string, unknown>);
        if (lines.some((entry) => entry.dir === 'rpc_out' && entry.method === 'turn/start')) {
          break;
        }
      } catch {
        // continue polling
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    assert.ok(lines.some((entry) => entry.dir === 'rpc_out' && entry.method === 'turn/start'));
    assert.ok(lines.some((entry) => entry.dir === 'rpc_in'));
  } finally {
    cleanup();
  }
});

test('raw log captures the first rpc_out and rpc_in frame for thread resume', async () => {
  const { fake, service, cleanup } = await createServiceHarness();
  try {
    fake.emitLowLevelRpcFrames = true;
    await service.threadResume({ threadId: 'thread-1' });

    const rawPath = String(((await service.read({ threadId: 'thread-1', tailLines: 0 })).artifacts as Record<string, unknown>).rawLogPath);
    let lines: Array<Record<string, unknown>> = [];
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        lines = (await readFile(rawPath, 'utf8'))
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line) as Record<string, unknown>);
        if (lines.some((entry) => entry.dir === 'rpc_out' && entry.method === 'thread/resume')) {
          break;
        }
      } catch {
        // continue polling
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    assert.ok(lines.some((entry) => entry.dir === 'rpc_out' && entry.method === 'thread/resume'));
    assert.ok(lines.some((entry) => entry.dir === 'rpc_in'));
  } finally {
    cleanup();
  }
});
