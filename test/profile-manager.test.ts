import test from 'node:test';
import assert from 'node:assert/strict';

import { appendFleetDeveloperInstructions } from '../src/core/fleet-mode.js';
import { ProfileManager } from '../src/core/profile-manager.js';

test('profile manager reads CODEX_HOME_DIRS and deduplicates', () => {
  const original = process.env.CODEX_HOME_DIRS;
  process.env.CODEX_HOME_DIRS = '/tmp/a:/tmp/b:/tmp/a';
  const manager = ProfileManager.fromEnvironment();
  const profiles = manager.getProfiles();
  assert.equal(profiles.length, 2);
  assert.equal(profiles[0]?.codexHome, '/tmp/a');
  assert.equal(profiles[1]?.codexHome, '/tmp/b');
  process.env.CODEX_HOME_DIRS = original;
});

test('profile manager cooldown excludes failed profile from candidates', () => {
  const manager = new ProfileManager({
    profileDirs: ['/tmp/a', '/tmp/b'],
    now: () => 1_000,
    cooldowns: { rate_limit: 10_000 },
  });

  manager.markFailure('profile-1', 'rate_limit', 'quota');
  const candidates = manager.getCandidateProfiles();
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.codexHome, '/tmp/b');
});

test('fleet developer instructions are appended when enabled', () => {
  const original = process.env.CODEX_ENABLE_FLEET;
  process.env.CODEX_ENABLE_FLEET = '1';
  const output = appendFleetDeveloperInstructions('base instructions');
  assert.match(output ?? '', /base instructions/);
  assert.match(output ?? '', /\[codex-worker:fleet\]/);
  process.env.CODEX_ENABLE_FLEET = original;
});
