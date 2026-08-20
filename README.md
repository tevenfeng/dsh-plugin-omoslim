# dsh-plugin-omoslim

DeepSeek Harness (`dsh`) bundle that installs an **Orchestrator agent preset**
in the style of [oh-my-opencode-slim](https://github.com/alvinunreal/oh-my-opencode-slim):
the main agent plans and dispatches, and model-pinned specialist subagents do
the work.

## What you get

One agent preset, `orchestrator`:

- **Main agent = Orchestrator** — a workflow manager persona (plan → dispatch →
  reconcile → verify), delegating instead of implementing.
- **11 subagent tools**, each with its own persona and a model slot in a
  named model profile under `models.d/` (`provider` defaults to `null`, i.e.
  inherit the main agent's provider):

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
>
> All model and provider names are examples from the OMO author's
> environment. The factory profiles seed `provider: null` (the subagent
> inherits the main agent's provider); set `provider` in `models.d/<name>.json`
> to pin one (e.g. `"opencode-go"`), and make sure each model name exists in
> that provider's catalog.

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
should not clobber your model choices. On top of that, you can keep **many
named model profiles** and switch the active one at any time:

| File (in the bundle) | File (in `~/.dsh/.agent-presets/orchestrator/`) | What you edit |
|---|---|---|
| `config/models.d/*.json` | `models.d/*.json` | factory profiles (seeded on install; user-editable afterwards) |
| — | `models.d/default.json` | the default profile (user-owned) |
| `config/presets/orchestrator/agent.cordis.yml.tmpl` | `agent.cordis.yml` (rendered) | personas / tool wiring (generated from template) |
| — | `.generated` | render stamp `{ active, sourceHash, renderedHash }` (managed) |

The **active** profile is stored in `~/.dsh/settings.yaml` under
`omoslim.active` (defaults to `default`). Every boot the plugin re-renders
`agent.cordis.yml` from the current template + the **active** profile. Rules:

- **Switch the active profile** → `omoslim switch <name>` re-renders
  `agent.cordis.yml` in place. dsh mounts each preset's composition once per
  process, so **restart `dsh` (or the `dsh-web` service)** for the new models
  to load, then create a new session.
- **Model / provider change** → edit `models.d/<name>.json`
  (`provider: null` = inherit the main agent's provider), then switch to it.
- **Plugin update (new personas/wiring)** → re-render happens on next boot;
  your `models.d/*.json` profiles are never overwritten.
- **Hand-editing the composition** → if you edit `agent.cordis.yml` directly,
  the plugin detects it (hash differs from the stamp) and leaves your file
  alone. You own it then; delete the preset directory to take plugin updates.

> A profile must name **every** slot the template references (explorer, oracle,
> librarian, designer, fixer, councillor_alpha, councillor_beta,
> councillor_gamma, council). A missing slot fails closed rather than rendering
> a half-populated composition.

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

### Subagent model inspector

In the web UI, click the plugin's button to the **left of the model selector**
(a stack/panel icon). It opens a panel showing the **active profile's**
per-subagent provider/model at a glance:

- Each row lists one subagent slot with its model, plus the provider when one
  is pinned.
- `provider: null` (shown as "inherits main agent") means that subagent uses
  the main agent's provider.

The button is shown **only while the current session runs the `orchestrator`
preset** — under dsh's own presets or third-party presets these subagent slots
don't exist, so the inspector hides instead of showing misleading data. It is
also hidden on the **blank new-session screen** (a preset pick there is only
staged, not applied, so the button appears once the orchestrator session
actually starts running).

The data is served read-only by
`GET /dsh-plugin-omoslim/subagent-models` (JSON), so the panel reflects what
the orchestrator preset is literally composed with. Switching the active
profile (`omoslim switch <name>`) and opening the panel again shows the new
mapping.

> After **updating** the plugin, restart the web app so the new route and button
> are picked up — `systemctl --user restart dsh-web`, or restart your `dsh web`
> process — then refresh the page.

## Uninstall / rollback

1. Remove the bundle: `dsh plugin --profile web remove dsh-plugin-omoslim`
   (or drop the dependency + `dsh.profile.bundles` entry manually), restart.
2. The preset files stay in `~/.dsh/.agent-presets/orchestrator/` — delete
   that directory to remove them, or keep it to keep using the preset without
   the plugin.

## Multiple model profiles

Each profile is one JSON file under
`~/.dsh/.agent-presets/orchestrator/models.d/`, holding a slot → mapping table:

```json
{
  "oracle": { "provider": null, "model": "glm-5.2" },
  "explorer": { "provider": "opencode-go", "model": "deepseek-v4-flash" }
}
```

- `provider: null` (or omitted) = inherit the main agent's provider.
- The legacy flat format `"oracle": "glm-5.2"` still works.
- Create a new profile by copying an existing file:
  `cp models.d/default.json models.d/economy.json`, then edit it.

Manage profiles with the CLI:

```bash
omoslim list                  # list profiles; the active one is marked *
omoslim current               # print the active profile name
omoslim switch economy        # switch + re-render now
```

`omoslim` ships as an npm `bin` (declared in `package.json`). Installing the
plugin also links it into the profile's `node_modules/.bin/`, but that
directory is **not** added to your shell `$PATH` automatically — npm/pnpm bins
never modify your shell config. Make `omoslim` callable from anywhere with one
of these:

**Option A — add the profile's bin dir to your PATH (one line, persistent):**

```bash
# zsh (default on macOS):
echo 'export PATH="$HOME/.dsh/profiles/web/node_modules/.bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
# bash:
# echo 'export PATH="$HOME/.dsh/profiles/web/node_modules/.bin:$PATH"' >> ~/.bashrc
# source ~/.bashrc
```

**Option B — install the package globally (bin lands on your global PATH):**

```bash
npm install -g dsh-plugin-omoslim
# then `omoslim` works everywhere; note the global copy is separate from the
# profile's copy, so re-run this after upgrading the plugin.
```

**Option C — one-off, no PATH changes:**

```bash
~/.dsh/profiles/web/node_modules/.bin/omoslim list   # full path
# or, from inside the profile directory:
#   npx --no-install omoslim switch economy
```

`omoslim switch <name>` writes `omoslim.active` to `~/.dsh/settings.yaml` and
re-renders `agent.cordis.yml` in place. Because dsh mounts a preset's
composition once per process, the running process keeps the models it was
composed with — **restart `dsh` (or the `dsh-web` service)**, then create a
new session to use the new models.

## Customizing

- **Change a subagent's model / provider** → edit
  `~/.dsh/.agent-presets/orchestrator/models.d/<name>.json`, then
  `omoslim switch <name>` (or let the next boot re-render it). Your profiles
  are never overwritten by plugin updates.

  ```json
  {
    "oracle": { "provider": null, "model": "glm-5.2" },
    "explorer": { "provider": "opencode-go", "model": "deepseek-v4-flash" }
  }
  ```

  `provider: null` (or omitted) = the subagent inherits the main agent's
  provider. The legacy flat format `"oracle": "glm-5.2"` still works
  (provider is treated as inherited). Model names must exist in the chosen
  provider's catalog.

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
├── package.json            # dsh.bundle.patch declaration + "omoslim" bin
├── cordis.patch.yml        # bundle patch layer (inserts the installer row)
├── config/
│   ├── models.d/            # factory model profiles (default.json, cheap.json, …)
│   └── presets/orchestrator/
│       ├── preset.yml
│       └── agent.cordis.yml.tmpl   # composition template (@@models.<key>@@ slots)
└── lib/
    ├── index.js            # Cordis plugin: installer + template renderer + profile helpers
    └── cli.js              # omoslim CLI: list / switch / current
```
