import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AppServerClient } from '../src/runtime/app-server.js';

test('app-server client handles newline-delimited request/response framing', async () => {
  const binDir = await mkdtemp(join(tmpdir(), 'fake-codex-bin-'));
  const fakeCodex = join(binDir, 'codex');
  await writeFile(fakeCodex, `#!/usr/bin/env node
let buffer = '';
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
        send({ id: msg.id, result: { userAgent: 'fake/1.0', codexHome: process.env.CODEX_HOME || '', platformFamily: 'unix', platformOs: 'linux' } });
      } else if (msg.method === 'model/list') {
        send({ id: msg.id, result: { data: [{ id: 'gpt-5.4', hidden: false, upgrade: null }], nextCursor: null } });
      }
    }
    idx = buffer.indexOf('\\n');
  }
});
`);
  await chmod(fakeCodex, 0o755);

  const originalPath = process.env.PATH;
  process.env.PATH = `${binDir}:${originalPath ?? ''}`;

  const client = new AppServerClient(process.cwd(), '/tmp/fake-codex-home');
  await client.start();
  const response = await client.request('model/list', { includeHidden: true });
  await client.stop();

  assert.ok(Array.isArray(response.data));
  assert.equal((response.data as Array<Record<string, unknown>>)[0]?.id, 'gpt-5.4');

  process.env.PATH = originalPath;
});
