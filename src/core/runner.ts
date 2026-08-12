import { execFile } from "node:child_process";
import type { CommandRunner } from "./types.js";

export const runCommand: CommandRunner = async (command, args, options = {}) => {
	return await new Promise((resolve) => {
		const child = execFile(command, [...args], {
			cwd: options.cwd,
			env: options.env,
			timeout: options.timeoutMs,
			maxBuffer: 1024 * 1024,
			encoding: "utf8",
		}, (error, stdout, stderr) => {
			if (!error) {
				resolve({ stdout, stderr, code: 0 });
				return;
			}
			const failure = error as Error & { code?: number | string };
			resolve({
				stdout,
				stderr: stderr || failure.message,
				code: typeof failure.code === "number" ? failure.code : 1,
			});
		});

		// execFile creates a pipe for stdin. Close it explicitly so commands such as
		// `codex exec PROMPT` do not wait for an additional piped stdin block.
		child.stdin?.end(options.stdin);
	});
};

export function commandError(command: string, args: readonly string[], result: { stderr: string; code: number }): Error {
	const detail = result.stderr.trim() || `exit code ${result.code}`;
	return new Error(`${command} ${args.join(" ")} failed: ${detail}`);
}
