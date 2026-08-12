#!/usr/bin/env node
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function readStdin() {
	const chunks = [];
	for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	return Buffer.concat(chunks);
}

async function herdrPluginRoot() {
	const herdr = process.env.HERDR_BIN_PATH || "herdr";
	const { stdout } = await execFileAsync(herdr, ["plugin", "list", "--plugin", "afaz.auto-rename", "--json"], {
		env: process.env,
		encoding: "utf8",
		timeout: 5000,
	});
	const payload = JSON.parse(stdout);
	const plugin = payload?.result?.plugins?.find((item) => item.plugin_id === "afaz.auto-rename");
	return typeof plugin?.plugin_root === "string" ? plugin.plugin_root : undefined;
}

async function runAdapter(entrypoint, input) {
	await new Promise((resolve) => {
		const child = spawn(process.execPath, [entrypoint], {
			cwd: process.cwd(),
			env: process.env,
			stdio: ["pipe", "ignore", "ignore"],
		});
		const timeout = setTimeout(() => child.kill(), 60000);
		child.once("error", () => {
			clearTimeout(timeout);
			resolve();
		});
		child.once("close", () => {
			clearTimeout(timeout);
			resolve();
		});
		child.stdin.end(input);
	});
}

async function runWorker(payloadPath) {
	try {
		const input = await readFile(payloadPath);
		const root = await herdrPluginRoot();
		if (!root) return;
		const entrypoint = join(root, "dist", "src", "extensions", "codex-hook-cli.js");
		await access(entrypoint);
		await runAdapter(entrypoint, input);
	} catch {
		// Automatic Codex rename failures are intentionally silent.
	} finally {
		await rm(payloadPath, { force: true }).catch(() => undefined);
	}
}

async function queueWorker() {
	try {
		const pluginData = process.env.PLUGIN_DATA;
		if (!pluginData) return;
		const queueDirectory = join(pluginData, "incoming");
		await mkdir(queueDirectory, { recursive: true });
		const payloadPath = join(queueDirectory, `${randomUUID()}.json`);
		await writeFile(payloadPath, await readStdin());
		const child = spawn(process.execPath, [process.argv[1], "--worker", payloadPath], {
			cwd: process.cwd(),
			env: process.env,
			detached: true,
			stdio: "ignore",
		});
		child.unref();
	} catch {
		// The synchronous hook launcher must return successfully and silently.
	}
}

if (process.argv[2] === "--worker" && process.argv[3]) {
	void runWorker(process.argv[3]);
} else {
	void queueWorker();
}
