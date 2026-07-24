import type { AutoRenameConfig, NameProposal, TaskKind } from "./types.js";

const KIND_PATTERNS: Array<[TaskKind, RegExp]> = [
	["fix", /\b(fix|bug|broken|error|issue|regression|crash|incorrect|repair|resolve)\b/i],
	["refactor", /\b(refactor|restructure|reorganize|cleanup|clean up|simplify|extract|decouple)\b/i],
	["docs", /\b(document|documentation|docs|readme|guide|changelog)\b/i],
	["test", /\b(test|tests|testing|coverage|spec|specs)\b/i],
	["explore", /(?:^\s*(?:please\s+)?(?:explore|investigate|research|plan|design|audit|review|what|how|why|explain|understand|tell|describe)\b|\b(?:spike|prototype)\b)/i],
	["chore", /\b(chore|dependency|dependencies|upgrade|update package|tooling|config|configuration|ci|build)\b/i],
];

const LEADING_FILLER = /^(?:please\s+|could you\s+|can you\s+|i(?:'d| would)? like (?:you )?to\s+|we (?:want|need) to\s+|let'?s\s+|create\s+|add\s+|implement\s+|build\s+|make\s+)+/i;

export function inferTaskKind(prompt: string): TaskKind {
	for (const [kind, pattern] of KIND_PATTERNS) {
		if (pattern.test(prompt)) return kind;
	}
	return "feature";
}

function wordsWithin(value: string, maxLength: number): string {
	if (value.length <= maxLength) return value;
	const shortened = value.slice(0, maxLength + 1).replace(/\s+\S*$/, "").trim();
	return shortened || value.slice(0, maxLength).trim();
}

export function slugify(value: string, maxLength: number): string {
	const slug = value
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/['’]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.replace(/-{2,}/g, "-");
	const bounded = slug.slice(0, maxLength).replace(/-+$/g, "");
	return bounded || "task";
}

export function sanitizeProposal(input: Partial<NameProposal>, prompt: string, config: AutoRenameConfig): NameProposal {
	const fallback = heuristicName(prompt, config);
	const kind = input.kind && ["feature", "fix", "refactor", "docs", "test", "chore", "explore"].includes(input.kind)
		? input.kind
		: fallback.kind;
	const rawTitle = typeof input.title === "string" ? input.title : fallback.title;
	const title = wordsWithin(
		rawTitle.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").replace(/[.!?:;,]+$/g, "").trim(),
		config.maxTitleLength,
	) || fallback.title;
	return {
		title: title.charAt(0).toUpperCase() + title.slice(1),
		kind,
		slug: slugify(typeof input.slug === "string" ? input.slug : title, config.maxSlugLength),
	};
}

export function heuristicName(prompt: string, config: AutoRenameConfig): NameProposal {
	const firstMeaningfulLine = prompt
		.replace(/```[\s\S]*?```/g, " ")
		.split(/\r?\n/)
		.map((line) => line.replace(/^\s*(?:[-*#>]|\d+[.)])\s*/, "").trim())
		.find((line) => line.length > 0) ?? "Task";
	const sentence = firstMeaningfulLine.split(/(?<=[.!?])\s/)[0] ?? firstMeaningfulLine;
	let cleaned = sentence.replace(LEADING_FILLER, "").replace(/[.!?:;,]+$/g, "").trim() || "Task";
	if (/^what is this project about$/i.test(cleaned)) cleaned = "Understand project purpose";
	else if (/^what does this (?:project|repository|repo) do$/i.test(cleaned)) cleaned = "Understand project purpose";
	else if (/^(?:tell me about|describe|explain) this (?:project|repository|repo)$/i.test(cleaned)) cleaned = "Understand project purpose";
	const title = wordsWithin(cleaned, config.maxTitleLength);
	return sanitizeWithoutRecursion({ title, kind: inferTaskKind(prompt), slug: title }, config);
}

function sanitizeWithoutRecursion(input: NameProposal, config: AutoRenameConfig): NameProposal {
	const title = wordsWithin(input.title.replace(/\s+/g, " ").trim(), config.maxTitleLength) || "Task";
	return {
		title: title.charAt(0).toUpperCase() + title.slice(1),
		kind: input.kind,
		slug: slugify(input.slug, config.maxSlugLength),
	};
}

export function parseModelProposal(text: string, prompt: string, config: AutoRenameConfig): NameProposal {
	const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
	const candidate = fenced ?? text.match(/\{[\s\S]*\}/)?.[0];
	if (!candidate) throw new Error("naming model did not return JSON");
	const parsed = JSON.parse(candidate) as Partial<NameProposal>;
	return sanitizeProposal(parsed, prompt, config);
}

export function formatBranchName(proposal: NameProposal, config: AutoRenameConfig): string {
	const prefix = config.prefixes[proposal.kind];
	if (!prefix || config.branchPrefixStyle === "none") return proposal.slug;
	return config.branchPrefixStyle === "slash" ? `${prefix}/${proposal.slug}` : `${prefix}-${proposal.slug}`;
}
