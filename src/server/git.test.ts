import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { gitAutoCommit, gitHasChanges, gitRevertToCheckpoint, gitSaveCheckpoint } from "./git.ts";

/** Run a git command in a directory and return stdout. */
async function gitCmd(dir: string, args: string[]): Promise<string> {
	const proc = Bun.spawn(["git", ...args], { cwd: dir, stdout: "pipe", stderr: "pipe" });
	const stdout = await new Response(proc.stdout).text();
	await proc.exited;
	return stdout.trim();
}

/** Create a temp git repo with an initial commit. */
async function createTempRepo(): Promise<string> {
	const dir = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR ?? "/tmp"), "git-test-"));
	await gitCmd(dir, ["init"]);
	await gitCmd(dir, ["config", "user.name", "Test"]);
	await gitCmd(dir, ["config", "user.email", "test@test"]);
	fs.writeFileSync(path.join(dir, "readme.txt"), "initial");
	await gitCmd(dir, ["add", "."]);
	await gitCmd(dir, ["commit", "-m", "initial commit"]);
	return dir;
}

const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
	tempDirs.length = 0;
});

describe("gitHasChanges", () => {
	test("returns false on a clean working tree", async () => {
		const dir = await createTempRepo();
		tempDirs.push(dir);
		expect(await gitHasChanges(dir)).toBe(false);
	});

	test("returns true when a file is modified", async () => {
		const dir = await createTempRepo();
		tempDirs.push(dir);
		fs.writeFileSync(path.join(dir, "readme.txt"), "modified");
		expect(await gitHasChanges(dir)).toBe(true);
	});

	test("returns true when a new file is added", async () => {
		const dir = await createTempRepo();
		tempDirs.push(dir);
		fs.writeFileSync(path.join(dir, "new.txt"), "new file");
		expect(await gitHasChanges(dir)).toBe(true);
	});

	test("returns true when a file is deleted", async () => {
		const dir = await createTempRepo();
		tempDirs.push(dir);
		fs.unlinkSync(path.join(dir, "readme.txt"));
		expect(await gitHasChanges(dir)).toBe(true);
	});
});

describe("gitAutoCommit", () => {
	test("creates a commit and returns SHA", async () => {
		const dir = await createTempRepo();
		tempDirs.push(dir);
		fs.writeFileSync(path.join(dir, "file.txt"), "content");
		const sha = await gitAutoCommit(dir, "feat(test): add file");
		expect(sha).toBeString();
		expect(sha).toHaveLength(40);

		// Verify the commit message
		const msg = await gitCmd(dir, ["log", "-1", "--format=%s"]);
		expect(msg).toBe("feat(test): add file");
	});

	test("returns null on a clean tree", async () => {
		const dir = await createTempRepo();
		tempDirs.push(dir);
		const sha = await gitAutoCommit(dir, "chore: nothing");
		expect(sha).toBeNull();
	});

	test("handles deleted files", async () => {
		const dir = await createTempRepo();
		tempDirs.push(dir);
		fs.unlinkSync(path.join(dir, "readme.txt"));
		const sha = await gitAutoCommit(dir, "chore: remove readme");
		expect(sha).toBeString();
	});
});

describe("gitSaveCheckpoint + gitRevertToCheckpoint", () => {
	test("round-trips back to original state", async () => {
		const dir = await createTempRepo();
		tempDirs.push(dir);

		const checkpoint = await gitSaveCheckpoint(dir);
		expect(checkpoint).toHaveLength(40);

		// Make changes and commit
		fs.writeFileSync(path.join(dir, "readme.txt"), "modified content");
		fs.writeFileSync(path.join(dir, "extra.txt"), "extra file");
		await gitAutoCommit(dir, "feat: modify stuff");

		// Verify changes exist
		expect(fs.readFileSync(path.join(dir, "readme.txt"), "utf8")).toBe("modified content");
		expect(fs.existsSync(path.join(dir, "extra.txt"))).toBe(true);

		// Revert
		await gitRevertToCheckpoint(dir, checkpoint);

		// Verify original state is restored
		expect(fs.readFileSync(path.join(dir, "readme.txt"), "utf8")).toBe("initial");
		expect(fs.existsSync(path.join(dir, "extra.txt"))).toBe(false);
	});
});
