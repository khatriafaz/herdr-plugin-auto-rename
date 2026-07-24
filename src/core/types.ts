export const TASK_KINDS = ["feature", "fix", "refactor", "docs", "test", "chore", "explore"] as const;

export type TaskKind = (typeof TASK_KINDS)[number];
export type NamingStrategy = "model" | "heuristic";
export type BranchPrefixStyle = "slash" | "hyphen" | "none";
export type CollisionPolicy = "suffix" | "fail";

export interface AutoRenameConfig {
	enabled: boolean;
	namingStrategy: NamingStrategy;
	namingModel: string;
	generatedBranchPattern: string;
	branchPrefixStyle: BranchPrefixStyle;
	collisionPolicy: CollisionPolicy;
	maxTitleLength: number;
	maxSlugLength: number;
	modelTimeoutMs: number;
	setPiSessionName: boolean;
	notify: boolean;
	prefixes: Record<TaskKind, string>;
}

export interface NameProposal {
	title: string;
	kind: TaskKind;
	slug: string;
}

export interface CommandResult {
	stdout: string;
	stderr: string;
	code: number;
}

export interface CommandOptions {
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	timeoutMs?: number;
}

export type CommandRunner = (
	command: string,
	args: readonly string[],
	options?: CommandOptions,
) => Promise<CommandResult>;

export interface EligibilityResult {
	eligible: boolean;
	reason?: string;
	branch?: string;
	workspaceId?: string;
}

export interface RenameResult {
	status: "renamed" | "partial" | "skipped";
	title?: string;
	previousBranch?: string;
	branch?: string;
	reason?: string;
	warning?: string;
}
