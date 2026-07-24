# herdr-plugin-auto-rename

Automatically rename a fresh [Herdr](https://herdr.dev) worktree workspace and its current Git branch from the first prompt sent to [Pi](https://github.com/earendil-works/pi-mono).

```text
Generated workspace: worktree-silver-river-3547
Generated branch:    worktree-silver-river-3547
First prompt:        Add retry handling to the Stripe webhook processor

Renamed workspace:  Stripe webhook retries
Renamed branch:      feat/stripe-webhook-retries
```

The checkout directory is deliberately **not moved**. Only the Herdr workspace display label and Git branch are renamed, so existing panes keep valid working directories.

## How it works

Herdr plugins cannot read an agent's prompt directly, so this repository contains two cooperating surfaces:

- `herdr-plugin.toml` registers the Herdr plugin and a manual action.
- `src/extensions/pi.ts` is a Pi extension that observes the first agent turn.

Before making any naming model request or mutation, the extension verifies that:

1. it is running inside Herdr;
2. the workspace is backed by a linked Git worktree;
3. the current branch matches `^worktree(?:/|-)` (configurable); and
4. the Pi session has no earlier user message or auto-rename attempt.

The branch is renamed first. Herdr's workspace label is renamed only after Git succeeds. Failures never block the agent's main response.

## Requirements

- Herdr 0.7.0 or newer
- Pi with extension support
- Node.js 20 or newer
- Git
- macOS or Linux

## Local development installation

From this repository:

```bash
npm install
npm run build
herdr plugin link .
pi install "$PWD"
```

`herdr plugin link` does not run build commands, which is why `npm run build` comes first. Restart Pi or use `/reload` after installing the Pi package.

To remove the local development installation:

```bash
pi remove "$PWD"
herdr plugin unlink afaz.auto-rename
```

## Published installation

Once this repository is hosted on GitHub, install both surfaces from the same source:

```bash
herdr plugin install OWNER/herdr-plugin-auto-rename
pi install git:github.com/OWNER/herdr-plugin-auto-rename
```

The two-step install is intentional. It avoids silently editing Pi's global settings during Herdr plugin installation and allows either package manager to uninstall its own resources cleanly.

## Configuration

Defaults work without a config file. To customize them:

```bash
config_dir="$(herdr plugin config-dir afaz.auto-rename)"
mkdir -p "$config_dir"
cp config.example.toml "$config_dir/config.toml"
```

Key settings:

```toml
enabled = true
naming_strategy = "model"            # model | heuristic
generated_branch_pattern = "^worktree(?:/|-)"
branch_prefix_style = "slash"        # slash | hyphen | none
collision_policy = "suffix"          # suffix | fail
max_title_length = 48
max_slug_length = 48
model_timeout_ms = 8000
set_pi_session_name = true
notify = true
```

With `naming_strategy = "model"`, the extension makes one small request using Pi's active model and credentials. It asks only for a short title, task kind, and slug. If the request times out, authentication is unavailable, or output is invalid, deterministic heuristic naming is used instead. Set the strategy to `heuristic` to avoid the extra request and sending the prompt through a second model call.

Task kinds map to configurable prefixes:

```toml
[prefixes]
feature = "feat"
fix = "fix"
refactor = "refactor"
docs = "docs"
test = "test"
chore = "chore"
explore = "explore"
```

An empty prefix removes it for that kind.

### Alternate config path

Set `HERDR_AUTO_RENAME_CONFIG=/absolute/path/config.toml` before starting Pi to use another file. Otherwise the extension reads:

```text
$XDG_CONFIG_HOME/herdr/plugins/config/afaz.auto-rename/config.toml
```

or `~/.config/herdr/...` when `XDG_CONFIG_HOME` is unset.

## Manual rename

Pi provides a command that can rename any current branch, not only generated ones:

```text
/auto-rename Fix the login redirect loop
```

The Herdr plugin also exposes **Auto Rename: rename from selected text**. Select a task description in a pane and invoke the action from Herdr's command palette. The manual Herdr action uses deterministic naming because it does not run inside Pi's model context.

Manual renames still validate the Git ref and apply collision handling. They never move the worktree directory.

## Collision and failure behavior

- Existing `feat/example` becomes `feat/example-2` by default.
- `collision_policy = "fail"` leaves the original branch and workspace unchanged instead.
- A Git rename failure leaves the Herdr workspace unchanged.
- A Herdr API failure after Git succeeds is reported as partial success. Retry with `/auto-rename` to update the workspace label; requesting the same branch does not add another suffix.
- Detached HEADs and non-worktree repositories are skipped automatically.

## Development

```bash
npm run check
npm test
```

Tests use temporary real Git repositories and linked worktrees. Herdr calls are stubbed, so the suite cannot rename the active workspace.

## Current scope

The automatic first-prompt adapter currently supports Pi. The core naming and rename logic is agent-independent, so adapters for Claude Code, Codex, OpenCode, and other agents can be added when their prompt hooks provide reliable access to the first message.

## License

MIT
