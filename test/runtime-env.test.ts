import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import { isCompiledBinary, selfRespawnSpec } from '../src/core/runtime-env.js';

const originalBunVersion = process.versions.bun;
const originalExecPath = process.execPath;
const sourceCliPath = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

test.afterEach(() => {
  if (originalBunVersion === undefined) {
    delete process.versions.bun;
  } else {
    process.versions.bun = originalBunVersion;
  }
  process.execPath = originalExecPath;
});

test('isCompiledBinary returns false outside Bun compiled runtime', () => {
  delete process.versions.bun;
  assert.equal(isCompiledBinary(), false);
});

test('isCompiledBinary returns false when Bun runtime is present but module URL is file-backed', () => {
  process.versions.bun = '1.2.0';
  assert.equal(isCompiledBinary(), false);
});

test('selfRespawnSpec in non-compiled Bun runtime keeps Node/npm/bin fallback shape', () => {
  process.versions.bun = '1.2.0';
  process.execPath = '/tmp/bun';

  const spec = selfRespawnSpec('daemon-run');
  assert.equal(spec.command, '/tmp/bun');
  assert.equal(spec.args.at(-2), sourceCliPath);
  assert.equal(spec.args.at(-1), 'daemon-run');
  assert.equal(spec.args.includes('--import'), false);
  assert.equal(spec.args.includes('tsx'), false);
});

test('selfRespawnSpec always forwards the requested subcommand', () => {
  delete process.versions.bun;
  process.execPath = '/tmp/node';

  const spec = selfRespawnSpec('daemon-run');

  assert.equal(spec.command, '/tmp/node');
  assert.deepEqual(spec.args.slice(0, 2), ['--import', 'tsx']);
  assert.equal(spec.args.at(-1), 'daemon-run');
});
