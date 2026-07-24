import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { heuristicName, parseModelProposal } from "../core/naming.js";
import type { AutoRenameConfig, NamingResult } from "../core/types.js";

const SYSTEM_PROMPT = `You name coding tasks. Return only one compact JSON object with this schema:
{"title":"Human readable title","kind":"feature|fix|refactor|docs|test|chore|explore","slug":"git-safe-kebab-case"}
The title must describe the concrete outcome in at most 7 words. Never copy the user's sentence verbatim. Convert questions and requests for explanation into concise action-oriented noun or verb phrases. Do not use question words, first-person pronouns, or trailing punctuation. For example, "what is this project about?" becomes title "Understand project purpose", kind "explore", slug "understand-project-purpose". The slug must be at most 7 words. Do not include a branch prefix in slug.`;

export async function nameWithPiModel(
	prompt: string,
	config: AutoRenameConfig,
	ctx: ExtensionContext,
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
				systemPrompt: SYSTEM_PROMPT,
				messages: [{ role: "user", content: prompt.slice(0, 6000), timestamp: Date.now() }],
			},
			{
				...(authResult.auth.apiKey ? { apiKey: authResult.auth.apiKey } : {}),
				...(authResult.auth.headers ? { headers: authResult.auth.headers } : {}),
				...(authResult.env ? { env: authResult.env } : {}),
				signal: controller.signal,
				maxTokens: 120,
				reasoning: "minimal",
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
