import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { heuristicName, parseModelProposal } from "../core/naming.js";
import type { AutoRenameConfig, NameProposal } from "../core/types.js";

const SYSTEM_PROMPT = `You name coding tasks. Return only one compact JSON object with this schema:
{"title":"Human readable title","kind":"feature|fix|refactor|docs|test|chore|explore","slug":"git-safe-kebab-case"}
The title must describe the concrete outcome in at most 7 words. The slug must be at most 7 words. Do not include a branch prefix in slug.`;

export async function nameWithPiModel(
	prompt: string,
	config: AutoRenameConfig,
	ctx: ExtensionContext,
): Promise<NameProposal> {
	if (config.namingStrategy === "heuristic") return heuristicName(prompt, config);
	const separator = config.namingModel.indexOf("/");
	const providerId = config.namingModel.slice(0, separator);
	const modelId = config.namingModel.slice(separator + 1);
	const model = ctx.modelRegistry.find(providerId, modelId);
	if (!model) return heuristicName(prompt, config);
	const provider = ctx.modelRegistry.getProvider(model.provider);
	const authResult = await ctx.modelRegistry.getProviderAuth(model.provider);
	if (!provider || !authResult) return heuristicName(prompt, config);

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), config.modelTimeoutMs);
	try {
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
				temperature: 0,
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
		return parseModelProposal(text, prompt, config);
	} catch {
		return heuristicName(prompt, config);
	} finally {
		clearTimeout(timeout);
	}
}
