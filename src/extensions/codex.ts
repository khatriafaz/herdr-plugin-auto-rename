import { createHash } from "node:crypto";
import { mkdir, open, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "../core/config.js";
import { checkEligibility } from "../core/eligibility.js";
import { renameWorktree } from "../core/rename.js";
import { runCommand } from "../core/runner.js";
import type { AutoRenameConfig, CommandRunner, NamingResult, RenameResult } from "../core/types.js";
import { nameWithCodexModel } from "./codex-naming.js";

export interface CodexHookInput {
	session_id: string;
	turn_id?: string;
	cwd: string;
	hook_event_name: string;
	prompt: string;
}

export interface CodexAttemptRecord {
	at: number;
	status: "scheduled" | "completed" | "failed";
	naming?: NamingResult;
	result?: RenameResult;
	error?: string;
}

interface CodexHookDependencies {
	env?: NodeJS.ProcessEnv;
	pluginData?: string;
	run?: CommandRunner;
	load?: () => Promise<AutoRenameConfig>;
	name?: (options: {
		prompt: string;
		config: AutoRenameConfig;
		cwd: string;
		env: NodeJS.ProcessEnv;
		run?: CommandRunner;
	}) => Promise<NamingResult>;
}

function isCodexHookInput(value: unknown): value is CodexHookInput {
	if (!value || typeof value !== "object") return false;
	const input = value as Record<string, unknown>;
	return input.hook_event_name === "UserPromptSubmit"
		&& typeof input.session_id === "string"
		&& input.session_id.length > 0
		&& typeof input.cwd === "string"
		&& input.cwd.length > 0
		&& typeof input.prompt === "string"
		&& input.prompt.trim().length > 0;
}

function attemptPath(pluginData: string, sessionId: string): string {
	const id = createHash("sha256").update(sessionId).digest("hex");
	return join(pluginData, "attempts", `${id}.json`);
}

async function claimAttempt(path: string): Promise<boolean> {
	await mkdir(join(path, ".."), { recursive: true });
	try {
		const handle = await open(path, "wx");
		try {
			await handle.writeFile(`${JSON.stringify({ at: Date.now(), status: "scheduled" })}\n`);
		} finally {
			await handle.close();
		}
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
		throw error;
	}
}

async function saveAttempt(path: string, record: CodexAttemptRecord): Promise<void> {
	await writeFile(path, `${JSON.stringify(record)}\n`, "utf8");
}

export async function handleCodexHook(
	value: unknown,
	dependencies: CodexHookDependencies = {},
): Promise<CodexAttemptRecord | undefined> {
	if (!isCodexHookInput(value)) return undefined;
	const env = dependencies.env ?? process.env;
	const pluginData = dependencies.pluginData ?? env.PLUGIN_DATA;
	if (!pluginData) return undefined;
	const path = attemptPath(pluginData, value.session_id);
	if (!(await claimAttempt(path))) return undefined;

	const run = dependencies.run ?? runCommand;
	try {
		const config = await (dependencies.load ?? loadConfig)();
		const eligibility = await checkEligibility({ cwd: value.cwd, env, config, run });
		if (!eligibility.eligible) {
			const record: CodexAttemptRecord = {
				at: Date.now(),
				status: "completed",
				result: { status: "skipped", reason: eligibility.reason ?? "worktree is not eligible" },
			};
			await saveAttempt(path, record);
			return record;
		}

		const naming = await (dependencies.name ?? nameWithCodexModel)({
			prompt: value.prompt,
			config,
			cwd: value.cwd,
			env,
			run,
		});
		const result = await renameWorktree({
			cwd: value.cwd,
			env,
			config,
			proposal: naming.proposal,
			run,
		});
		const record: CodexAttemptRecord = { at: Date.now(), status: "completed", naming, result };
		await saveAttempt(path, record);
		return record;
	} catch (error) {
		const record: CodexAttemptRecord = {
			at: Date.now(),
			status: "failed",
			error: (error as Error).message || "auto-rename failed",
		};
		try {
			await saveAttempt(path, record);
		} catch {
			// The hook is intentionally silent, including state persistence failures.
		}
		return record;
	}
}
