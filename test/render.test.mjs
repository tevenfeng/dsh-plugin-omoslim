import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, resolveSlot } from '../lib/index.js';

const thisDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(thisDir, '..');
const tmpl = readFileSync(resolve(repo, 'config/presets/orchestrator/agent.cordis.yml.tmpl'), 'utf8');
const models = JSON.parse(readFileSync(resolve(repo, 'config/models.json'), 'utf8'));

test('nested slots: provider + model both render, indentation preserved', () => {
  const t = 'provider: @@models.explorer.provider@@\n        model: @@models.explorer.model@@';
  const out = render(t, { explorer: { provider: 'opencode-go', model: 'deepseek-v4-flash' } });
  assert.equal(out, 'provider: opencode-go\n        model: deepseek-v4-flash');
});

test('provider null → provider line dropped, model line kept', () => {
  const t =
    '        agentOptions:\n' +
    '          provider: @@models.explorer.provider@@\n' +
    '          model: @@models.explorer.model@@';
  const out = render(t, { explorer: { provider: null, model: 'm' } });
  assert.equal(out, '        agentOptions:\n          model: m');
});

test('legacy flat format: bare slot → model, .provider → null (line dropped)', () => {
  assert.equal(resolveSlot({ explorer: 'x-fast' }, 'explorer'), 'x-fast');
  assert.equal(resolveSlot({ explorer: 'x-fast' }, 'explorer.provider'), null);
  const out = render('provider: @@models.explorer.provider@@', { explorer: 'x-fast' });
  assert.equal(out, '');
});

test('unknown slot throws', () => {
  assert.throws(
    () => render('@@models.nope@@', {}),
    /unknown model slot/
  );
});

test('object slot missing model throws', () => {
  assert.throws(
    () => render('@@models.explorer@@', { explorer: { provider: null } }),
    /has no model/
  );
});

test('empty-string model throws', () => {
  assert.throws(
    () => render('@@models.explorer.model@@', { explorer: { model: '' } }),
    /has no model/
  );
});

test('unknown field throws', () => {
  assert.throws(
    () => render('@@models.explorer.nope@@', { explorer: { model: 'm' } }),
    /unknown model slot/
  );
});

test('placeholder-free line passes through, trailing newline preserved', () => {
  assert.equal(render('a: 1\n', {}), 'a: 1\n');
});

test('integration: real template + real models render cleanly', () => {
  const out = render(tmpl, models);
  assert.ok(!out.includes('@@'), 'no leftover placeholders');
  assert.ok(out.includes('（deepseek-v4-flash）'), 'explorer route row rendered');
  assert.ok(!out.includes('provider: opencode-go'), 'no hardcoded provider');
  assert.ok(out.includes('model: deepseek-v4-flash'), 'explorer agentOptions model rendered');
  assert.ok(out.includes('subagent_councillor_alpha（glm-5.2）'), 'councillor alpha route row');
  assert.ok(out.includes('subagent_council（kimi-k3）'), 'council route row');
});

test('integration 2 (Q1 regression): custom model propagates to route + agentOptions', () => {
  const customModels = { ...models, explorer: { provider: null, model: 'my-custom-model' } };
  const out = render(tmpl, customModels);
  assert.ok(out.includes('subagent_explorer（my-custom-model）'), 'route row uses custom model');
  assert.ok(out.includes('model: my-custom-model'), 'agentOptions uses custom model');
});
