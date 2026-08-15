# dsh-plugin-omoslim

DeepSeek Harness (`dsh`) bundle that installs an **Orchestrator agent preset**
in the style of [oh-my-opencode-slim](https://github.com/alvinunreal/oh-my-opencode-slim):
the main agent plans and dispatches, and model-pinned specialist subagents do
the work.

## What you get

One agent preset, `orchestrator`:

- **Main agent = Orchestrator** — a workflow manager persona (plan → dispatch →
  reconcile → verify), delegating instead of implementing.
- **11 subagent tools**, each with its own persona and pinned model
  (routed through the `opencode-go` pi-ai provider):

| Tool | Role | Model |
|---|---|---|
| `subagent` | generic worker (background, continuable) | inherit |
| `subagent_fork` | forks parent context | inherit |
| `subagent_explorer` | fast codebase navigation (read-only) | `deepseek-v4-flash` |
| `subagent_oracle` | architecture / review advisor (read-only) | `glm-5.2` |
| `subagent_librarian` | docs / external research | `minimax-m2.7` |
| `subagent_designer` | frontend UI/UX | `kimi-k2.6` |
| `subagent_fixer` | bounded implementation | `deepseek-v4-flash` |
| `subagent_councillor_alpha/beta/gamma` | independent multi-model reviews | `glm-5.2` / `kimi-k2.7-code` / `qwen3.7-max` |
| `subagent_council` | multi-model consensus synthesis | `kimi-k3` |

> The models above mirror the OMO `opencode` preset found in
> `~/.config/opencode/oh-my-opencode-slim.json`. The OMO council model
> `gpt-5.6-luna` is not in the opencode-go catalog, so `kimi-k3` is used.

## How it works

A dsh **bundle** is an npm package declaring
`"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`. This bundle's patch
layer inserts one row: the preset-installer plugin. On boot the plugin
installs/updates `config/presets/*` in the harness-home **user preset root**
(`~/.dsh/.agent-presets`), which the agent-presets roster always scans.

Why install into the user root instead of registering a new root? The dsh
launcher's `composeProfile` forcibly overwrites `agent-presets.config.roots`
with the shipped root, so a bundle cannot contribute its own root. The user
root is the supported extension path.

### Model definitions are separated from the composition

Each subagent's **model** and **persona** live in different files on purpose —
you are far more likely to tweak a model than a persona, and plugin updates
should not clobber your model choices:

| File (in the bundle) | File (in `~/.dsh/.agent-presets/orchestrator/`) | What you edit |
|---|---|---|
| `config/models.json` | `models.json` | model mapping (copied on install; user-owned afterwards) |
| `config/presets/orchestrator/agent.cordis.yml.tmpl` | `agent.cordis.yml` (rendered) | personas / tool wiring (generated from template) |
| — | `.generated` | render stamp `{ renderedHash }` (managed) |

Every boot the plugin re-renders `agent.cordis.yml` from the current template
+ the current `models.json`. Rules:

- **Model change** → edit `models.json`, restart `dsh`. Re-render happens.
- **Plugin update (new personas/wiring)** → re-render happens on next boot;
  your `models.json` is never overwritten.
- **Hand-editing the composition** → if you edit `agent.cordis.yml` directly,
  the plugin detects it (hash differs from the stamp) and leaves your file
  alone. You own it then; delete the preset directory to take plugin updates.

## Install

```bash
# from the profile directory (web is the default profile)
dsh plugin --profile web add dsh-plugin-omoslim
```

`dsh plugin` forwards to pnpm and reconciles `dsh.profile.bundles`, so the
package is both installed and activated as a bundle layer. Then restart the
web app:

```bash
systemctl --user restart dsh-web
# or: restart your `dsh web` process
```

For local development instead of a published package:

```bash
# in ~/.dsh/profiles/web/
pnpm add file:/home/<you>/Coding/dsh-plugin-omoslim
# then add the package name to the "dsh.profile.bundles" array in package.json
```

## Use

Open the web UI, start a **new session** and pick the `orchestrator` preset in
Settings → General (it becomes the default only if you set it, or if
`~/.dsh/settings.yaml` has `agent-presets.default: orchestrator`). The main
agent will plan and dispatch; the subagent tools appear in its tool catalog.

## Uninstall / rollback

1. Remove the bundle: `dsh plugin --profile web remove dsh-plugin-omoslim`
   (or drop the dependency + `dsh.profile.bundles` entry manually), restart.
2. The preset files stay in `~/.dsh/.agent-presets/orchestrator/` — delete
   that directory to remove them, or keep it to keep using the preset without
   the plugin.

## Customizing

- **Change a subagent's model** → edit
  `~/.dsh/.agent-presets/orchestrator/models.json`, restart `dsh` (or the
  `dsh-web` service). The plugin re-renders `agent.cordis.yml` on the next
  boot and your model mapping is never overwritten by plugin updates.

  ```json
  { "oracle": "glm-5.2", "explorer": "deepseek-v4-flash", "...": "..." }
  ```

- **Change personas / tool wiring** → edit the template in the bundle
  (`config/presets/orchestrator/agent.cordis.yml.tmpl`) and bump the plugin,
  or hand-edit the rendered `~/.dsh/.agent-presets/orchestrator/agent.cordis.yml`
  — hand edits are detected (stamp mismatch) and left alone. To take plugin
  updates again, delete the preset directory first.

- **Reinstall the pristine preset** → `rm -rf ~/.dsh/.agent-presets/orchestrator`
  and restart `dsh`.

## Layout

```
dsh-plugin-omoslim/
├── package.json            # dsh.bundle.patch declaration
├── cordis.patch.yml        # bundle patch layer (inserts the installer row)
├── config/
│   ├── models.json         # DEFAULT model mapping (independent file)
│   └── presets/orchestrator/
│       ├── preset.yml
│       └── agent.cordis.yml.tmpl   # composition template (@@models.<key>@@ slots)
└── lib/index.js            # Cordis plugin: idempotent installer + template renderer
```
