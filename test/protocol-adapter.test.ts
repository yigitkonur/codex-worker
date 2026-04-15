import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, mkdir, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pkg from '../package.json' with { type: 'json' };
import { AppServerClient } from '../src/runtime/app-server.js';

test('app-server client handles newline-delimited request/response framing', { concurrency: false }, async () => {
  const binDir = await mkdtemp(join(tmpdir(), 'fake-codex-bin-'));
  const workspaceDir = join(binDir, 'workspace');
  await mkdir(workspaceDir, { recursive: true });
  const fakeCodex = join(binDir, 'codex');
  await writeFile(fakeCodex, `#!/usr/bin/env node
let buffer = '';
let initialize = null;
const send = (payload) => process.stdout.write(JSON.stringify(payload) + '\\n');
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let idx = buffer.indexOf('\\n');
  while (idx >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (line) {
      const msg = JSON.parse(line);
      if (msg.method === 'initialize') {
        initialize = msg.params;
        send({ id: msg.id, result: { userAgent: 'fake/1.0', codexHome: process.env.CODEX_HOME || '', platformFamily: 'unix', platformOs: 'linux' } });
      } else if (msg.method === 'model/list') {
        send({ id: msg.id, result: { data: [{ id: 'gpt-5.4', hidden: false, upgrade: null }], nextCursor: null, initialize, spawnCwd: process.cwd() } });
      }
    }
    idx = buffer.indexOf('\\n');
  }
});
`);
  await chmod(fakeCodex, 0o755);

  const originalPath = process.env.PATH;
  process.env.PATH = `${binDir}:${originalPath ?? ''}`;

  const client = new AppServerClient(workspaceDir, '/tmp/fake-codex-home');
  try {
    await client.start();
    const response = await client.request('model/list', { includeHidden: true });

    assert.ok(Array.isArray(response.data));
    assert.equal((response.data as Array<Record<string, unknown>>)[0]?.id, 'gpt-5.4');
    assert.deepEqual((response.initialize as { clientInfo?: Record<string, unknown> }).clientInfo, {
      name: 'codex-worker',
      title: 'codex-worker',
      version: pkg.version,
    });
    const expectedCwd = await realpath(workspaceDir);
    const actualCwd = await realpath(String(response.spawnCwd));
    assert.equal(actualCwd, expectedCwd);
  } finally {
    await client.stop();
    process.env.PATH = originalPath;
  }
});

test('app-server client start rejects when codex binary cannot be spawned', { concurrency: false }, async () => {
  const binDir = await mkdtemp(join(tmpdir(), 'fake-codex-empty-bin-'));
  const workspaceDir = await mkdtemp(join(tmpdir(), 'fake-codex-workspace-'));

  const originalPath = process.env.PATH;
  process.env.PATH = binDir;

  const client = new AppServerClient(workspaceDir, '/tmp/fake-codex-home');
  try {
    await assert.rejects(
      client.start(),
      /failed to start|ENOENT|not started|spawn/i,
    );
  } finally {
    await client.stop();
    process.env.PATH = originalPath;
  }
});
