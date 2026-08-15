/**
 * dsh-plugin-omoslim — preset installer & template renderer.
 *
 * Installs the bundled agent presets into the harness-home user preset root
 * (~/.dsh/.agent-presets, or $DSH_HOME) on every boot, separating MODEL
 * definitions from the persona COMPOSITION so that model tweaks survive
 * plugin updates:
 *
 *   plugin bundle:
 *     config/models.json                       → default model mapping (independent file)
 *     config/presets/<id>/agent.cordis.yml.tmpl → composition template; model slots
 *                                                 are @@models.<key>@@ placeholders
 *   user root (~/.dsh/.agent-presets/<id>/):
 *     agent.cordis.yml   → rendered from template + models.json (regenerated)
 *     models.json        → the user's model mapping; EDIT THIS for model changes
 *     .generated         → stamp { renderedHash } of the last rendered file
 *
 * Rendering rules (per preset, per boot):
 *   - target preset missing  → full install (preset.yml + models.json + rendered
 *     agent.cordis.yml + stamp).
 *   - agent.cordis.yml hash == stamp.renderedHash (untouched since last render)
 *     → re-render from the current template + the CURRENT models.json (user
 *     edits to models.json take effect on the next boot; plugin template
 *     updates take effect too, preserving model customizations).
 *   - agent.cordis.yml hash != stamp.renderedHash (user hand-edited the
 *     composition) → leave it alone and warn. Hand-editors must own the file.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

export const name = 'dsh-plugin-omoslim';

const thisDir = dirname(fileURLToPath(import.meta.url));
const PRESET_SOURCE = resolve(thisDir, '../config/presets');
const MODELS_SOURCE = resolve(thisDir, '../config/models.json');
const STAMP_FILE = '.generated';
const PLACEHOLDER = /@@models\.([a-z0-9_]+)@@/g;

/** Harness home: $DSH_HOME when set, otherwise ~/.dsh (same default as dsh-home-paths). */
function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh');
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function log(ctx, level, message) {
  try {
    ctx.logger?.(name)?.[level]?.(message);
  } catch {
    // never fail boot over logging
  }
}

/** Read a models.json: prefer the user-root copy (user customizations), fall back to the bundled default. */
function readModels(ctx, presetId, targetDir) {
  const userFile = join(targetDir, 'models.json');
  if (existsSync(userFile)) {
    try {
      return JSON.parse(readFileSync(userFile, 'utf8'));
    } catch (err) {
      log(ctx, 'warn', `preset "${presetId}": models.json at ${userFile} is unparsable (${err.message}); falling back to bundled defaults`);
    }
  }
  return JSON.parse(readFileSync(MODELS_SOURCE, 'utf8'));
}

/** Render the composition template, replacing @@models.<key>@@ with the model mapping. */
function render(templateText, models) {
  return templateText.replace(PLACEHOLDER, (match, key) => {
    if (!(key in models)) {
      throw new Error(`unknown model slot "@@models.${key}@@" — add it to models.json or fix the template`);
    }
    return models[key];
  });
}

/** Install one preset into the user root; returns true when anything was written. */
function installPreset(ctx, id, sourceDir, targetDir) {
  mkdirSync(targetDir, { recursive: true });
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
      return true;
    }
    cpSync(join(sourceDir, 'preset.yml'), join(targetDir, 'preset.yml'), { force: true });
    if (!existsSync(join(targetDir, 'models.json'))) {
      cpSync(MODELS_SOURCE, join(targetDir, 'models.json'), { force: true });
    }
    const models = readModels(ctx, id, targetDir);
    const rendered = render(readFileSync(templateFile, 'utf8'), models);
    writeFileSync(join(targetDir, 'agent.cordis.yml'), rendered);
    writeFileSync(stampFile, JSON.stringify({ renderedHash: sha256(rendered) }));
    log(ctx, 'info', `installed agent preset "${id}" → ${targetDir} (rendered from template)`);
    return true;
  }

  // 2. Existing install.
  if (!hasTemplate) {
    log(ctx, 'warn', `preset "${id}": template missing at ${templateFile}; keeping existing files`);
    return false;
  }
  const current = readFileSync(join(targetDir, 'agent.cordis.yml'), 'utf8');
  const currentHash = sha256(current);
  const untouched = stamp !== null && stamp.renderedHash === currentHash;
  if (!untouched) {
    log(ctx, 'warn', `preset "${id}": agent.cordis.yml was hand-edited or its stamp is missing — leaving it alone. To take plugin updates, edit models.json for models or delete ${targetDir} to reinstall.`);
    return false;
  }
  const models = readModels(ctx, id, targetDir);
  let rendered;
  try {
    rendered = render(readFileSync(templateFile, 'utf8'), models);
  } catch (err) {
    log(ctx, 'error', `preset "${id}": ${err.message}; keeping existing files`);
    return false;
  }
  if (rendered === current) return false; // nothing changed
  writeFileSync(join(targetDir, 'agent.cordis.yml'), rendered);
  writeFileSync(stampFile, JSON.stringify({ renderedHash: sha256(rendered) }));
  log(ctx, 'info', `preset "${id}": re-rendered agent.cordis.yml from template + models.json`);
  return true;
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
  const targetRoot = join(dshHome(), '.agent-presets');
  mkdirSync(targetRoot, { recursive: true });
  for (const id of ids) {
    try {
      installPreset(ctx, id, join(PRESET_SOURCE, id), join(targetRoot, id));
    } catch (err) {
      log(ctx, 'error', `preset "${id}": install failed: ${err.message}`);
    }
  }
}
