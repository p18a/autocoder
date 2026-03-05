import * as fs from "node:fs";
import git from "isomorphic-git";
import { log } from "./logger.ts";

/**
 * Stage all changes and create a commit.
 * Returns the commit SHA, or null if the working tree is clean.
 */
export async function gitAutoCommit(projectPath: string, message: string): Promise<string | null> {
	if (!(await gitHasChanges(projectPath))) return null;

	await git.add({ fs, dir: projectPath, filepath: "." });

	// Also stage deletions — isomorphic-git's `add(".")` doesn't handle removes
	const status = await git.statusMatrix({ fs, dir: projectPath });
	for (const [filepath, head, workdir] of status) {
		// head=1 workdir=0 means file was deleted
		if (head === 1 && workdir === 0) {
			await git.remove({ fs, dir: projectPath, filepath });
		}
	}

	const sha = await git.commit({
		fs,
		dir: projectPath,
		message,
		author: { name: "Autocoder", email: "autocoder@localhost" },
	});

	log.info("git", `Committed ${sha.slice(0, 8)} in ${projectPath}: ${message}`);
	return sha;
}

/**
 * Save a checkpoint of the current HEAD for later revert.
 * Returns the current HEAD SHA.
 */
export async function gitSaveCheckpoint(projectPath: string): Promise<string> {
	const head = await git.resolveRef({ fs, dir: projectPath, ref: "HEAD" });
	log.info("git", `Checkpoint saved: ${head.slice(0, 8)} in ${projectPath}`);
	return head;
}

/**
 * Revert the working tree to a checkpoint SHA.
 * Performs a hard reset: moves HEAD and restores the working tree.
 */
export async function gitRevertToCheckpoint(projectPath: string, checkpointSha: string): Promise<void> {
	// Checkout the tree to restore working directory
	await git.checkout({
		fs,
		dir: projectPath,
		ref: checkpointSha,
		force: true,
	});

	// Move the branch ref back to the checkpoint
	const branch = await git.currentBranch({ fs, dir: projectPath });
	if (branch) {
		await git.writeRef({
			fs,
			dir: projectPath,
			ref: `refs/heads/${branch}`,
			value: checkpointSha,
			force: true,
		});
		// Point HEAD at the branch
		await git.checkout({ fs, dir: projectPath, ref: branch, force: true });
	}

	log.info("git", `Reverted to checkpoint ${checkpointSha.slice(0, 8)} in ${projectPath}`);
}

/**
 * Check whether the working tree has uncommitted changes.
 */
export async function gitHasChanges(projectPath: string): Promise<boolean> {
	const status = await git.statusMatrix({ fs, dir: projectPath });
	// Each row: [filepath, head, workdir, stage]
	// Clean file: [f, 1, 1, 1]. Anything else means changes.
	return status.some(([, head, workdir, stage]) => !(head === 1 && workdir === 1 && stage === 1));
}
