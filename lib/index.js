/**
 * dsh-plugin-omoslim — preset installer plugin.
 *
 * Copies the agent presets bundled in this package (config/presets/*) into
 * the harness-home user preset root (~/.dsh/.agent-presets, or $DSH_HOME)
 * on every boot. Idempotent: an existing preset with the same id is kept
 * untouched (the user's copy wins — delete it to reinstall the plugin's
 * version). The agent-presets roster re-reads its roots on every list/resolve,
 * so newly copied presets are visible to new sessions without a restart.
 */
import { cpSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

export const name = 'dsh-plugin-omoslim';

const thisDir = dirname(fileURLToPath(import.meta.url));
const PRESET_SOURCE = resolve(thisDir, '../config/presets');

/** Harness home: $DSH_HOME when set, otherwise ~/.dsh (same default as dsh-home-paths). */
function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh');
}

function log(ctx, level, message) {
  try {
    ctx.logger?.(name)?.[level]?.(message);
  } catch {
    // logger unavailable — never fail boot over logging
  }
}

export function apply(ctx) {
  const targetRoot = join(dshHome(), '.agent-presets');
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
  mkdirSync(targetRoot, { recursive: true });
  for (const id of ids) {
    const from = join(PRESET_SOURCE, id);
    const to = join(targetRoot, id);
    if (existsSync(to)) {
      log(ctx, 'warn', `agent preset "${id}" already exists at ${to} — keeping the existing copy (delete it to reinstall the plugin's version)`);
      continue;
    }
    try {
      cpSync(from, to, { recursive: true });
      log(ctx, 'info', `installed agent preset "${id}" → ${to}`);
    } catch (err) {
      log(ctx, 'error', `failed to install agent preset "${id}": ${err.message}`);
    }
  }
}
