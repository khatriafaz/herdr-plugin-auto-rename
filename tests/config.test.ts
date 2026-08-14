import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DEFAULT_CONFIG, loadConfig, parseConfig } from "../src/core/config.js";

test("config applies defaults and overrides", () => {
	const config = parseConfig({
		naming_strategy: "heuristic",
		max_slug_length: 30,
		prefixes: { feature: "feature" },
	});
	assert.equal(config.namingStrategy, "heuristic");
	assert.equal(config.namingModel, "openai-codex/gpt-5.6-luna");
	assert.equal(config.maxSlugLength, 30);
	assert.equal(config.prefixes.feature, "feature");
	assert.equal(config.prefixes.fix, DEFAULT_CONFIG.prefixes.fix);
	assert.match("worktree/silver-stone-eeb7", new RegExp(config.generatedBranchPattern));
	assert.match("worktree-silver-stone-eeb7", new RegExp(config.generatedBranchPattern));
});

test("config rejects invalid patterns and values", () => {
	assert.throws(() => parseConfig({ generated_branch_pattern: "[" }), /valid regular expression/);
	assert.throws(() => parseConfig({ collision_policy: "overwrite" }), /collision_policy/);
	assert.throws(() => parseConfig({ naming_model: "gpt-5.6-luna" }), /provider\/model/);
	assert.throws(() => parseConfig({ max_slug_length: 2 }), /max_slug_length/);
});

test("missing config loads defaults without structuredClone", async () => {
	const directory = await mkdtemp(join(tmpdir(), "herdr-auto-rename-config-"));
	const originalStructuredClone = globalThis.structuredClone;
	try {
		Object.defineProperty(globalThis, "structuredClone", {
			value: undefined,
			configurable: true,
			writable: true,
		});
		const config = await loadConfig(join(directory, "missing.toml"));
		assert.deepEqual(config, DEFAULT_CONFIG);
		assert.notEqual(config, DEFAULT_CONFIG);
		assert.notEqual(config.prefixes, DEFAULT_CONFIG.prefixes);
	} finally {
		Object.defineProperty(globalThis, "structuredClone", {
			value: originalStructuredClone,
			configurable: true,
			writable: true,
		});
		await rm(directory, { recursive: true, force: true });
	}
});
