import test from 'node:test';
import assert from 'node:assert/strict';

import { renderHomebrewFormula } from '../scripts/render-homebrew-formula.mjs';

test('renderHomebrewFormula emits architecture-specific Homebrew formula for GitHub release binaries', () => {
  const formula = renderHomebrewFormula({
    version: '0.1.4',
    repoSlug: 'yigitkonur/codex-worker',
    description: 'Daemon-backed Codex app-server worker CLI',
    homepage: 'https://github.com/yigitkonur/codex-worker',
    license: 'MIT',
    sha256: {
      darwinX64: 'a'.repeat(64),
      darwinArm64: 'b'.repeat(64),
      linuxX64: 'c'.repeat(64),
      linuxArm64: 'd'.repeat(64),
    },
  });

  assert.match(formula, /class CodexWorker < Formula/);
  assert.match(formula, /version "0\.1\.4"/);
  assert.match(formula, /on_macos do/);
  assert.match(formula, /on_linux do/);
  assert.match(formula, /codex-worker-darwin-arm64/);
  assert.match(formula, /codex-worker-darwin-x64/);
  assert.match(formula, /codex-worker-linux-arm64/);
  assert.match(formula, /codex-worker-linux-x64/);
  assert.match(formula, /bin\.install downloaded_file => "codex-worker"/);
  assert.match(formula, /assert_match version\.to_s, shell_output\("\#\{bin\}\/codex-worker --version"\)/);
});
