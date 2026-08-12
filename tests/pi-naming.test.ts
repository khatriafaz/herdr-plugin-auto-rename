import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DEFAULT_CONFIG } from "../src/core/config.js";
import { nameWithPiModel, sessionNamingInput } from "../src/extensions/pi-naming.js";

function contextWithRegistry(registry: Record<string, unknown>): ExtensionContext {
	return { modelRegistry: registry } as unknown as ExtensionContext;
}

test("records dedicated model provenance when model naming succeeds", async () => {
	let requestOptions: Record<string, unknown> | undefined;
	const model = {
		provider: "openai-codex",
		id: "gpt-5.6-luna",
		api: "openai-codex-responses",
		baseUrl: "https://example.test",
	};
	const context = contextWithRegistry({
		find: (provider: string, modelId: string) =>
			provider === model.provider && modelId === model.id ? model : undefined,
		getProvider: () => ({
			streamSimple: (_model: unknown, _context: unknown, options: Record<string, unknown>) => {
				requestOptions = options;
				return {
				result: async () => ({
					stopReason: "stop",
					content: [{
						type: "text",
						text: '{"title":"Understand project purpose","kind":"explore","slug":"understand-project-purpose"}',
					}],
				}),
				};
			},
		}),
		getProviderAuth: async () => ({ auth: { apiKey: "test" }, source: "test" }),
	});

	const result = await nameWithPiModel("what is this project about?", DEFAULT_CONFIG, context);
	assert.equal(result.source, "model");
	assert.equal(result.model, "openai-codex/gpt-5.6-luna");
	assert.equal(result.fallbackReason, undefined);
	assert.equal(result.proposal.title, "Understand project purpose");
	assert.equal(requestOptions?.temperature, undefined);
	assert.equal(requestOptions?.reasoning, "low");
});

test("records why dedicated model naming fell back to heuristics", async () => {
	const context = contextWithRegistry({
		find: () => undefined,
	});
	const result = await nameWithPiModel("what is this project about?", DEFAULT_CONFIG, context);
	assert.equal(result.source, "heuristic");
	assert.match(result.fallbackReason ?? "", /unavailable/);
	assert.equal(result.proposal.title, "Understand project purpose");
	assert.equal(result.proposal.kind, "explore");
});

test("builds no-input naming context from the active Pi session", () => {
	const context = {
		sessionManager: {
			buildContextEntries: () => ([
					{ type: "compaction", summary: "The user is improving workspace naming." },
					{ type: "message", message: { role: "user", content: "Update auto-rename to use the current session." } },
					{
						type: "message",
						message: {
							role: "assistant",
							content: [{ type: "text", text: "I will read the Pi session context." }],
						},
					},
					{ type: "message", message: { role: "toolResult", content: [{ type: "text", text: "noisy command output" }] } },
				]),
		},
	} as unknown as ExtensionContext;

	const input = sessionNamingInput(context);
	assert.equal(input?.prompt, "Update auto-rename to use the current session.");
	assert.match(input?.modelPrompt ?? "", /Session summary: The user is improving workspace naming\./);
	assert.match(input?.modelPrompt ?? "", /User: Update auto-rename/);
	assert.match(input?.modelPrompt ?? "", /Assistant: I will read/);
	assert.doesNotMatch(input?.modelPrompt ?? "", /noisy command output/);
});

test("returns no naming input for an empty session", () => {
	const context = {
		sessionManager: { buildContextEntries: () => [] },
	} as unknown as ExtensionContext;
	assert.equal(sessionNamingInput(context), undefined);
});
