import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DEFAULT_CONFIG } from "../src/core/config.js";
import { nameWithPiModel } from "../src/extensions/pi-naming.js";

function contextWithRegistry(registry: Record<string, unknown>): ExtensionContext {
	return { modelRegistry: registry } as unknown as ExtensionContext;
}

test("records dedicated model provenance when model naming succeeds", async () => {
	const model = {
		provider: "openai-codex",
		id: "gpt-5.4-mini",
		api: "openai-codex-responses",
		baseUrl: "https://example.test",
	};
	const context = contextWithRegistry({
		find: (provider: string, modelId: string) =>
			provider === model.provider && modelId === model.id ? model : undefined,
		getProvider: () => ({
			streamSimple: () => ({
				result: async () => ({
					stopReason: "stop",
					content: [{
						type: "text",
						text: '{"title":"Understand project purpose","kind":"explore","slug":"understand-project-purpose"}',
					}],
				}),
			}),
		}),
		getProviderAuth: async () => ({ auth: { apiKey: "test" }, source: "test" }),
	});

	const result = await nameWithPiModel("what is this project about?", DEFAULT_CONFIG, context);
	assert.equal(result.source, "model");
	assert.equal(result.model, "openai-codex/gpt-5.4-mini");
	assert.equal(result.fallbackReason, undefined);
	assert.equal(result.proposal.title, "Understand project purpose");
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
