import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import pkg from '../package.json' with { type: 'json' };
import { stateRootDir } from '../src/core/paths.js';

test('package metadata exposes codex-worker for npm and npx', () => {
  assert.equal(pkg.name, 'codex-worker');
  assert.equal(pkg.bin['codex-worker'], 'bin/codex-worker.mjs');
  assert.equal('cli-codex-worker' in pkg.bin, false);
  assert.match(pkg.repository.url, /\/codex-worker\.git$/);
  assert.match(pkg.homepage, /\/codex-worker#readme$/);
  assert.match(pkg.bugs.url, /\/codex-worker\/issues$/);
});

test('state root prefers new env var, falls back to legacy env var, then new default path', () => {
  const originalState = process.env.CODEX_WORKER_STATE_DIR;
  const originalLegacy = process.env.CLI_CODEX_WORKER_STATE_DIR;

  process.env.CODEX_WORKER_STATE_DIR = '/tmp/codex-worker-state';
  process.env.CLI_CODEX_WORKER_STATE_DIR = '/tmp/legacy-state';
  assert.equal(stateRootDir(), '/tmp/codex-worker-state');

  delete process.env.CODEX_WORKER_STATE_DIR;
  process.env.CLI_CODEX_WORKER_STATE_DIR = '/tmp/legacy-state';
  assert.equal(stateRootDir(), '/tmp/legacy-state');

  delete process.env.CODEX_WORKER_STATE_DIR;
  delete process.env.CLI_CODEX_WORKER_STATE_DIR;
  assert.equal(stateRootDir(), join(homedir(), '.codex-worker'));

  process.env.CODEX_WORKER_STATE_DIR = originalState;
  process.env.CLI_CODEX_WORKER_STATE_DIR = originalLegacy;
});

test('published bin targets compiled output without tsx at runtime', async () => {
  const binSource = await readFile(new URL('../bin/codex-worker.mjs', import.meta.url), 'utf8');
  assert.match(binSource, /dist\/src\/cli\.js/);
  assert.doesNotMatch(binSource, /tsx\/esm\/api/);
});
