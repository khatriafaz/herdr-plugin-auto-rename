import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "../core/config.js";
import { checkEligibility } from "../core/eligibility.js";
import { renameWorktree } from "../core/rename.js";
import { runCommand } from "../core/runner.js";
import type { AutoRenameConfig, RenameResult } from "../core/types.js";
import { nameWithPiModel } from "./pi-naming.js";

const STATE_TYPE = "herdr-auto-rename-attempt";

function sessionAlreadyStarted(ctx: ExtensionContext): boolean {
	return ctx.sessionManager.getBranch().some((entry) => {
		if (entry.type === "custom" && entry.customType === STATE_TYPE) return true;
		return entry.type === "message" && entry.message.role === "user";
	});
}

function describe(result: RenameResult): string {
	if (result.status === "renamed") return `Renamed workspace to “${result.title}” · ${result.branch}`;
	if (result.status === "partial") return result.warning ?? `Renamed branch to ${result.branch}`;
	return result.reason ?? "Auto-rename skipped";
}

function notifyResult(ctx: ExtensionContext, config: AutoRenameConfig, result: RenameResult): void {
	if (!config.notify || result.status === "skipped") return;
	ctx.ui.notify(describe(result), result.status === "partial" ? "warning" : "info");
}

function notifySafely(ctx: ExtensionContext, message: string, type: "info" | "warning" | "error"): void {
	try {
		ctx.ui.notify(message, type);
	} catch {
		// The user may have switched or closed the session while background naming was running.
	}
}

async function runFirstPromptRename(
	pi: ExtensionAPI,
	prompt: string,
	ctx: ExtensionContext,
): Promise<void> {
	let config: AutoRenameConfig;
	try {
		config = await loadConfig();
	} catch (error) {
		notifySafely(ctx, (error as Error).message, "error");
		return;
	}

	try {
		const eligibility = await checkEligibility({ cwd: ctx.cwd, env: process.env, config, run: runCommand });
		if (!eligibility.eligible) return;
		const proposal = await nameWithPiModel(prompt, config, ctx);
		const result = await renameWorktree({
			cwd: ctx.cwd,
			env: process.env,
			config,
			proposal,
			run: runCommand,
		});
		pi.appendEntry(STATE_TYPE, { at: Date.now(), result });
		if (result.status !== "skipped" && config.setPiSessionName) pi.setSessionName(proposal.title);
		notifyResult(ctx, config, result);
	} catch (error) {
		if (config.notify) notifySafely(ctx, `Auto-rename failed: ${(error as Error).message}`, "warning");
	}
}

export default function autoRenameExtension(pi: ExtensionAPI) {
	let attempted = false;

	pi.on("session_start", (_event, ctx) => {
		attempted = sessionAlreadyStarted(ctx);
	});

	pi.on("before_agent_start", (event, ctx) => {
		if (attempted) return;
		attempted = true;
		pi.appendEntry(STATE_TYPE, { at: Date.now(), status: "scheduled" });
		void runFirstPromptRename(pi, event.prompt, ctx);
	});

	pi.registerCommand("auto-rename", {
		description: "Rename the current Herdr workspace and branch from a task description",
		handler: async (args, ctx) => {
			const prompt = args.trim();
			if (!prompt) {
				ctx.ui.notify("Usage: /auto-rename <task description>", "warning");
				return;
			}
			try {
				const config = await loadConfig();
				const proposal = await nameWithPiModel(prompt, config, ctx);
				const result = await renameWorktree({
					cwd: ctx.cwd,
					env: process.env,
					config,
					proposal,
					run: runCommand,
					requireGeneratedBranch: false,
				});
				if (result.status !== "skipped" && config.setPiSessionName) pi.setSessionName(proposal.title);
				ctx.ui.notify(describe(result), result.status === "renamed" ? "info" : "warning");
			} catch (error) {
				ctx.ui.notify(`Auto-rename failed: ${(error as Error).message}`, "error");
			}
		},
	});
}
