import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSubagentModelsReport, presetTargetDir } from '../lib/index.js';

const tmp = mkdtempSync(join(tmpdir(), 'omoslim-report-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

const PREV_DSH_HOME = process.env.DSH_HOME;
process.env.DSH_HOME = tmp;
after(() => {
  if (PREV_DSH_HOME === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = PREV_DSH_HOME;
});

const targetDir = presetTargetDir('orchestrator');

function writeProfile(name, data) {
  mkdirSync(join(targetDir, 'models.d'), { recursive: true });
  writeFileSync(join(targetDir, 'models.d', `${name}.json`), JSON.stringify(data), 'utf8');
}

function writeSettings(active) {
  mkdirSync(tmp, { recursive: true });
  writeFileSync(join(tmp, 'settings.yaml'), `omoslim:\n  active: ${active}\n`, 'utf8');
}

test('report: active profile read from settings.yaml + slots in file key order', () => {
  writeProfile('default', {
    explorer: { provider: 'opencode-go', model: 'deepseek-v4-flash' },
    oracle: { model: 'glm-5.2' },
  });
  writeProfile('cheap', { oracle: 'deepseek-v4-flash' });
  writeSettings('default');

  const r = buildSubagentModelsReport();
  assert.equal(r.active, 'default');
  assert.deepEqual(r.profiles, ['cheap', 'default']); // lexical order
  assert.deepEqual(
    r.slots.map((s) => s.slot),
    ['explorer', 'oracle'], // Object.entries(models) order
  );
  assert.deepEqual(r.slots[0], {
    slot: 'explorer',
    model: 'deepseek-v4-flash',
    provider: 'opencode-go',
    inherited: false,
  });
  // provider absent → inherited true + provider null
  assert.deepEqual(r.slots[1], {
    slot: 'oracle',
    model: 'glm-5.2',
    provider: null,
    inherited: true,
  });
  assert.equal(r.error, null);
  assert.equal(r.settingsFile, join(tmp, 'settings.yaml'), 'settingsFile points at the harness home');
});

test('report: flat string value surfaces as model with inherited provider', () => {
  writeProfile('flat', { fixer: 'deepseek-v4-flash' });
  writeSettings('flat');
  const r = buildSubagentModelsReport();
  assert.deepEqual(r.slots, [
    { slot: 'fixer', model: 'deepseek-v4-flash', provider: null, inherited: true },
  ]);
});

test('report: active profile missing → slots [] + friendly error, profiles still listed', () => {
  writeProfile('default', { oracle: 'glm-5.2' });
  writeSettings('ghost');
  const r = buildSubagentModelsReport();
  assert.deepEqual(r.slots, []);
  assert.match(r.error, /ghost/);
  assert.ok(r.profiles.includes('default'), 'other profiles still listed');
});

test('report: unparsable active profile → slots [] + error', () => {
  mkdirSync(join(targetDir, 'models.d'), { recursive: true });
  writeFileSync(join(targetDir, 'models.d', 'broken.json'), '{ not json', 'utf8');
  writeSettings('broken');
  const r = buildSubagentModelsReport();
  assert.deepEqual(r.slots, []);
  assert.match(r.error, /broken/);
});

test('report: settings.yaml absent → active defaults to "default"', () => {
  writeProfile('default', { oracle: 'glm-5.2' });
  rmSync(join(tmp, 'settings.yaml'), { force: true });
  const r = buildSubagentModelsReport();
  assert.equal(r.active, 'default');
});
