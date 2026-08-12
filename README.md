# herdr-plugin-auto-rename

Automatically rename a fresh [Herdr](https://herdr.dev) worktree workspace and its current Git branch from the first prompt sent to [Pi](https://github.com/earendil-works/pi-mono) or [Codex](https://developers.openai.com/codex/).

```text
Generated workspace: worktree-silver-river-3547
Generated branch:    worktree-silver-river-3547
First prompt:        Add retry handling to the Stripe webhook processor

Renamed workspace:  Stripe webhook retries
Renamed branch:      feat/stripe-webhook-retries
```

The checkout directory is deliberately **not moved**. Only the Herdr workspace display label and Git branch are renamed, so existing panes keep valid working directories.

## How it works

Herdr plugins cannot read an agent's prompt directly, so this repository contains cooperating surfaces:

- `herdr-plugin.toml` registers the Herdr plugin and a manual action.
- `src/extensions/pi.ts` is a Pi extension that observes the first agent turn.
- `hooks/hooks.json` is a Codex `UserPromptSubmit` hook that observes the first Codex turn.

Before making any naming model request or mutation, the extension verifies that:

1. it is running inside Herdr;
2. the workspace is backed by a linked Git worktree;
3. the current branch matches `^worktree(?:/|-)` (configurable); and
4. the agent session has no earlier user message or auto-rename attempt.

Naming and renaming run in the background, so the coding agent starts its main response immediately. For compatibility with Codex versions that reject plugin-level async hooks, the Codex hook launches its own detached worker and returns immediately. The background task checks eligibility again immediately before mutation in case the branch changed while naming was in progress. The branch is renamed first, and Herdr's workspace label is renamed only after Git succeeds. Failures never block the agent's main response. Codex attempts are deliberately silent and are recorded under the plugin's private data directory.

## Requirements

- Herdr 0.7.0 or newer
- Pi with extension support
- Codex CLI 0.147.0 or newer for Codex support
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
codex plugin marketplace add "$PWD"
codex plugin add herdr-plugin-auto-rename@herdr-auto-rename
```

`herdr plugin link` does not run build commands, which is why `npm run build` comes first. Restart Pi or use `/reload` after installing the Pi package. Start a new Codex thread after installation, open `/hooks`, and trust the bundled hook before testing it.

To remove the local development installation:

```bash
pi remove "$PWD"
herdr plugin unlink afaz.auto-rename
codex plugin remove herdr-plugin-auto-rename@herdr-auto-rename
codex plugin marketplace remove herdr-auto-rename
```

## Published installation

Once this repository is hosted on GitHub, install both surfaces from the same source:

```bash
herdr plugin install khatriafaz/herdr-plugin-auto-rename
pi install git:github.com/khatriafaz/herdr-plugin-auto-rename
codex plugin marketplace add khatriafaz/herdr-plugin-auto-rename
codex plugin add herdr-plugin-auto-rename@herdr-auto-rename
```

The separate installs are intentional. They avoid silently editing either agent's global settings during Herdr plugin installation and allow each package manager to uninstall its own resources cleanly. After installing the Codex plugin, use `/hooks` to review and trust its command hook.

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
naming_model = "openai-codex/gpt-5.6-luna"
generated_branch_pattern = "^worktree(?:/|-)"
branch_prefix_style = "slash"        # slash | hyphen | none
collision_policy = "suffix"          # suffix | fail
max_title_length = 48
max_slug_length = 48
model_timeout_ms = 30000
set_pi_session_name = true             # Pi only
notify = true                          # Pi only
```

With `naming_strategy = "model"`, the adapter makes one small request using the dedicated `naming_model` and that provider's credentials. The default is `openai-codex/gpt-5.6-luna`, independently of the larger model selected for the coding session. Both Pi and Codex ask Luna only for a short title, task kind, and slug, with low reasoning. If Luna is missing, times out, lacks authentication, or returns invalid output, deterministic heuristic naming is used directly; it does not fall back to the active coding model. Set the strategy to `heuristic` to avoid the extra request and sending the prompt through a second model call. Codex supports `openai-codex/*` naming models; another configured provider falls back to heuristic naming there while remaining available to Pi.

Each completed automatic attempt records its naming provenance. Pi stores a `herdr-auto-rename-attempt` custom session entry; Codex stores a private per-session JSON record in its plugin data directory. Records include `source` (`model` or `heuristic`), the model name when used, duration, and the fallback reason when applicable. This makes silent fallback diagnosable without exposing credentials.

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

Set `HERDR_AUTO_RENAME_CONFIG=/absolute/path/config.toml` before starting Pi or Codex to use another file. Otherwise the adapter reads:

```text
$XDG_CONFIG_HOME/herdr/plugins/config/afaz.auto-rename/config.toml
```

or `~/.config/herdr/...` when `XDG_CONFIG_HOME` is unset.

## Manual rename

Pi provides a command that can rename any current branch, not only generated ones:

```text
/auto-rename Fix the login redirect loop
```

Run `/auto-rename` without a task description to regenerate the workspace, branch, and Pi session label from the current active session conversation. This uses Pi's compaction-aware session context; tool output is omitted from the naming prompt.

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

## Agent-specific behavior

Pi additionally supports `/auto-rename`, optional Pi session naming, and UI notifications. Codex automatically renames only on the first prompt and remains silent; Codex does not currently expose equivalent plugin APIs for changing the thread title or registering Pi-style custom commands.

## License

MIT
