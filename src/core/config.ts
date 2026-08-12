import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse } from "smol-toml";
import { TASK_KINDS, type AutoRenameConfig, type TaskKind } from "./types.js";

export const DEFAULT_CONFIG: AutoRenameConfig = {
	enabled: true,
	namingStrategy: "model",
	namingModel: "openai-codex/gpt-5.6-luna",
	generatedBranchPattern: "^worktree(?:/|-)",
	branchPrefixStyle: "slash",
	collisionPolicy: "suffix",
	maxTitleLength: 48,
	maxSlugLength: 48,
	modelTimeoutMs: 30000,
	setPiSessionName: true,
	notify: true,
	prefixes: {
		feature: "feat",
		fix: "fix",
		refactor: "refactor",
		docs: "docs",
		test: "test",
		chore: "chore",
		explore: "explore",
	},
};

type RawConfig = Record<string, unknown>;

export function defaultConfigPath(env: NodeJS.ProcessEnv = process.env): string {
	if (env.HERDR_AUTO_RENAME_CONFIG) return env.HERDR_AUTO_RENAME_CONFIG;
	if (env.HERDR_PLUGIN_CONFIG_DIR) return join(env.HERDR_PLUGIN_CONFIG_DIR, "config.toml");
	const root = env.XDG_CONFIG_HOME || join(homedir(), ".config");
	return join(root, "herdr", "plugins", "config", "afaz.auto-rename", "config.toml");
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string, fallback: T): T {
	if (value === undefined) return fallback;
	if (typeof value !== "string" || !allowed.includes(value as T)) {
		throw new Error(`${field} must be one of: ${allowed.join(", ")}`);
	}
	return value as T;
}

function bool(value: unknown, field: string, fallback: boolean): boolean {
	if (value === undefined) return fallback;
	if (typeof value !== "boolean") throw new Error(`${field} must be a boolean`);
	return value;
}

function modelSpec(value: unknown, fallback: string): string {
	if (value === undefined) return fallback;
	if (typeof value !== "string" || !/^[^/\s]+\/[^/\s]+$/.test(value)) {
		throw new Error("naming_model must use provider/model format");
	}
	return value;
}

function boundedInt(value: unknown, field: string, fallback: number, min: number, max: number): number {
	if (value === undefined) return fallback;
	if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
		throw new Error(`${field} must be an integer from ${min} to ${max}`);
	}
	return value as number;
}

export function parseConfig(raw: RawConfig): AutoRenameConfig {
	const pattern = raw.generated_branch_pattern ?? DEFAULT_CONFIG.generatedBranchPattern;
	if (typeof pattern !== "string") throw new Error("generated_branch_pattern must be a string");
	try {
		new RegExp(pattern);
	} catch {
		throw new Error("generated_branch_pattern must be a valid regular expression");
	}

	const rawPrefixes = raw.prefixes;
	if (rawPrefixes !== undefined && (typeof rawPrefixes !== "object" || rawPrefixes === null || Array.isArray(rawPrefixes))) {
		throw new Error("prefixes must be a TOML table");
	}
	const prefixes = { ...DEFAULT_CONFIG.prefixes };
	for (const kind of TASK_KINDS) {
		const value = (rawPrefixes as Record<string, unknown> | undefined)?.[kind];
		if (value !== undefined) {
			if (typeof value !== "string" || !/^[a-z0-9-]*$/.test(value)) {
				throw new Error(`prefixes.${kind} must contain lowercase letters, digits, or hyphens`);
			}
			prefixes[kind as TaskKind] = value;
		}
	}

	return {
		enabled: bool(raw.enabled, "enabled", DEFAULT_CONFIG.enabled),
		namingStrategy: oneOf(raw.naming_strategy, ["model", "heuristic"], "naming_strategy", DEFAULT_CONFIG.namingStrategy),
		namingModel: modelSpec(raw.naming_model, DEFAULT_CONFIG.namingModel),
		generatedBranchPattern: pattern,
		branchPrefixStyle: oneOf(
			raw.branch_prefix_style,
			["slash", "hyphen", "none"],
			"branch_prefix_style",
			DEFAULT_CONFIG.branchPrefixStyle,
		),
		collisionPolicy: oneOf(
			raw.collision_policy,
			["suffix", "fail"],
			"collision_policy",
			DEFAULT_CONFIG.collisionPolicy,
		),
		maxTitleLength: boundedInt(raw.max_title_length, "max_title_length", DEFAULT_CONFIG.maxTitleLength, 12, 120),
		maxSlugLength: boundedInt(raw.max_slug_length, "max_slug_length", DEFAULT_CONFIG.maxSlugLength, 12, 100),
		modelTimeoutMs: boundedInt(raw.model_timeout_ms, "model_timeout_ms", DEFAULT_CONFIG.modelTimeoutMs, 1000, 60000),
		setPiSessionName: bool(raw.set_pi_session_name, "set_pi_session_name", DEFAULT_CONFIG.setPiSessionName),
		notify: bool(raw.notify, "notify", DEFAULT_CONFIG.notify),
		prefixes,
	};
}

export async function loadConfig(path = defaultConfigPath()): Promise<AutoRenameConfig> {
	try {
		const contents = await readFile(path, "utf8");
		return parseConfig(parse(contents) as RawConfig);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return structuredClone(DEFAULT_CONFIG);
		throw new Error(`Invalid auto-rename config at ${path}: ${(error as Error).message}`);
	}
}
