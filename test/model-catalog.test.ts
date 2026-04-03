import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildModelCatalog,
  describeAllowedModels,
  resolveRequestedModel,
} from '../src/core/model-catalog.js';

test('model catalog hides hidden models by default and preserves aliases', () => {
  const catalog = buildModelCatalog([
    { id: 'gpt-5.4', hidden: false, upgrade: null },
    { id: 'gpt-5.4-mini', hidden: false, upgrade: null },
    { id: 'gpt-5.3-codex', hidden: false, upgrade: 'gpt-5.4' },
    { id: 'internal-preview', hidden: true, upgrade: null },
  ]);

  assert.deepEqual(catalog.visibleModelIds, ['gpt-5.3-codex', 'gpt-5.4', 'gpt-5.4-mini']);
  assert.deepEqual(catalog.hiddenModelIds, ['internal-preview']);
  assert.equal(catalog.aliasMappings.length, 1);
  assert.equal(catalog.aliasMappings[0]?.alias, 'gpt-5.3-codex');
  assert.equal(catalog.aliasMappings[0]?.canonical, 'gpt-5.4');
});

test('requested model resolves upgrade aliases', () => {
  const catalog = buildModelCatalog([
    { id: 'gpt-5.4', hidden: false, upgrade: null },
    { id: 'gpt-5.3-codex', hidden: false, upgrade: 'gpt-5.4' },
  ]);

  const resolved = resolveRequestedModel('gpt-5.3-codex', catalog);
  assert.deepEqual(resolved, { resolved: 'gpt-5.4', remappedFrom: 'gpt-5.3-codex' });
});

test('allowed model description includes alias mappings', () => {
  const catalog = buildModelCatalog([
    { id: 'gpt-5.4', hidden: false, upgrade: null },
    { id: 'gpt-5.3-codex', hidden: false, upgrade: 'gpt-5.4' },
  ]);

  const message = describeAllowedModels(catalog);
  assert.match(message, /Allowed models:/);
  assert.match(message, /gpt-5\.4/);
  assert.match(message, /gpt-5\.3-codex -> gpt-5\.4/);
});
