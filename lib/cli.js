#!/usr/bin/env node
/**
 * omoslim — CLI for dsh-plugin-omoslim model profiles.
 *
 * Commands:
 *   omoslim list                    list every profile and mark the active one
 *   omoslim switch <name>           switch the active profile + re-render now
 *   omoslim current                 print the active profile name
 *
 * Switching re-renders agent.cordis.yml in place. dsh mounts each preset's
 * composition once per process, so restart dsh (or the dsh-web service) for
 * the new composition to load, then create a new session.
 */
import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  activeProfileName,
  dshHome,
  listProfiles,
  presetTargetDir,
  readProfile,
  renderPreset,
  writeSettingsActive,
} from './index.js';

const thisDir = dirname(fileURLToPath(import.meta.url));
const PRESET_SOURCE = resolve(thisDir, '../config/presets');

function presetIds() {
  try {
    return readdirSync(PRESET_SOURCE, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

function printProfiles() {
  const active = activeProfileName(undefined);
  const ids = presetIds();
  if (ids.length === 0) {
    console.error('omoslim: no bundled presets found');
    process.exit(1);
  }
  for (const id of ids) {
    const targetDir = presetTargetDir(id);
    const profiles = listProfiles(targetDir);
    console.log(`preset "${id}":`);
    if (profiles.length === 0) {
      console.log('  (no profiles yet)');
      continue;
    }
    for (const name of profiles) {
      const mark = name === active ? ' *' : '';
      const models = readProfile(targetDir, name);
      if (models === undefined) {
        console.log(`  ${name}${mark}  (unparsable)`);
        continue;
      }
      const entries = Object.entries(models);
      console.log(`  ${name}${mark}  (${entries.length} slots)`);
      for (const [slot, value] of entries) {
        const model = typeof value === 'string' ? value : value?.model;
        const provider = value && typeof value === 'object' && typeof value.provider === 'string' ? value.provider : null;
        if (typeof model !== 'string' || model.length === 0) {
          console.log(`      ${slot}: <no model>`);
        } else if (provider) {
          console.log(`      ${slot}: ${provider}/${model}`);
        } else {
          console.log(`      ${slot}: ${model}`);
        }
      }
    }
  }
  console.log('');
  console.log(`active profile: "${active}"`);
  console.log(`settings file : ${join(dshHome(), 'settings.yaml')}`);
}

function switchTo(name) {
  const ids = presetIds();
  if (ids.length === 0) {
    console.error('omoslim: no bundled presets found');
    process.exit(1);
  }
  // Validate the profile exists for at least one preset.
  let exists = false;
  for (const id of ids) {
    if (listProfiles(presetTargetDir(id)).includes(name)) {
      exists = true;
      break;
    }
  }
  if (!exists) {
    console.error(`omoslim: unknown profile "${name}". Available:`);
    for (const id of ids) {
      for (const p of listProfiles(presetTargetDir(id))) {
        console.error(`  ${p}`);
      }
    }
    process.exit(1);
  }

  writeSettingsActive(name);

  // Re-render every preset with the new active profile.
  for (const id of ids) {
    const sourceDir = join(PRESET_SOURCE, id);
    const targetDir = presetTargetDir(id);
    const result = renderPreset(null, id, sourceDir, targetDir, name, true);
    if (result.skippedHandEdit) {
      console.error(`  warn: preset "${id}" agent.cordis.yml was hand-edited; left untouched (delete ${targetDir} to take updates)`);
    }
  }

  console.log('switched active profile to "' + name + '"');
  console.log('restart dsh (or the dsh-web service) so the re-rendered composition is mounted,');
  console.log('then create a new session to use the new models.');
}

const [, , command, arg] = process.argv;

switch (command) {
  case 'list':
    printProfiles();
    break;
  case 'current':
    console.log(activeProfileName(undefined));
    break;
  case 'switch':
    if (!arg) {
      console.error('usage: omoslim switch <name>');
      process.exit(2);
    }
    switchTo(arg);
    break;
  case undefined:
  case 'help':
  case '--help':
  case '-h':
    console.log(`omoslim — dsh-plugin-omoslim model profile switcher

usage:
  omoslim list               list profiles + every slot's provider/model (active marked with *)
  omoslim current            print the active profile name
  omoslim switch <name>      switch active profile + re-render now

Profiles live in ~/.dsh/.agent-presets/<preset>/models.d/*.json.
The active name is stored in ~/.dsh/settings.yaml under omoslim.active.`);
    break;
  default:
    console.error(`omoslim: unknown command "${command}"`);
    process.exit(2);
}
