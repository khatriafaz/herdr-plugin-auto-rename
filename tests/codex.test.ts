import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DEFAULT_CONFIG } from "../src/core/config.js";
import { runCommand } from "../src/core/runner.js";
import type { CommandRunner, NamingResult } from "../src/core/types.js";
import { handleCodexHook, type CodexHookInput } from "../src/extensions/codex.js";

async function git(cwd: string, ...args: string[]): Promise<string> {
	const result = await runCommand("git", args, { cwd });
	assert.equal(result.code, 0, result.stderr);
	return result.stdout.trim();
}

async function fixture(): Promise<{ root: string; main: string; worktree: string; pluginData: string }> {
	const root = await mkdtemp(join(tmpdir(), "herdr-codex-hook-"));
	const main = join(root, "repo");
	const worktree = join(root, "worktree-random-river-1234");
	const pluginData = join(root, "plugin-data");
	await runCommand("git", ["init", "-b", "main", main]);
	await git(main, "config", "user.email", "test@example.com");
	await git(main, "config", "user.name", "Test User");
	await git(main, "commit", "--allow-empty", "-m", "initial");
	await git(main, "worktree", "add", "-b", "worktree/random-river-1234", worktree);
	return { root, main, worktree, pluginData };
}

function herdrRunner(): { run: CommandRunner; calls: string[][] } {
	const calls: string[][] = [];
	const run: CommandRunner = async (command, args, options) => {
		if (command !== "fake-herdr") return runCommand(command, args, options);
		calls.push([...args]);
		if (args[0] === "workspace" && args[1] === "get") {
			return {
				code: 0,
				stdout: JSON.stringify({ result: { workspace: { worktree: { is_linked_worktree: true } } } }),
				stderr: "",
			};
		}
		return { code: 0, stdout: "{}", stderr: "" };
	};
	return { run, calls };
}

function hookInput(cwd: string, sessionId = "session-1"): CodexHookInput {
	return {
		session_id: sessionId,
		turn_id: "turn-1",
		cwd,
		hook_event_name: "UserPromptSubmit",
		prompt: "Add retry handling to the Stripe webhook processor",
	};
}

const naming: NamingResult = {
	proposal: { title: "Stripe webhook retries", kind: "feature", slug: "stripe-webhook-retries" },
	source: "model",
	model: "openai-codex/gpt-5.4-mini",
	durationMs: 10,
};

test("renames once from the first Codex prompt and persists provenance", async () => {
	const item = await fixture();
	try {
		const fake = herdrRunner();
		const env = {
			...process.env,
			HERDR_ENV: "1",
			HERDR_WORKSPACE_ID: "w-test",
			HERDR_BIN_PATH: "fake-herdr",
		};
		let namingCalls = 0;
		const first = await handleCodexHook(hookInput(item.worktree), {
			env,
			pluginData: item.pluginData,
			run: fake.run,
			load: async () => DEFAULT_CONFIG,
			name: async () => {
				namingCalls += 1;
				return naming;
			},
		});
		const second = await handleCodexHook({ ...hookInput(item.worktree), turn_id: "turn-2" }, {
			env,
			pluginData: item.pluginData,
			run: fake.run,
			load: async () => DEFAULT_CONFIG,
			name: async () => {
				namingCalls += 1;
				return naming;
			},
		});

		assert.equal(first?.status, "completed");
		assert.equal(first?.result?.status, "renamed");
		assert.equal(second, undefined);
		assert.equal(namingCalls, 1);
		assert.equal(await git(item.worktree, "branch", "--show-current"), "feat/stripe-webhook-retries");
		assert.deepEqual(fake.calls.at(-1), ["workspace", "rename", "w-test", "Stripe webhook retries"]);

		const attempts = await readdir(join(item.pluginData, "attempts"));
		assert.equal(attempts.length, 1);
		const saved = JSON.parse(await readFile(join(item.pluginData, "attempts", attempts[0] as string), "utf8"));
		assert.equal(saved.naming.source, "model");
		assert.equal(saved.result.branch, "feat/stripe-webhook-retries");
	} finally {
		await rm(item.root, { recursive: true, force: true });
	}
});

test("a skipped first prompt still claims the Codex session", async () => {
	const item = await fixture();
	try {
		await git(item.worktree, "branch", "-m", "existing-feature");
		const fake = herdrRunner();
		const env = {
			...process.env,
			HERDR_ENV: "1",
			HERDR_WORKSPACE_ID: "w-test",
			HERDR_BIN_PATH: "fake-herdr",
		};
		const first = await handleCodexHook(hookInput(item.worktree), {
			env,
			pluginData: item.pluginData,
			run: fake.run,
			load: async () => DEFAULT_CONFIG,
			name: async () => naming,
		});
		await git(item.worktree, "branch", "-m", "worktree/eligible-later");
		const second = await handleCodexHook(hookInput(item.worktree), {
			env,
			pluginData: item.pluginData,
			run: fake.run,
			load: async () => DEFAULT_CONFIG,
			name: async () => naming,
		});
		assert.equal(first?.result?.status, "skipped");
		assert.equal(second, undefined);
		assert.equal(await git(item.worktree, "branch", "--show-current"), "worktree/eligible-later");
	} finally {
		await rm(item.root, { recursive: true, force: true });
	}
});

test("ignores malformed and unrelated hook input", async () => {
	const pluginData = await mkdtemp(join(tmpdir(), "herdr-codex-invalid-"));
	try {
		assert.equal(await handleCodexHook({ hook_event_name: "Stop" }, { pluginData }), undefined);
		assert.deepEqual(await readdir(pluginData), []);
	} finally {
		await rm(pluginData, { recursive: true, force: true });
	}
});
