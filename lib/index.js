/**
 * dsh-plugin-omoslim — preset installer & template renderer, with multiple
 * named model profiles and a user-switchable active one.
 *
 * Installs the bundled agent presets into the harness-home user preset root
 * (~/.dsh/.agent-presets, or $DSH_HOME) on every boot, separating MODEL /
 * (separating MODEL / PROVIDER definitions from the persona COMPOSITION so
 * model tweaks survive plugin updates). Model definitions live in MANY named
 * profiles under a `models.d/` directory, with a user-switchable active one:
 *
 *   plugin bundle:
 *     config/models.d/<name>.json               → factory model profiles (seeds)
 *     config/presets/<id>/agent.cordis.yml.tmpl → composition template; model slots
 *                                                 are @@models.<slot>@@ etc.
 *   user root (~/.dsh/.agent-presets/<id>/):
 *     agent.cordis.yml   → rendered from template + the ACTIVE profile
 *     models.d/*.json    → named model profiles; EDIT/ADD THESE
 *     models.d/default.json → migrated from the legacy single models.json
 *     .generated         → stamp { active, sourceHash, renderedHash }
 *   settings.yaml:
 *     omoslim.active     → the active profile name (default: "default")
 *
 * Each models.d/<name>.json holds the SAME shape as the old models.json: a map
 * of slot → { provider, model }, or the legacy flat slot → "model" string.
 *
 * Model slot formats inside a profile file:
 *   - flat legacy:  "key": "model"                     (provider is inherited)
 *   - structured:   "key": { "provider": null|"p", "model": "m" }
 *
 * Placeholder forms in the template:
 *   - @@models.key@@               = the slot's model (bare slot)
 *   - @@models.key.model@@         = the slot's model
 *   - @@models.key.provider@@      = the slot's provider; null/''/undefined
 *                                    → delete the whole line (subagent inherits
 *                                    the main agent's provider)
 *
 * model is required: a missing/empty model throws (fail-closed). An unknown
 * slot throws. Provider is optional and nullable.
 *
 * Rendering rules (per preset, per boot):
 *   - target preset missing → full install (preset.yml + models.d/default.json
 *     + rendered agent.cordis.yml + stamp).
 *   - legacy single models.json present and models.d/ absent → one-time migrate
 *     to models.d/default.json.
 *   - agent.cordis.yml hash == stamp.renderedHash (untouched since last render)
 *     → re-render from the current template + the CURRENT active profile.
 *   - agent.cordis.yml hash != stamp.renderedHash (user hand-edited the
 *     composition) → leave it alone and warn. Hand-editors own the file.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

export const name = 'dsh-plugin-omoslim';

const thisDir = dirname(fileURLToPath(import.meta.url));
const PRESET_SOURCE = resolve(thisDir, '../config/presets');
const PROFILES_SOURCE = resolve(thisDir, '../config/models.d');
const STAMP_FILE = '.generated';
const PROFILES_DIR = 'models.d';
export const DEFAULT_PROFILE = 'default';
const LEGACY_MODELS_FILE = 'models.json';
const PLACEHOLDER_SOURCE = '@@models\\.([a-z0-9_]+(?:\\.[a-z0-9_]+)*)@@';

/** Harness home: $DSH_HOME when set, otherwise ~/.dsh (same default as dsh-home-paths). */
export function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh');
}

/** The user preset root for a given preset id. */
export function presetTargetDir(id) {
  return join(dshHome(), '.agent-presets', id);
}

export function settingsFile() {
  return join(dshHome(), 'settings.yaml');
}

export function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function log(ctx, level, message) {
  try {
    ctx?.logger?.(name)?.[level]?.(message);
  } catch {
    // never fail boot over logging
  }
}

/**
 * Minimal YAML read for the single `omoslim.active` scalar we own. Avoids a
 * js-yaml dependency: read the whole file, find the `omoslim:` mapping, then
 * its `active:` key. Falls back to "default" on any absence/parse problem.
 * @returns the active profile name recorded in settings.yaml.
 */
export function readSettingsActive() {
  const file = settingsFile();
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return DEFAULT_PROFILE;
  }
  // Locate the top-level `omoslim:` mapping (line whose first non-space char is `o`).
  const lines = text.split('\n');
  let inOmoslim = false;
  for (const line of lines) {
    if (!inOmoslim) {
      if (/^omoslim\s*:/.test(line)) {
        inOmoslim = true;
        // active may be on the same line for JSON-ish flow? no; YAML mapping.
      }
      continue;
    }
    // Inside the omoslim mapping until a line with zero indentation that isn't omoslim.
    if (/^\S/.test(line)) break; // back to top level
    const m = /^\s+active\s*:\s*"?([^"\s]+)"?\s*$/.exec(line);
    if (m) return m[1];
  }
  return DEFAULT_PROFILE;
}

/**
 * Write the `omoslim.active` key into settings.yaml, creating the section when
 * absent. Preserves all other lines (simple text insert, mirroring dsh's
 * comment-preserving intent). Writes atomically by render-then-replace.
 * @param {string} profileName - the active profile name to record.
 */
export function writeSettingsActive(profileName) {
  const file = settingsFile();
  let text = '';
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    text = '';
  }
  const lines = text.split('\n');
  let sectionStart = -1;
  let inOmoslim = false;
  let activeLine = -1;
  let end = lines.length;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inOmoslim) {
      if (/^omoslim\s*:/.test(line)) {
        sectionStart = i;
        inOmoslim = true;
      }
      continue;
    }
    if (/^\S/.test(line)) {
      end = i;
      break;
    }
    if (/^\s+active\s*:/.test(line)) {
      activeLine = i;
      break;
    }
  }

  const activeEntry = `  active: ${profileName}`;
  let out;
  if (sectionStart === -1) {
    // No omoslim section: append at end, keeping a blank separator.
    const trimmed = lines.filter((l) => l.trim() !== '');
    while (trimmed.length && trimmed[trimmed.length - 1].trim() === '') trimmed.pop();
    out = [...trimmed, 'omoslim:', activeEntry, ''].join('\n');
  } else if (activeLine !== -1) {
    const next = [...lines];
    next[activeLine] = activeEntry;
    out = next.join('\n');
  } else {
    // Section exists but no active key: insert right after the section line.
    const next = [...lines];
    next.splice(sectionStart + 1, 0, activeEntry);
    out = next.join('\n');
  }
  writeFileSync(file, out, 'utf8');
}

/**
 * The active profile name. An explicit argument wins (CLI), else reads from
 * settings.yaml, else "default".
 */
export function activeProfileName(activeArg) {
  if (activeArg !== undefined && activeArg !== null && activeArg !== '') return activeArg;
  return readSettingsActive();
}

/**
 * List every named model profile under a preset's models.d directory, in
 * lexical name order. Returns an empty array when the directory is absent.
 * @param {string} targetDir - the preset's target directory.
 * @returns {string[]} profile names (without the .json extension).
 */
export function listProfiles(targetDir) {
  const dir = join(targetDir, PROFILES_DIR);
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -'.json'.length))
    .sort((a, b) => a.localeCompare(b));
}

/** Absolute path of one named profile's file under a preset directory. */
export function profilePath(targetDir, profileName) {
  return join(targetDir, PROFILES_DIR, `${profileName}.json`);
}

/**
 * Read one named profile's models mapping.
 * @param {string} targetDir - preset target directory.
 * @param {string} profileName - profile name.
 * @returns parsed mapping, or undefined when the file is absent/unparsable.
 */
export function readProfile(targetDir, profileName) {
  const file = profilePath(targetDir, profileName);
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

/**
 * Resolve one model slot's display model string, tolerantly (never throws for
 * display). Mirrors the CLI: a flat string value is the model itself; a
 * structured value contributes `value.model`.
 * @param {unknown} value - the slot's raw value from a profile mapping.
 * @returns {string} the model string, or "" when absent/empty.
 */
function slotModel(value) {
  if (typeof value === 'string' && value.length > 0) return value;
  if (value && typeof value === 'object' && typeof value.model === 'string' && value.model.length > 0) return value.model;
  return '';
}

/**
 * Resolve one model slot's display provider string, tolerantly. A provider is
 * only surfaced when it is a non-empty string; anything else (null, omitted,
 * non-string) means the subagent inherits the main agent's provider.
 * @param {unknown} value - the slot's raw value from a profile mapping.
 * @returns {{ provider: string|null, inherited: boolean }}
 */
function slotProvider(value) {
  if (value && typeof value === 'object' && typeof value.provider === 'string' && value.provider.length > 0) {
    return { provider: value.provider, inherited: false };
  }
  return { provider: null, inherited: true };
}

/**
 * Build a read-only, JSON-serializable report of the orchestrator preset's
 * model profiles and the ACTIVE profile's per-subagent provider/model slots.
 * Pure read; never mutates anything. Reads real files under $DSH_HOME or
 * ~/.dsh. Never throws: any per-profile problem is folded into `error` with
 * empty `slots` so the caller can still return a 200.
 *
 * @returns {{
 *   active: string,
 *   profiles: string[],
 *   slots: Array<{ slot: string, model: string, provider: string|null, inherited: boolean }>,
 *   settingsFile: string,
 *   error: string|null,
 * }}
 */
export function buildSubagentModelsReport() {
  const targetDir = presetTargetDir('orchestrator');
  const active = readSettingsActive();
  const profiles = listProfiles(targetDir);
  const settingsFile_ = settingsFile();

  const models = readProfile(targetDir, active);
  if (models === undefined) {
    return {
      active,
      profiles,
      slots: [],
      settingsFile: settingsFile_,
      error: `active profile "${active}" not found / unparsable under ${targetDir}`,
    };
  }

  const slots = Object.entries(models).map(([slot, value]) => {
    const { provider, inherited } = slotProvider(value);
    return { slot, model: slotModel(value), provider, inherited };
  });

  return { active, profiles, slots, settingsFile: settingsFile_, error: null };
}

/**
 * Write a small JSON body to an HTTP response.
 * @param {import('node:http').ServerResponse} response - the HTTP response object.
 * @param {number} status - HTTP status code.
 * @param {unknown} payload - value to JSON-serialize.
 */
export function sendJson(response, status = 200, payload = null) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  response.end(body);
}

/** Resolve one template slot path (e.g. "explorer.provider") against the models mapping. */
export function resolveSlot(models, path) {
  const segments = path.split('.');
  const slot = segments[0];
  if (!(slot in models)) {
    throw new Error(`unknown model slot "@@models.${path}@@" — add it to the active profile or fix the template`);
  }
  const value = models[slot];
  const modelOf = () => {
    if (typeof value === 'string' && value.length > 0) return value;
    if (value && typeof value === 'object' && typeof value.model === 'string' && value.model.length > 0) return value.model;
    throw new Error(`model slot "@@models.${slot}@@" has no model — set a non-empty "model" field in the active profile`);
  };
  if (segments.length === 1) return modelOf();          // 裸槽位 = model
  const field = segments[1];
  if (field === 'model') return modelOf();
  if (field === 'provider') {
    if (value && typeof value === 'object' && typeof value.provider === 'string' && value.provider.length > 0) return value.provider;
    return null;                                         // null = 继承主 agent 的 provider
  }
  throw new Error(`unknown model slot "@@models.${path}@@" — add it to the active profile or fix the template`);
}

/**
 * Render the composition template, replacing @@models.<slot>[.<field>]@@
 * placeholders with the ACTIVE model profile.
 */
export function render(templateText, models) {
  return templateText
    .split('\n')
    .map((line) => {
      const re = new RegExp(PLACEHOLDER_SOURCE, 'g');
      const matches = [...line.matchAll(re)];
      if (matches.length === 0) return line;
      const resolved = matches.map((m) => resolveSlot(models, m[1]));
      // 任一占位符解析为 null/undefined/''（目前只有 provider 允许）→ 删除整行
      if (resolved.some((v) => v === null || v === undefined || v === '')) return null;
      return line.replace(new RegExp(PLACEHOLDER_SOURCE, 'g'), (_m, path) => resolveSlot(models, path));
    })
    .filter((line) => line !== null)
    .join('\n');
}

/**
 * Make sure a preset target has a models.d directory with at least a default
 * profile. Performs the one-time migration of a legacy single models.json into
 * models.d/default.json.
 * @param {object} ctx - plugin context (logging only).
 * @param {string} id - preset id.
 * @param {string} targetDir - target directory.
 * @returns true when a migration/copy happened.
 */
function ensureProfiles(ctx, id, targetDir) {
  mkdirSync(targetDir, { recursive: true });
  const profilesDir = join(targetDir, PROFILES_DIR);
  mkdirSync(profilesDir, { recursive: true });
  let changed = false;

  const defaultFile = join(profilesDir, `${DEFAULT_PROFILE}.json`);

  // Seed every bundled factory profile (config/models.d/*.json) into the user
  // root, NEVER overwriting a profile the user already has. This is what makes
  // new factory profiles (e.g. cheap.json) appear on install/upgrade without
  // clobbering the user's own edits.
  if (existsSync(PROFILES_SOURCE)) {
    try {
      const factoryFiles = readdirSync(PROFILES_SOURCE).filter((f) => f.endsWith('.json'));
      for (const f of factoryFiles) {
        const dest = join(profilesDir, f);
        if (existsSync(dest)) continue;
        try {
          cpSync(join(PROFILES_SOURCE, f), dest, { force: false });
          changed = true;
          log(ctx, 'info', `preset "${id}": seeded factory profile "${f}" → models.d/`);
        } catch (err) {
          log(ctx, 'warn', `preset "${id}": cannot seed profile "${f}": ${err.message}`);
        }
      }
    } catch (err) {
      log(ctx, 'warn', `preset "${id}": cannot read factory profiles dir: ${err.message}`);
    }
  }

  // One-time migration: legacy single models.json → models.d/default.json.
  const legacy = join(targetDir, LEGACY_MODELS_FILE);
  if (!existsSync(defaultFile) && existsSync(legacy)) {
    try {
      const legacyData = JSON.parse(readFileSync(legacy, 'utf8'));
      writeFileSync(defaultFile, JSON.stringify(legacyData, null, 2) + '\n');
      log(ctx, 'info', `preset "${id}": migrated legacy models.json → models.d/default.json`);
      changed = true;
    } catch (err) {
      log(ctx, 'warn', `preset "${id}": legacy models.json is unparsable (${err.message}); seeding bundled defaults`);
    }
  }

  return changed;
}

/**
 * Render the preset's composition once, writing agent.cordis.yml + the stamp,
 * or refusing when the file was hand-edited. Shared by boot install and the
 * CLI switch path. Returns a result record describing what happened.
 *
 * @param {object} ctx - plugin context (logging only; optional).
 * @param {string} id - preset id.
 * @param {string} sourceDir - bundled preset source directory.
 * @param {string} targetDir - target directory under the user preset root.
 * @param {string} active - active profile name.
 * @param {boolean} force - when true, re-render even when the file was
 *   hand-edited (used by an explicit `switch`).
 * @returns {{ installed: boolean, rendered: boolean, skippedHandEdit: boolean }}
 */
export function renderPreset(ctx, id, sourceDir, targetDir, active, force = false) {
  const templateFile = join(sourceDir, 'agent.cordis.yml.tmpl');
  const hasTemplate = existsSync(templateFile);
  const stampFile = join(targetDir, STAMP_FILE);
  let stamp = null;
  if (existsSync(stampFile)) {
    try {
      stamp = JSON.parse(readFileSync(stampFile, 'utf8'));
    } catch {
      stamp = null;
    }
  }

  // 1. Never present at all → full install.
  if (!existsSync(join(targetDir, 'agent.cordis.yml'))) {
    if (!hasTemplate) {
      cpSync(sourceDir, targetDir, { recursive: true });
      log(ctx, 'info', `installed agent preset "${id}" → ${targetDir} (copied as-is, no template)`);
      return { installed: true, rendered: false, skippedHandEdit: false };
    }
    mkdirSync(targetDir, { recursive: true });
    cpSync(join(sourceDir, 'preset.yml'), join(targetDir, 'preset.yml'), { force: true });
    ensureProfiles(ctx, id, targetDir);
    const models = readProfile(targetDir, active);
    if (models === undefined) {
      log(ctx, 'error', `preset "${id}": active profile "${active}" is missing; cannot render`);
      return { installed: false, rendered: false, skippedHandEdit: false };
    }
    const rendered = render(readFileSync(templateFile, 'utf8'), models);
    writeFileSync(join(targetDir, 'agent.cordis.yml'), rendered);
    writeFileSync(stampFile, JSON.stringify({
      active,
      sourceHash: sha256(JSON.stringify(models)),
      renderedHash: sha256(rendered),
    }));
    log(ctx, 'info', `installed agent preset "${id}" → ${targetDir} (rendered from active profile "${active}")`);
    return { installed: true, rendered: true, skippedHandEdit: false };
  }

  // 2. Existing install, no template → keep as-is.
  if (!hasTemplate) {
    log(ctx, 'warn', `preset "${id}": template missing at ${templateFile}; keeping existing files`);
    return { installed: false, rendered: false, skippedHandEdit: false };
  }

  const current = readFileSync(join(targetDir, 'agent.cordis.yml'), 'utf8');
  const currentHash = sha256(current);
  const untouched = stamp !== null && stamp.renderedHash === currentHash;

  if (!untouched && !force) {
    log(ctx, 'warn', `preset "${id}": agent.cordis.yml was hand-edited or its stamp is missing — leaving it alone. To take updates, edit models.d/*.json or delete ${targetDir} to reinstall.`);
    return { installed: false, rendered: false, skippedHandEdit: true };
  }

  const models = readProfile(targetDir, active);
  if (models === undefined) {
    log(ctx, 'error', `preset "${id}": active profile "${active}" is missing; keeping existing files`);
    return { installed: false, rendered: false, skippedHandEdit: false };
  }
  let rendered;
  try {
    rendered = render(readFileSync(templateFile, 'utf8'), models);
  } catch (err) {
    log(ctx, 'error', `preset "${id}": ${err.message}; keeping existing files`);
    return { installed: false, rendered: false, skippedHandEdit: false };
  }
  const sourceHash = sha256(JSON.stringify(models));
  if (rendered === current && stamp?.active === active && stamp?.sourceHash === sourceHash) {
    return { installed: false, rendered: false, skippedHandEdit: false }; // nothing changed
  }
  writeFileSync(join(targetDir, 'agent.cordis.yml'), rendered);
  writeFileSync(stampFile, JSON.stringify({ active, sourceHash, renderedHash: sha256(rendered) }));
  log(ctx, 'info', `preset "${id}": re-rendered agent.cordis.yml from active profile "${active}"`);
  return { installed: false, rendered: true, skippedHandEdit: false };
}

/** Install one preset into the user root; returns true when anything was written. */
function installPreset(ctx, id, sourceDir, targetDir, active) {
  mkdirSync(targetDir, { recursive: true });
  ensureProfiles(ctx, id, targetDir);
  const result = renderPreset(ctx, id, sourceDir, targetDir, active, false);
  return result.installed || result.rendered;
}

export function apply(ctx) {
  let ids;
  try {
    ids = readdirSync(PRESET_SOURCE, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch (err) {
    log(ctx, 'warn', `no bundled presets found at ${PRESET_SOURCE}: ${err.message}`);
    return;
  }
  if (ids.length === 0) {
    log(ctx, 'warn', `no bundled presets found at ${PRESET_SOURCE}`);
    return;
  }
  const active = activeProfileName(undefined);
  const targetRoot = join(dshHome(), '.agent-presets');
  mkdirSync(targetRoot, { recursive: true });
  for (const id of ids) {
    try {
      installPreset(ctx, id, join(PRESET_SOURCE, id), join(targetRoot, id), active);
    } catch (err) {
      log(ctx, 'error', `preset "${id}": install failed: ${err.message}`);
    }
  }

  // Web subagent-model inspector route. Only wired when the webServer host
  // dependency is present (web profile); on a non-web profile inject simply
  // never fires and the rest of the plugin boots unchanged.
  try {
    ctx.inject(['webServer'], (hostCtx) => hostCtx.effect(
      () => hostCtx.webServer.register({
        kind: 'exact',
        path: '/dsh-plugin-omoslim/subagent-models',
        handler: (request, response) => {
          if (request.method !== 'GET') {
            response.writeHead(405, { Allow: 'GET' });
            response.end('method not allowed');
            return;
          }
          let report;
          try {
            report = buildSubagentModelsReport();
          } catch (err) {
            sendJson(response, 500, { error: err instanceof Error ? err.message : String(err) });
            return;
          }
          sendJson(response, 200, report);
        },
      }),
      'dsh-plugin-omoslim: subagent-models route',
    ));
  } catch (err) {
    // Route registration failure must never break boot.
    log(ctx, 'warn', `subagent-models route: failed to register: ${err.message}`);
  }
}
