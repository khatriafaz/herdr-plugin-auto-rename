import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import test from "node:test";
import { DEFAULT_CONFIG } from "../src/core/config.js";
import type { CommandRunner } from "../src/core/types.js";
import { nameWithCodexModel } from "../src/extensions/codex-naming.js";

test("uses an isolated Codex request and records model provenance", async () => {
	let invocation: { command: string; args: readonly string[]; timeoutMs?: number } | undefined;
	const run: CommandRunner = async (command, args, options) => {
		invocation = { command, args, ...(options?.timeoutMs ? { timeoutMs: options.timeoutMs } : {}) };
		const outputIndex = args.indexOf("--output-last-message");
		assert.notEqual(outputIndex, -1);
		await writeFile(
			args[outputIndex + 1] as string,
			'{"title":"Add Codex auto rename","kind":"feature","slug":"codex-auto-rename"}',
		);
		return { code: 0, stdout: "", stderr: "" };
	};

	const result = await nameWithCodexModel({
		prompt: "update autorename to also support codex",
		config: DEFAULT_CONFIG,
		cwd: process.cwd(),
		env: { ...process.env, CODEX_BIN_PATH: "fake-codex" },
		run,
	});

	assert.equal(result.source, "model");
	assert.equal(result.model, "openai-codex/gpt-5.4-mini");
	assert.equal(result.proposal.title, "Add Codex auto rename");
	assert.equal(invocation?.command, "fake-codex");
	assert.equal(invocation?.timeoutMs, DEFAULT_CONFIG.modelTimeoutMs);
	assert.ok(invocation?.args.includes("--ephemeral"));
	assert.ok(invocation?.args.includes("--ignore-user-config"));
	assert.deepEqual(invocation?.args.slice(3, 5), ["--disable", "hooks"]);
	assert.ok(invocation?.args.includes('model_reasoning_effort="low"'));
});

test("falls back to heuristics when Codex naming fails", async () => {
	const run: CommandRunner = async () => ({ code: 1, stdout: "", stderr: "authentication unavailable" });
	const result = await nameWithCodexModel({
		prompt: "what is this project about?",
		config: DEFAULT_CONFIG,
		cwd: process.cwd(),
		env: process.env,
		run,
	});
	assert.equal(result.source, "heuristic");
	assert.match(result.fallbackReason ?? "", /authentication unavailable/);
	assert.equal(result.proposal.title, "Understand project purpose");
});

test("falls back when the configured provider is unavailable in Codex", async () => {
	let called = false;
	const result = await nameWithCodexModel({
		prompt: "Add Codex support",
		config: { ...DEFAULT_CONFIG, namingModel: "anthropic/claude-test" },
		cwd: process.cwd(),
		env: process.env,
		run: async () => {
			called = true;
			return { code: 0, stdout: "", stderr: "" };
		},
	});
	assert.equal(called, false);
	assert.equal(result.source, "heuristic");
	assert.match(result.fallbackReason ?? "", /unavailable in Codex/);
});
