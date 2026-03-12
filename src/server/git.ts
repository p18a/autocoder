import { log } from "./logger.ts";

/** Run a git command in the given directory and return trimmed stdout. Throws on non-zero exit. */
async function run(projectPath: string, args: string[]): Promise<string> {
	const proc = Bun.spawn(["git", ...args], {
		cwd: projectPath,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
	const exitCode = await proc.exited;
	if (exitCode !== 0) {
		throw new Error(`git ${args[0]} failed (exit ${exitCode}): ${stderr.trim()}`);
	}
	return stdout.trim();
}

/**
 * Stage all changes and create a commit.
 * Returns the commit SHA, or null if the working tree is clean.
 */
export async function gitAutoCommit(projectPath: string, message: string): Promise<string | null> {
	if (!(await gitHasChanges(projectPath))) return null;

	await run(projectPath, ["add", "-A"]);
	await run(projectPath, ["commit", "-m", message, "--author", "Autocoder <autocoder@localhost>"]);
	const sha = await run(projectPath, ["rev-parse", "HEAD"]);

	log.info("git", `Committed ${sha.slice(0, 8)} in ${projectPath}: ${message}`);
	return sha;
}

/**
 * Save a checkpoint of the current HEAD for later revert.
 * Returns the current HEAD SHA.
 */
export async function gitSaveCheckpoint(projectPath: string): Promise<string> {
	const head = await run(projectPath, ["rev-parse", "HEAD"]);
	log.info("git", `Checkpoint saved: ${head.slice(0, 8)} in ${projectPath}`);
	return head;
}

/**
 * Revert the working tree to a checkpoint SHA.
 * Performs a hard reset: moves HEAD and restores the working tree.
 */
export async function gitRevertToCheckpoint(projectPath: string, checkpointSha: string): Promise<void> {
	await run(projectPath, ["reset", "--hard", checkpointSha]);
	log.info("git", `Reverted to checkpoint ${checkpointSha.slice(0, 8)} in ${projectPath}`);
}

/**
 * Check whether the working tree has uncommitted changes.
 */
export async function gitHasChanges(projectPath: string): Promise<boolean> {
	const output = await run(projectPath, ["status", "--porcelain"]);
	return output.length > 0;
}
