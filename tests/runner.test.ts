import assert from "node:assert/strict";
import test from "node:test";
import { runCommand } from "../src/core/runner.js";

test("closes child stdin when no input is provided", async () => {
	const result = await runCommand(process.execPath, [
		"-e",
		"process.stdin.resume(); process.stdin.on('end', () => process.stdout.write('closed'))",
	], { timeoutMs: 1000 });

	assert.equal(result.code, 0);
	assert.equal(result.stdout, "closed");
});

test("writes provided child stdin and then closes it", async () => {
	const result = await runCommand(process.execPath, [
		"-e",
		"let value = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', chunk => value += chunk); process.stdin.on('end', () => process.stdout.write(value))",
	], { stdin: "rename me", timeoutMs: 1000 });

	assert.equal(result.code, 0);
	assert.equal(result.stdout, "rename me");
});
