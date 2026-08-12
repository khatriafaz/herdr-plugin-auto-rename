import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

async function waitForFile(path: string): Promise<string> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		try {
			return await readFile(path, "utf8");
		} catch {
			await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
		}
	}
	throw new Error(`timed out waiting for ${path}`);
}

test("launcher resolves the built adapter from the linked Herdr plugin", async () => {
	const root = await mkdtemp(join(tmpdir(), "herdr-codex-launcher-"));
	try {
		const pluginRoot = join(root, "plugin with spaces");
		const entryDirectory = join(pluginRoot, "dist", "src", "extensions");
		const marker = join(root, "received.json");
		await mkdir(entryDirectory, { recursive: true });
		await writeFile(
			join(entryDirectory, "codex-hook-cli.js"),
			'import { writeFile } from "node:fs/promises";\n'
				+ 'const chunks = []; for await (const chunk of process.stdin) chunks.push(chunk);\n'
				+ 'await writeFile(process.env.TEST_MARKER, Buffer.concat(chunks));\n',
		);
		const fakeHerdr = join(root, "fake-herdr.mjs");
		await writeFile(
			fakeHerdr,
			`#!/usr/bin/env node\nconsole.log(${JSON.stringify(JSON.stringify({
				result: { plugins: [{ plugin_id: "afaz.auto-rename", plugin_root: pluginRoot }] },
			}))});\n`,
		);
		await chmod(fakeHerdr, 0o755);

		const input = JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "Test" });
		await new Promise<void>((resolvePromise, reject) => {
			const child = spawn(process.execPath, [resolve("scripts/codex-hook.mjs")], {
				cwd: process.cwd(),
				env: {
					...process.env,
					HERDR_BIN_PATH: fakeHerdr,
					PLUGIN_DATA: join(root, "plugin-data"),
					TEST_MARKER: marker,
				},
				stdio: ["pipe", "pipe", "pipe"],
			});
			child.once("error", reject);
			child.once("close", (code) => code === 0 ? resolvePromise() : reject(new Error(`launcher exited ${code}`)));
			child.stdin.end(input);
		});
		assert.equal(await waitForFile(marker), input);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("plugin hook stays compatible by omitting Codex's async flag", async () => {
	const config = JSON.parse(await readFile(resolve("hooks/hooks.json"), "utf8"));
	const hook = config.hooks.UserPromptSubmit[0].hooks[0];
	assert.equal(hook.async, undefined);
	assert.equal(hook.timeout, 5);
});
