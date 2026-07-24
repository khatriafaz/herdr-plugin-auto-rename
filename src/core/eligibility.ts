import { resolve } from "node:path";
import type { AutoRenameConfig, CommandRunner, EligibilityResult } from "./types.js";

function parseWorkspace(payload: string): { linked?: boolean } {
	try {
		const parsed = JSON.parse(payload) as {
			result?: { workspace?: { worktree?: { is_linked_worktree?: boolean } | null } };
		};
		const linked = parsed.result?.workspace?.worktree?.is_linked_worktree;
		return linked === undefined ? {} : { linked };
	} catch {
		return {};
	}
}

export async function checkEligibility(options: {
	cwd: string;
	env: NodeJS.ProcessEnv;
	config: AutoRenameConfig;
	run: CommandRunner;
}): Promise<EligibilityResult> {
	const { cwd, env, config, run } = options;
	if (!config.enabled) return { eligible: false, reason: "disabled by configuration" };
	if (env.HERDR_ENV !== "1") return { eligible: false, reason: "not running inside Herdr" };
	const workspaceId = env.HERDR_WORKSPACE_ID;
	if (!workspaceId) return { eligible: false, reason: "HERDR_WORKSPACE_ID is unavailable" };

	const branchResult = await run("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], { cwd });
	if (branchResult.code !== 0) return { eligible: false, reason: "Git HEAD is detached" };
	const branch = branchResult.stdout.trim();
	if (!new RegExp(config.generatedBranchPattern).test(branch)) {
		return { eligible: false, reason: `branch ${branch} is not generated`, branch, workspaceId };
	}

	const dirs = await run("git", ["rev-parse", "--git-dir", "--git-common-dir"], { cwd });
	if (dirs.code !== 0) return { eligible: false, reason: "current directory is not a Git worktree", branch, workspaceId };
	const [gitDirRaw, commonDirRaw] = dirs.stdout.trim().split(/\r?\n/);
	if (!gitDirRaw || !commonDirRaw || resolve(cwd, gitDirRaw) === resolve(cwd, commonDirRaw)) {
		return { eligible: false, reason: "checkout is not a linked Git worktree", branch, workspaceId };
	}

	const herdr = env.HERDR_BIN_PATH || "herdr";
	const workspace = await run(herdr, ["workspace", "get", workspaceId], { cwd, env });
	if (workspace.code !== 0) return { eligible: false, reason: "unable to inspect Herdr workspace", branch, workspaceId };
	if (parseWorkspace(workspace.stdout).linked !== true) {
		return { eligible: false, reason: "Herdr workspace is not worktree-backed", branch, workspaceId };
	}

	return { eligible: true, branch, workspaceId };
}
