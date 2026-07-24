#!/usr/bin/env node
import { loadConfig } from "./core/config.js";
import { heuristicName } from "./core/naming.js";
import { renameWorktree } from "./core/rename.js";
import { runCommand } from "./core/runner.js";

interface HerdrContext {
	selected_text?: string | null;
	focused_pane_cwd?: string | null;
	focused_pane?: { cwd?: string | null } | null;
	worktree?: { path?: string | null } | null;
}

function pluginContext(): HerdrContext {
	try {
		return JSON.parse(process.env.HERDR_PLUGIN_CONTEXT_JSON ?? "{}") as HerdrContext;
	} catch {
		return {};
	}
}

function usage(): never {
	console.error("Usage: node dist/src/cli.js rename <task description>");
	console.error("Herdr action usage: select task text in a pane, then invoke Auto Rename: rename from selected text");
	process.exit(2);
}

async function main(): Promise<void> {
	const [mode, ...rest] = process.argv.slice(2);
	const context = pluginContext();
	const description = mode === "context" ? context.selected_text?.trim() : rest.join(" ").trim();
	if ((mode !== "context" && mode !== "rename") || !description) usage();
	const cwd = context.focused_pane_cwd || context.focused_pane?.cwd || context.worktree?.path || process.cwd();
	const config = await loadConfig();
	const proposal = heuristicName(description, config);
	const result = await renameWorktree({
		cwd,
		env: process.env,
		config,
		proposal,
		run: runCommand,
		requireGeneratedBranch: false,
	});
	if (result.status === "skipped") {
		console.error(result.reason);
		process.exitCode = 1;
		return;
	}
	console.log(JSON.stringify(result));
	if (result.status === "partial") process.exitCode = 1;
}

main().catch((error) => {
	console.error((error as Error).message);
	process.exitCode = 1;
});
