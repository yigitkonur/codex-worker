import test from 'node:test';
import assert from 'node:assert/strict';

import { RELEASE_TARGETS, shouldUseHostBytecode } from '../scripts/build-binary.mjs';
import { resolveSpawnCommand } from '../scripts/spawn-command.mjs';

test('resolveSpawnCommand wraps Windows cmd shims via cmd.exe', () => {
  const spec = resolveSpawnCommand('C:\\repo\\node_modules\\.bin\\bun.cmd', 'win32', 'C:\\Windows\\System32\\cmd.exe');
  assert.equal(spec.command, 'C:\\Windows\\System32\\cmd.exe');
  assert.deepEqual(spec.args, ['/d', '/s', '/c', 'C:\\repo\\node_modules\\.bin\\bun.cmd']);
});

test('resolveSpawnCommand leaves native executables untouched', () => {
  const spec = resolveSpawnCommand('/repo/node_modules/bun/bin/bun', 'linux');
  assert.equal(spec.command, '/repo/node_modules/bun/bin/bun');
  assert.deepEqual(spec.args, []);
});

test('windows release target keeps bytecode disabled until Bun compile supports this CLI shape', () => {
  const target = RELEASE_TARGETS.find((entry: { id: string }) => entry.id === 'windows-x64');
  assert.ok(target, 'expected windows-x64 target');
  assert.equal(target.bytecode, false);
});

test('host builds keep bytecode disabled too', () => {
  assert.equal(shouldUseHostBytecode(), false);
});
