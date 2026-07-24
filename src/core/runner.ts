import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CommandRunner } from "./types.js";

const execFileAsync = promisify(execFile);

export const runCommand: CommandRunner = async (command, args, options = {}) => {
	try {
		const result = await execFileAsync(command, [...args], {
			cwd: options.cwd,
			env: options.env,
			timeout: options.timeoutMs,
			maxBuffer: 1024 * 1024,
			encoding: "utf8",
		});
		return { stdout: result.stdout, stderr: result.stderr, code: 0 };
	} catch (error) {
		const failure = error as Error & { stdout?: string; stderr?: string; code?: number | string };
		return {
			stdout: failure.stdout ?? "",
			stderr: failure.stderr ?? failure.message,
			code: typeof failure.code === "number" ? failure.code : 1,
		};
	}
};

export function commandError(command: string, args: readonly string[], result: { stderr: string; code: number }): Error {
	const detail = result.stderr.trim() || `exit code ${result.code}`;
	return new Error(`${command} ${args.join(" ")} failed: ${detail}`);
}
