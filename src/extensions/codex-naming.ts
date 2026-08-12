import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { namingRequestPrompt } from "../core/model-prompt.js";
import { heuristicName, parseModelProposal } from "../core/naming.js";
import { runCommand } from "../core/runner.js";
import type { AutoRenameConfig, CommandRunner, NamingResult } from "../core/types.js";

export async function nameWithCodexModel(options: {
	prompt: string;
	config: AutoRenameConfig;
	cwd: string;
	env: NodeJS.ProcessEnv;
	run?: CommandRunner;
}): Promise<NamingResult> {
	const { prompt, config, cwd, env } = options;
	const run = options.run ?? runCommand;
	const startedAt = Date.now();
	const heuristic = (fallbackReason?: string): NamingResult => ({
		proposal: heuristicName(prompt, config),
		source: "heuristic",
		...(fallbackReason ? { fallbackReason } : {}),
		durationMs: Date.now() - startedAt,
	});
	if (config.namingStrategy === "heuristic") return heuristic();

	const separator = config.namingModel.indexOf("/");
	const provider = config.namingModel.slice(0, separator);
	const model = config.namingModel.slice(separator + 1);
	if (provider !== "openai-codex") {
		return heuristic(`naming provider ${provider} is unavailable in Codex`);
	}

	const temporaryDirectory = await mkdtemp(join(tmpdir(), "herdr-auto-rename-codex-"));
	const outputPath = join(temporaryDirectory, "proposal.txt");
	try {
		const codex = env.CODEX_BIN_PATH || "codex";
		const result = await run(codex, [
			"exec",
			"--ephemeral",
			"--ignore-user-config",
			"--disable", "hooks",
			"--sandbox", "read-only",
			"--skip-git-repo-check",
			"--model", model,
			"--config", 'model_reasoning_effort="low"',
			"--cd", cwd,
			"--output-last-message", outputPath,
			namingRequestPrompt(prompt),
		], { cwd, env, timeoutMs: config.modelTimeoutMs });
		if (result.code !== 0) {
			return heuristic(result.stderr.trim() || `naming request exited with code ${result.code}`);
		}
		const text = await readFile(outputPath, "utf8");
		return {
			proposal: parseModelProposal(text, prompt, config),
			source: "model",
			model: config.namingModel,
			durationMs: Date.now() - startedAt,
		};
	} catch (error) {
		return heuristic((error as Error).message || "naming model request failed");
	} finally {
		await rm(temporaryDirectory, { recursive: true, force: true });
	}
}
