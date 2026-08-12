import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { boundedPrompt, NAMING_SYSTEM_PROMPT } from "../core/model-prompt.js";
import { heuristicName, parseModelProposal } from "../core/naming.js";
import type { AutoRenameConfig, NamingResult } from "../core/types.js";

export interface SessionNamingInput {
	prompt: string;
	modelPrompt: string;
}

function textContent(content: unknown): string {
	if (typeof content === "string") return content.trim();
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is { type: "text"; text: string } =>
			Boolean(part) && typeof part === "object" && part.type === "text" && typeof part.text === "string")
		.map((part) => part.text.trim())
		.filter(Boolean)
		.join("\n");
}

export function sessionNamingInput(ctx: ExtensionContext): SessionNamingInput | undefined {
	const sections: string[] = [];
	const userPrompts: string[] = [];
	for (const entry of ctx.sessionManager.buildContextEntries()) {
		if (entry.type === "branch_summary" || entry.type === "compaction") {
			const summary = entry.summary.trim();
			if (summary) sections.push(`Session summary: ${summary}`);
			continue;
		}
		if (entry.type === "custom_message") {
			const text = textContent(entry.content);
			if (text) sections.push(`Context: ${text}`);
			continue;
		}
		if (entry.type !== "message") continue;
		const message = entry.message;
		if (message.role !== "user" && message.role !== "assistant" && message.role !== "custom") continue;
		const text = textContent(message.content);
		if (!text) continue;
		if (message.role === "user") userPrompts.push(text);
		const label = message.role === "user" ? "User" : message.role === "assistant" ? "Assistant" : "Context";
		sections.push(`${label}: ${text}`);
	}
	if (sections.length === 0) return undefined;
	const prompt = userPrompts.join("\n") || sections.join("\n\n");
	return {
		prompt,
		modelPrompt: [
			"Infer a single coding-task name from the current Pi session conversation.",
			"Prioritize the user's goal and the concrete outcome of the work over incidental implementation details.",
			"",
			"<session>",
			sections.join("\n\n"),
			"</session>",
		].join("\n"),
	};
}

export async function nameWithPiModel(
	prompt: string,
	config: AutoRenameConfig,
	ctx: ExtensionContext,
	modelPrompt = prompt,
): Promise<NamingResult> {
	const startedAt = Date.now();
	const heuristic = (fallbackReason?: string): NamingResult => ({
		proposal: heuristicName(prompt, config),
		source: "heuristic",
		...(fallbackReason ? { fallbackReason } : {}),
		durationMs: Date.now() - startedAt,
	});
	if (config.namingStrategy === "heuristic") return heuristic();
	const separator = config.namingModel.indexOf("/");
	const providerId = config.namingModel.slice(0, separator);
	const modelId = config.namingModel.slice(separator + 1);
	const model = ctx.modelRegistry.find(providerId, modelId);
	if (!model) return heuristic(`naming model ${config.namingModel} is unavailable`);
	const provider = ctx.modelRegistry.getProvider(model.provider);
	if (!provider) return heuristic(`provider ${model.provider} is unavailable`);

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), config.modelTimeoutMs);
	try {
		const authResult = await ctx.modelRegistry.getProviderAuth(model.provider);
		if (!authResult) return heuristic(`authentication for ${model.provider} is unavailable`);
		const requestModel = authResult.auth.baseUrl
			? { ...model, baseUrl: authResult.auth.baseUrl }
			: model;
		const stream = provider.streamSimple(
			requestModel,
			{
				systemPrompt: NAMING_SYSTEM_PROMPT,
				messages: [{ role: "user", content: boundedPrompt(modelPrompt), timestamp: Date.now() }],
			},
			{
				...(authResult.auth.apiKey ? { apiKey: authResult.auth.apiKey } : {}),
				...(authResult.auth.headers ? { headers: authResult.auth.headers } : {}),
				...(authResult.env ? { env: authResult.env } : {}),
				signal: controller.signal,
				maxTokens: 120,
				reasoning: "low",
			},
		);
		const response = await stream.result();
		if (response.stopReason === "error" || response.stopReason === "aborted") {
			throw new Error(response.errorMessage || `naming request ${response.stopReason}`);
		}
		const text = response.content
			.filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text")
			.map((part) => part.text)
			.join("");
		return {
			proposal: parseModelProposal(text, prompt, config),
			source: "model",
			model: config.namingModel,
			durationMs: Date.now() - startedAt,
		};
	} catch (error) {
		return heuristic((error as Error).message || "naming model request failed");
	} finally {
		clearTimeout(timeout);
	}
}
