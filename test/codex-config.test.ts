import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseCodexConfigToml, readCodexConfig } from '../src/core/codex-config.js';

const REPRODUCER = `
# ── Model ────────────────────────────────────────────────────
model = "gpt-5.4"
service_tier = "fast"
model_reasoning_effort = "medium"
model_provider = "codex-lb"
profile = "default"

approval_policy = "never"
sandbox_mode = "danger-full-access"

requires_openai_auth = false

[model_providers.codex-lb]
name = "OpenAI"
model = "ignored-under-section"
approval_policy = "on-request"
`;

test('parses top-level keys from reporter config', () => {
  const cfg = parseCodexConfigToml(REPRODUCER);
  assert.equal(cfg.model, 'gpt-5.4');
  assert.equal(cfg.modelProvider, 'codex-lb');
  assert.equal(cfg.approvalPolicy, 'never');
  assert.equal(cfg.sandboxMode, 'danger-full-access');
  assert.equal(cfg.requiresOpenaiAuth, false);
});

test('stops at first [section] header and ignores nested keys', () => {
  const cfg = parseCodexConfigToml(REPRODUCER);
  // Nested "model = ignored-under-section" and "approval_policy = on-request"
  // must not override the top-level values.
  assert.equal(cfg.model, 'gpt-5.4');
  assert.equal(cfg.approvalPolicy, 'never');
});

test('strips inline comments outside quoted strings', () => {
  const cfg = parseCodexConfigToml(`model = "gpt-5" # inline comment\nmodel_provider = "prov" # another`);
  assert.equal(cfg.model, 'gpt-5');
  assert.equal(cfg.modelProvider, 'prov');
});

test('preserves # inside quoted strings', () => {
  const cfg = parseCodexConfigToml(`model_provider = "ab#cd"`);
  assert.equal(cfg.modelProvider, 'ab#cd');
});

test('rejects unknown approval_policy and sandbox_mode values', () => {
  const cfg = parseCodexConfigToml(`approval_policy = "bogus"\nsandbox_mode = "bogus"`);
  assert.equal(cfg.approvalPolicy, undefined);
  assert.equal(cfg.sandboxMode, undefined);
});

test('returns empty object when file missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'codex-cfg-'));
  try {
    const cfg = readCodexConfig(dir);
    assert.deepEqual(cfg, {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readCodexConfig reads config.toml when present', () => {
  const dir = mkdtempSync(join(tmpdir(), 'codex-cfg-'));
  try {
    writeFileSync(join(dir, 'config.toml'), 'model_provider = "codex-lb"\nrequires_openai_auth = false\n');
    const cfg = readCodexConfig(dir);
    assert.equal(cfg.modelProvider, 'codex-lb');
    assert.equal(cfg.requiresOpenaiAuth, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
