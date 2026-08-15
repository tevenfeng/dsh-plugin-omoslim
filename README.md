# dsh-plugin-orchestrator

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
layer inserts one row: the preset-installer plugin. On boot the plugin copies
`config/presets/*` into the harness-home **user preset root**
(`~/.dsh/.agent-presets`), which the agent-presets roster always scans.

Why install into the user root instead of registering a new root? The dsh
launcher's `composeProfile` forcibly overwrites `agent-presets.config.roots`
with the shipped root, so a bundle cannot contribute its own root. The user
root is the supported extension path.

## Install

```bash
# from the profile directory (web is the default profile)
dsh plugin --profile web add dsh-plugin-orchestrator
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
pnpm add file:/home/<you>/Coding/dsh-plugin-orchestrator
# then add the package name to the "dsh.profile.bundles" array in package.json
```

## Use

Open the web UI, start a **new session** and pick the `orchestrator` preset in
Settings → General (it becomes the default only if you set it, or if
`~/.dsh/settings.yaml` has `agent-presets.default: orchestrator`). The main
agent will plan and dispatch; the subagent tools appear in its tool catalog.

## Uninstall / rollback

1. Remove the bundle: `dsh plugin --profile web remove dsh-plugin-orchestrator`
   (or drop the dependency + `dsh.profile.bundles` entry manually), restart.
2. The preset files stay in `~/.dsh/.agent-presets/orchestrator/` — delete
   that directory to remove them, or keep it to keep using the preset without
   the plugin.

## Customizing

Edit `~/.dsh/.agent-presets/orchestrator/agent.cordis.yml` — the plugin never
overwrites an existing preset (idempotent install), so your edits survive
plugin updates. To reinstall the plugin's pristine version, delete the preset
directory first.

To change a subagent's model, edit its `agentOptions` in that file, e.g.:

```yaml
- id: tool-subagent-oracle
  name: '@deepseek-ai/dsh-tool-subagent'
  config:
    provider: spawn
    toolName: subagent_oracle
    backgroundMode: continuable
    agentOptions:
      provider: opencode-go
      model: glm-5.2
```

## Layout

```
dsh-plugin-orchestrator/
├── package.json            # dsh.bundle.patch declaration
├── cordis.patch.yml        # bundle patch layer (inserts the installer row)
├── lib/index.js            # Cordis plugin: idempotent preset installer
└── config/presets/
    └── orchestrator/
        ├── preset.yml
        └── agent.cordis.yml   # the composition (persona + 11 subagent tools)
```
