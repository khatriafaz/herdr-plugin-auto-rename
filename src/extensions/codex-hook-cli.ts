#!/usr/bin/env node
import { stdin } from "node:process";
import { handleCodexHook } from "./codex.js";

async function readInput(): Promise<unknown> {
	const chunks: Buffer[] = [];
	for await (const chunk of stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function main(): Promise<void> {
	try {
		await handleCodexHook(await readInput());
	} catch {
		// Codex support is deliberately silent and must never block the user's turn.
	}
}

void main();
