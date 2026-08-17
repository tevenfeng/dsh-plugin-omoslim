import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readSettingsActive,
  writeSettingsActive,
  listProfiles,
  readProfile,
  presetTargetDir,
  renderPreset,
  activeProfileName,
} from '../lib/index.js';

const thisDir = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(thisDir, '..');
const PRESET_SOURCE = resolve(REPO, 'config/presets');
const PRESET_ID = 'orchestrator';

// A complete profile must cover every slot the real template references.
// Build a full mapping with a caller-supplied model so we can assert the
// active profile actually drives the rendered output.
function fullProfile(model) {
  const base = {
    explorer: { provider: null, model },
    oracle: { provider: null, model },
    librarian: { provider: null, model },
    designer: { provider: null, model },
    fixer: { provider: null, model },
    councillor_alpha: { provider: null, model },
    councillor_beta: { provider: null, model },
    councillor_gamma: { provider: null, model },
    council: { provider: null, model },
  };
  return base;
}
function writeProfile(targetDir, name, model) {
  mkdirSync(join(targetDir, 'models.d'), { recursive: true });
  writeFileSync(join(targetDir, 'models.d', `${name}.json`), JSON.stringify(fullProfile(model)), 'utf8');
}

function setHome(tmp) {
  const prev = process.env.DSH_HOME;
  process.env.DSH_HOME = tmp;
  return () => {
    if (prev === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = prev;
  };
}

test('writeSettingsActive + readSettingsActive round-trip over a temp DSH_HOME', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'omoslim-'));
  const restore = setHome(tmp);
  try {
    assert.equal(readSettingsActive(), 'default');
    writeSettingsActive('economy');
    assert.equal(readSettingsActive(), 'economy');
    writeSettingsActive('economy'); // idempotent
    assert.equal(readSettingsActive(), 'economy');
    const raw = readFileSync(join(tmp, 'settings.yaml'), 'utf8');
    assert.match(raw, /omoslim:/);
    assert.match(raw, /active: economy/);
  } finally {
    restore();
  }
});

test('writeSettingsActive keeps unrelated top-level keys intact', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'omoslim-'));
  const restore = setHome(tmp);
  try {
    writeFileSync(join(tmp, 'settings.yaml'), 'foo:\n  bar: 1\n', 'utf8');
    writeSettingsActive('pro');
    const raw = readFileSync(join(tmp, 'settings.yaml'), 'utf8');
    assert.match(raw, /foo:/);
    assert.match(raw, /bar: 1/);
    assert.match(raw, /omoslim:/);
    assert.match(raw, /active: pro/);
  } finally {
    restore();
  }
});

test('listProfiles + readProfile read models.d/*.json under a temp preset dir', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'omoslim-'));
  const targetDir = join(tmp, 'orchestrator');
  mkdirSync(join(targetDir, 'models.d'), { recursive: true });
  writeFileSync(join(targetDir, 'models.d', 'default.json'), JSON.stringify({ explorer: { model: 'm1' } }), 'utf8');
  writeFileSync(join(targetDir, 'models.d', 'economy.json'), JSON.stringify({ explorer: { model: 'm2' } }), 'utf8');
  assert.deepEqual(listProfiles(targetDir), ['default', 'economy']);
  assert.deepEqual(readProfile(targetDir, 'default'), { explorer: { model: 'm1' } });
  assert.equal(readProfile(targetDir, 'missing'), undefined);
});

test('renderPreset: full install renders from active profile and stamps it', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'omoslim-'));
  const restore = setHome(tmp);
  try {
    const srcDir = join(PRESET_SOURCE, PRESET_ID);
    const targetDir = presetTargetDir(PRESET_ID);
    // seed two profiles to prove active selection
    writeProfile(targetDir, 'default', 'DEF-MODEL');
    writeProfile(targetDir, 'economy', 'X-FLASH');

    const result = renderPreset({}, PRESET_ID, srcDir, targetDir, 'economy', false);
    assert.equal(result.installed, true);
    const rendered = readFileSync(join(targetDir, 'agent.cordis.yml'), 'utf8');
    assert.ok(rendered.includes('model: X-FLASH'), 'uses economy profile model');
    assert.ok(!rendered.includes('model: DEF-MODEL'), 'does not leak default');
    const stamp = JSON.parse(readFileSync(join(targetDir, '.generated'), 'utf8'));
    assert.equal(stamp.active, 'economy');
    assert.equal(typeof stamp.sourceHash, 'string');
    assert.equal(typeof stamp.renderedHash, 'string');
  } finally {
    restore();
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('renderPreset: switching active profile re-renders when untouched', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'omoslim-'));
  const restore = setHome(tmp);
  try {
    const srcDir = join(PRESET_SOURCE, PRESET_ID);
    const targetDir = presetTargetDir(PRESET_ID);
    writeProfile(targetDir, 'default', 'DEF-MODEL');
    writeProfile(targetDir, 'pro', 'PRO-MODEL');

    // Initial render with default
    renderPreset({}, PRESET_ID, srcDir, targetDir, 'default', false);
    let rendered = readFileSync(join(targetDir, 'agent.cordis.yml'), 'utf8');
    assert.ok(rendered.includes('model: DEF-MODEL'));

    // Switch to pro
    const r = renderPreset({}, PRESET_ID, srcDir, targetDir, 'pro', true);
    assert.equal(r.rendered, true);
    rendered = readFileSync(join(targetDir, 'agent.cordis.yml'), 'utf8');
    assert.ok(rendered.includes('model: PRO-MODEL'), 'switched to pro');
    const stamp = JSON.parse(readFileSync(join(targetDir, '.generated'), 'utf8'));
    assert.equal(stamp.active, 'pro');
  } finally {
    restore();
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('renderPreset: hand-edited composition is left alone without force', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'omoslim-'));
  const restore = setHome(tmp);
  try {
    const srcDir = join(PRESET_SOURCE, PRESET_ID);
    const targetDir = presetTargetDir(PRESET_ID);
    writeProfile(targetDir, 'default', 'M');

    renderPreset({}, PRESET_ID, srcDir, targetDir, 'default', false);
    // user hand-edits the composition
    writeFileSync(join(targetDir, 'agent.cordis.yml'), '# hand edited\n', 'utf8');
    const r = renderPreset({}, PRESET_ID, srcDir, targetDir, 'default', false);
    assert.equal(r.skippedHandEdit, true);
    assert.equal(readFileSync(join(targetDir, 'agent.cordis.yml'), 'utf8'), '# hand edited\n');
  } finally {
    restore();
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('activeProfileName: explicit arg wins, else settings', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'omoslim-'));
  const restore = setHome(tmp);
  try {
    writeSettingsActive('gateway');
    assert.equal(activeProfileName(undefined), 'gateway');
    assert.equal(activeProfileName('explicit'), 'explicit');
    assert.equal(activeProfileName(''), 'gateway'); // empty treated as unset
  } finally {
    restore();
  }
});

test('listProfiles returns [] when models.d is absent', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'omoslim-'));
  assert.deepEqual(listProfiles(join(tmp, 'nope')), []);
});

test('renderPreset: seeds factory profiles (default + cheap) without overwriting user edits', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'omoslim-'));
  const restore = setHome(tmp);
  try {
    const srcDir = join(PRESET_SOURCE, PRESET_ID);
    const targetDir = presetTargetDir(PRESET_ID);

    // Install: factory profiles default + cheap should both be seeded.
    renderPreset({}, PRESET_ID, srcDir, targetDir, 'default', false);
    const profiles = listProfiles(targetDir);
    assert.ok(profiles.includes('default'), 'default seeded');
    assert.ok(profiles.includes('cheap'), 'cheap seeded');

    // cheap profile drives a full render when selected.
    const cheap = readProfile(targetDir, 'cheap');
    assert.equal(cheap.oracle.model, 'deepseek-v4-flash');
    assert.equal(cheap.oracle.provider, 'opencode-go');

    // A pre-existing user profile is NOT overwritten by a later install.
    writeFileSync(join(targetDir, 'models.d', 'default.json'), JSON.stringify(fullProfile('USER-EDITED')), 'utf8');
    // bump install again: ensureProfiles runs, should leave default.json alone
    const before = readFileSync(join(targetDir, 'models.d', 'default.json'), 'utf8');
    renderPreset({}, PRESET_ID, srcDir, targetDir, 'default', true);
    const after = readFileSync(join(targetDir, 'models.d', 'default.json'), 'utf8');
    assert.equal(after, before, 'user-edited default.json preserved');
  } finally {
    restore();
    rmSync(tmp, { recursive: true, force: true });
  }
});
