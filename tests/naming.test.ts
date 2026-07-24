import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_CONFIG, parseConfig } from "../src/core/config.js";
import {
	formatBranchName,
	heuristicName,
	inferTaskKind,
	parseModelProposal,
	slugify,
} from "../src/core/naming.js";

test("infers common task kinds", () => {
	assert.equal(inferTaskKind("Fix the crash in checkout"), "fix");
	assert.equal(inferTaskKind("Refactor authentication middleware"), "refactor");
	assert.equal(inferTaskKind("Add tests for billing"), "test");
	assert.equal(inferTaskKind("Implement customer exports"), "feature");
});

test("heuristic naming removes conversational filler", () => {
	const proposal = heuristicName(
		"Please add automatic retry handling to the Stripe webhook processor.",
		DEFAULT_CONFIG,
	);
	assert.equal(proposal.kind, "feature");
	assert.equal(proposal.title, "Automatic retry handling to the Stripe webhook");
	assert.equal(proposal.slug, "automatic-retry-handling-to-the-stripe-webhook");
	assert.equal(formatBranchName(proposal, DEFAULT_CONFIG), "feat/automatic-retry-handling-to-the-stripe-webhook");
});

test("heuristic naming converts project questions into an exploratory action", () => {
	const proposal = heuristicName("what is this project about?", DEFAULT_CONFIG);
	assert.deepEqual(proposal, {
		title: "Understand project purpose",
		kind: "explore",
		slug: "understand-project-purpose",
	});
});

test("heuristic naming converts project explanation requests into an exploratory action", () => {
	const proposal = heuristicName("tell me about this project", DEFAULT_CONFIG);
	assert.deepEqual(proposal, {
		title: "Understand project purpose",
		kind: "explore",
		slug: "understand-project-purpose",
	});
});

test("model JSON is sanitized and bounded", () => {
	const proposal = parseModelProposal(
		'```json\n{"title":"Fix Login Redirect!!!","kind":"fix","slug":"Fix/Login Redirect"}\n```',
		"Fix login redirect",
		DEFAULT_CONFIG,
	);
	assert.deepEqual(proposal, { title: "Fix Login Redirect", kind: "fix", slug: "fix-login-redirect" });
});

test("slugify normalizes accents and unsafe Git characters", () => {
	assert.equal(slugify("Crème brûlée: auth@edge", 48), "creme-brulee-auth-edge");
});

test("branch formatting supports all prefix styles", () => {
	const proposal = { title: "Fix auth", kind: "fix" as const, slug: "fix-auth" };
	assert.equal(formatBranchName(proposal, parseConfig({ branch_prefix_style: "hyphen" })), "fix-fix-auth");
	assert.equal(formatBranchName(proposal, parseConfig({ branch_prefix_style: "none" })), "fix-auth");
});
