import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { readPackageMetadata } from '../src/core/package-meta.js';

test('package metadata resolver prefers the project root package.json over dist/package.json', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codex-worker-package-meta-'));
  await mkdir(join(root, 'src'), { recursive: true });
  await mkdir(join(root, 'src', 'runtime'), { recursive: true });
  await mkdir(join(root, 'dist', 'src'), { recursive: true });
  await mkdir(join(root, 'dist', 'src', 'runtime'), { recursive: true });

  await writeFile(join(root, 'package.json'), JSON.stringify({
    name: 'codex-worker',
    version: '9.9.9',
  }));
  await writeFile(join(root, 'dist', 'package.json'), JSON.stringify({
    name: 'codex-worker',
    version: '0.0.1',
  }));

  const sourceMeta = readPackageMetadata(pathToFileURL(join(root, 'src', 'cli.ts')).href);
  const distMeta = readPackageMetadata(pathToFileURL(join(root, 'dist', 'src', 'cli.js')).href);
  const sourceRuntimeMeta = readPackageMetadata(pathToFileURL(join(root, 'src', 'runtime', 'app-server.ts')).href);
  const distRuntimeMeta = readPackageMetadata(pathToFileURL(join(root, 'dist', 'src', 'runtime', 'app-server.js')).href);

  assert.deepEqual(sourceMeta, { name: 'codex-worker', version: '9.9.9' });
  assert.deepEqual(distMeta, { name: 'codex-worker', version: '9.9.9' });
  assert.deepEqual(sourceRuntimeMeta, { name: 'codex-worker', version: '9.9.9' });
  assert.deepEqual(distRuntimeMeta, { name: 'codex-worker', version: '9.9.9' });
});
