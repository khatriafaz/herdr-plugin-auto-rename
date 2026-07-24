import { checkEligibility } from "./eligibility.js";
import { formatBranchName } from "./naming.js";
import { commandError } from "./runner.js";
import type { AutoRenameConfig, CommandRunner, NameProposal, RenameResult } from "./types.js";

async function branchExists(branch: string, cwd: string, run: CommandRunner): Promise<boolean> {
	const result = await run("git", ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], { cwd });
	return result.code === 0;
}

async function availableBranch(
	desired: string,
	cwd: string,
	config: AutoRenameConfig,
	run: CommandRunner,
): Promise<string> {
	if (!(await branchExists(desired, cwd, run))) return desired;
	if (config.collisionPolicy === "fail") throw new Error(`branch ${desired} already exists`);
	for (let suffix = 2; suffix <= 999; suffix += 1) {
		const candidate = `${desired}-${suffix}`;
		if (!(await branchExists(candidate, cwd, run))) return candidate;
	}
	throw new Error(`could not find an available branch name for ${desired}`);
}

export async function renameWorktree(options: {
	cwd: string;
	env: NodeJS.ProcessEnv;
	config: AutoRenameConfig;
	proposal: NameProposal;
	run: CommandRunner;
	requireGeneratedBranch?: boolean;
}): Promise<RenameResult> {
	const { cwd, env, config, proposal, run } = options;
	let previousBranch: string;
	let workspaceId: string;

	if (options.requireGeneratedBranch !== false) {
		const eligibility = await checkEligibility({ cwd, env, config, run });
		if (!eligibility.eligible || !eligibility.branch || !eligibility.workspaceId) {
			return { status: "skipped", reason: eligibility.reason ?? "worktree is not eligible" };
		}
		previousBranch = eligibility.branch;
		workspaceId = eligibility.workspaceId;
	} else {
		workspaceId = env.HERDR_WORKSPACE_ID ?? "";
		if (!workspaceId) return { status: "skipped", reason: "HERDR_WORKSPACE_ID is unavailable" };
		const current = await run("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], { cwd });
		if (current.code !== 0) return { status: "skipped", reason: "Git HEAD is detached" };
		previousBranch = current.stdout.trim();
	}

	const desired = formatBranchName(proposal, config);
	const valid = await run("git", ["check-ref-format", "--branch", desired], { cwd });
	if (valid.code !== 0) throw new Error(`generated invalid branch name: ${desired}`);
	const branch = desired === previousBranch ? desired : await availableBranch(desired, cwd, config, run);

	if (branch !== previousBranch) {
		const renameBranch = await run("git", ["branch", "-m", branch], { cwd });
		if (renameBranch.code !== 0) throw commandError("git", ["branch", "-m", branch], renameBranch);
	}

	const herdr = env.HERDR_BIN_PATH || "herdr";
	const renameWorkspace = await run(herdr, ["workspace", "rename", workspaceId, proposal.title], { cwd, env });
	if (renameWorkspace.code !== 0) {
		return {
			status: "partial",
			title: proposal.title,
			previousBranch,
			branch,
			warning: `branch was renamed, but Herdr workspace rename failed: ${renameWorkspace.stderr.trim() || renameWorkspace.code}`,
		};
	}

	return { status: "renamed", title: proposal.title, previousBranch, branch };
}
