import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DEFAULT_CONFIG } from "../src/core/config.js";
import { checkEligibility } from "../src/core/eligibility.js";
import { renameWorktree } from "../src/core/rename.js";
import { runCommand } from "../src/core/runner.js";
import type { CommandRunner } from "../src/core/types.js";

async function git(cwd: string, ...args: string[]): Promise<string> {
	const result = await runCommand("git", args, { cwd });
	assert.equal(result.code, 0, result.stderr);
	return result.stdout.trim();
}

async function fixture(): Promise<{ root: string; main: string; worktree: string }> {
	const root = await mkdtemp(join(tmpdir(), "herdr-auto-rename-"));
	const main = join(root, "repo");
	const worktree = join(root, "worktree-random-river-1234");
	await runCommand("git", ["init", "-b", "main", main]);
	await git(main, "config", "user.email", "test@example.com");
	await git(main, "config", "user.name", "Test User");
	await git(main, "commit", "--allow-empty", "-m", "initial");
	await git(main, "worktree", "add", "-b", "worktree-random-river-1234", worktree);
	return { root, main, worktree };
}

function herdrRunner(options: { failRename?: boolean } = {}): { run: CommandRunner; calls: string[][] } {
	const calls: string[][] = [];
	const run: CommandRunner = async (command, args, commandOptions) => {
		if (command !== "fake-herdr") return runCommand(command, args, commandOptions);
		calls.push([...args]);
		if (args[0] === "workspace" && args[1] === "get") {
			return {
				code: 0,
				stdout: JSON.stringify({ result: { workspace: { worktree: { is_linked_worktree: true } } } }),
				stderr: "",
			};
		}
		if (options.failRename && args[1] === "rename") return { code: 1, stdout: "", stderr: "socket unavailable" };
		return { code: 0, stdout: "{}", stderr: "" };
	};
	return { run, calls };
}

const env = {
	...process.env,
	HERDR_ENV: "1",
	HERDR_WORKSPACE_ID: "w-test",
	HERDR_BIN_PATH: "fake-herdr",
};

test("eligibility requires a generated branch in a linked Herdr worktree", async () => {
	const item = await fixture();
	try {
		const fake = herdrRunner();
		const result = await checkEligibility({ cwd: item.worktree, env, config: DEFAULT_CONFIG, run: fake.run });
		assert.deepEqual(result, {
			eligible: true,
			branch: "worktree-random-river-1234",
			workspaceId: "w-test",
		});
	} finally {
		await rm(item.root, { recursive: true, force: true });
	}
});

test("renames the branch first and then the Herdr workspace", async () => {
	const item = await fixture();
	try {
		const fake = herdrRunner();
		const result = await renameWorktree({
			cwd: item.worktree,
			env,
			config: DEFAULT_CONFIG,
			proposal: { title: "Stripe webhook retries", kind: "feature", slug: "stripe-webhook-retries" },
			run: fake.run,
		});
		assert.equal(result.status, "renamed");
		assert.equal(result.branch, "feat/stripe-webhook-retries");
		assert.equal(await git(item.worktree, "branch", "--show-current"), "feat/stripe-webhook-retries");
		assert.deepEqual(fake.calls.at(-1), ["workspace", "rename", "w-test", "Stripe webhook retries"]);
	} finally {
		await rm(item.root, { recursive: true, force: true });
	}
});

test("suffixes collisions and reports a partial workspace failure", async () => {
	const item = await fixture();
	try {
		await git(item.main, "branch", "fix/login-redirect");
		const fake = herdrRunner({ failRename: true });
		const result = await renameWorktree({
			cwd: item.worktree,
			env,
			config: DEFAULT_CONFIG,
			proposal: { title: "Fix login redirect", kind: "fix", slug: "login-redirect" },
			run: fake.run,
		});
		assert.equal(result.status, "partial");
		assert.equal(result.branch, "fix/login-redirect-2");
		assert.match(result.warning ?? "", /socket unavailable/);
		assert.equal(await git(item.worktree, "branch", "--show-current"), "fix/login-redirect-2");
	} finally {
		await rm(item.root, { recursive: true, force: true });
	}
});

test("skips ordinary branches without invoking workspace rename", async () => {
	const item = await fixture();
	try {
		await git(item.worktree, "branch", "-m", "existing-feature");
		const fake = herdrRunner();
		const result = await renameWorktree({
			cwd: item.worktree,
			env,
			config: DEFAULT_CONFIG,
			proposal: { title: "Anything", kind: "feature", slug: "anything" },
			run: fake.run,
		});
		assert.equal(result.status, "skipped");
		assert.equal(fake.calls.length, 0);
	} finally {
		await rm(item.root, { recursive: true, force: true });
	}
});
