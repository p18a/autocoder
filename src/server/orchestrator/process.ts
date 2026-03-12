import { join } from "node:path";
import type { Subprocess } from "bun";
import type { TaskType } from "../../shared/types.ts";
import { ALLOWED_ENV_KEYS, ALLOWED_TOOLS, DISCOVERY_EXTRA_TOOLS, TASK_TIMEOUT_MS } from "../constants.ts";
import { log } from "../logger.ts";
import type { OrchestratorDeps } from "./deps.ts";
import { processStderr, processStdout } from "./stream.ts";

const EXECUTION_PREAMBLE = `You are an autonomous coding agent. You are running without human supervision — do not ask questions or wait for confirmation. Make the requested change and verify it works.

Guidelines:
- Make minimal, focused changes. Only modify what is necessary to address the task.
- Read the relevant files before editing to understand existing patterns and conventions.
- After making changes, verify correctness: run the project's test suite or type checker if available.
- If the project has a CLAUDE.md or similar instructions file, follow its conventions.
- Do not introduce new dependencies unless the task specifically requires it.
- Do NOT run git commit, git add, or any git commands. Commits are handled automatically after your changes are verified.

Dev Journal:
Use the write_journal MCP tool to record discoveries that future tasks should know about. Good things to record:
- Abandoned approaches and why they didn't work
- Architectural constraints or gotchas you discovered
- Prerequisites or dependencies for follow-up work
- Recurring patterns or conventions not documented elsewhere
Do NOT record routine completions or restate the task prompt.

Task:
`;

const COMMIT_FOOTER_INSTRUCTION = `

When you are done, end your response with a footer separated by "---" containing a conventional commit message:

---
<type>(<scope>): <description>

Where <type> is one of: fix, feat, refactor, docs, test, chore, perf, style
<scope> is the primary module/area affected (e.g. auth, api, ui)
<description> is a short imperative summary of what changed`;

/**
 * Wrap a raw task prompt with autonomous execution context.
 * If a verifyCommand is provided, it is appended as an instruction.
 */
export function buildExecutionPrompt(prompt: string, verifyCommand?: string): string {
	let result = EXECUTION_PREAMBLE + prompt;
	if (verifyCommand) {
		result += `\n\nIMPORTANT: After making changes, run this verification command: ${verifyCommand}\nFix any issues before finishing.`;
	}
	result += COMMIT_FOOTER_INSTRUCTION;
	return result;
}

/** Return the last `maxChars` of `text`, prepending a truncation marker if trimmed. */
function tailText(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	return `…[truncated]\n${text.slice(-maxChars)}`;
}

/**
 * Run a shell command in the project directory and return the result.
 */
export async function runVerifyCommand(
	projectPath: string,
	verifyCommand: string,
	taskId: string,
	deps: OrchestratorDeps,
): Promise<{ success: boolean; output: string }> {
	const verifyLog = deps.db.appendTaskLog(taskId, `Running verify command: ${verifyCommand}`, "system");
	deps.broadcast({ type: "task_log", log: verifyLog });

	// Use bash instead of sh for better compatibility on macOS
	const proc = Bun.spawn(["bash", "-c", verifyCommand], {
		cwd: projectPath,
		stdout: "pipe",
		stderr: "pipe",
	});

	const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
	const exitCode = await proc.exited;

	// Build full output for the retry agent (not truncated)
	const parts: string[] = [`[exit code] ${exitCode}`];
	if (stdout.trim()) parts.push(`[stdout]\n${stdout.trim()}`);
	if (stderr.trim()) parts.push(`[stderr]\n${stderr.trim()}`);
	const output = parts.join("\n\n");

	// Log stdout and stderr as separate entries so they each get the full
	// truncation budget instead of competing for one. Use the TAIL of long
	// output since the test summary and error messages appear at the end.
	const exitCodeLog = deps.db.appendTaskLog(taskId, `Verify exit code: ${exitCode}`, "system");
	deps.broadcast({ type: "task_log", log: exitCodeLog });
	if (stderr.trim()) {
		const tail = tailText(stderr.trim(), 8_000);
		const stderrLog = deps.db.appendTaskLog(taskId, `[stderr]\n${tail}`, "system");
		deps.broadcast({ type: "task_log", log: stderrLog });
	}
	if (stdout.trim()) {
		const tail = tailText(stdout.trim(), 8_000);
		const stdoutLog = deps.db.appendTaskLog(taskId, `[stdout]\n${tail}`, "system");
		deps.broadcast({ type: "task_log", log: stdoutLog });
	}

	const success = exitCode === 0;
	const statusLog = deps.db.appendTaskLog(
		taskId,
		success ? "Verification passed" : `Verification failed (exit code ${exitCode})`,
		success ? "system" : "stderr",
	);
	deps.broadcast({ type: "task_log", log: statusLog });

	return { success, output };
}

/**
 * Extract a conventional commit message from Claude's result text.
 * Three-tier extraction:
 * 1. Regex — look for last "---" separator and extract commit line
 * 2. Sonnet fallback — call Claude to extract from result text
 * 3. Final fallback — chore: <first 72 chars of task prompt>
 */
export async function parseCommitSummary(resultText: string, taskPrompt: string): Promise<string> {
	// Tier 1: regex extraction
	const regex = extractCommitFromFooter(resultText);
	if (regex) return regex;

	// Tier 2: Sonnet fallback
	try {
		const sonnetResult = await extractCommitWithSonnet(resultText);
		if (sonnetResult) return sonnetResult;
	} catch (err) {
		log.warn("orchestrator", `Sonnet commit extraction failed: ${err instanceof Error ? err.message : String(err)}`);
	}

	// Tier 3: final fallback
	const truncated = taskPrompt.slice(0, 72).replace(/\n/g, " ");
	return `chore: ${truncated}`;
}

/** Tier 1: extract conventional commit from a --- footer in result text. */
function extractCommitFromFooter(resultText: string): string | null {
	const parts = resultText.split("---");
	if (parts.length < 2) return null;

	const lastPart = parts[parts.length - 1];
	if (!lastPart) return null;
	const footer = lastPart.trim();
	const match = footer.match(/^(fix|feat|refactor|docs|test|chore|perf|style)(\([^)]+\))?:\s*.+/m);
	return match ? match[0].trim() : null;
}

/** Tier 2: call Sonnet to extract a commit message from free-form text. */
async function extractCommitWithSonnet(resultText: string): Promise<string | null> {
	const prompt = `Extract a conventional commit message from this text. Return ONLY a single line in the format: type(scope): description

Where type is one of: fix, feat, refactor, docs, test, chore, perf, style
If you cannot determine the type, use "chore".

Text:
${resultText.slice(0, 5000)}`;

	const env = buildClaudeEnv();
	const proc = Bun.spawn(["claude", "-p", prompt, "--model", "claude-sonnet-4-6"], {
		stdout: "pipe",
		stderr: "pipe",
		env,
	});

	const timeout = setTimeout(() => proc.kill(), 30_000);
	const stdout = await new Response(proc.stdout).text();
	const exitCode = await proc.exited;
	clearTimeout(timeout);

	if (exitCode !== 0) return null;

	const line = stdout.trim().split("\n")[0] ?? "";
	const match = line.match(/^(fix|feat|refactor|docs|test|chore|perf|style)(\([^)]+\))?:\s*.+/);
	return match ? match[0].trim() : null;
}

/** Resolve path to the MCP server entrypoint. */
function getMcpServerPath(): string {
	// Use import.meta to resolve relative to this file → ../../mcp/server.ts
	return join(import.meta.dir, "..", "..", "mcp", "server.ts");
}

let _mcpConfigPath: string | null = null;

/** Get or create the MCP config JSON file for Claude subprocesses. */
export async function getMcpConfigPath(): Promise<string> {
	if (_mcpConfigPath) return _mcpConfigPath;

	const tmpDir = process.env.TMPDIR ?? "/tmp";
	const configPath = join(tmpDir, "autocoder-mcp-config.json");
	const mcpServerPath = getMcpServerPath();

	const config = {
		mcpServers: {
			autocoder: {
				command: "bun",
				args: [mcpServerPath],
			},
		},
	};

	await Bun.write(configPath, JSON.stringify(config, null, 2));
	log.info("orchestrator", `MCP config written to ${configPath} (server: ${mcpServerPath})`);
	_mcpConfigPath = configPath;
	return configPath;
}

/** Build a minimal env for Claude subprocesses — only forward known-safe variables. */
export function buildClaudeEnv(): Record<string, string | undefined> {
	const env: Record<string, string | undefined> = {};
	for (const key of ALLOWED_ENV_KEYS) {
		if (key in process.env) {
			env[key] = process.env[key];
		}
	}
	env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";
	return env;
}

/** Map of projectId → running Claude subprocess, for cancellation. */
export const activeProcesses = new Map<string, Subprocess>();

/**
 * Execute a single task by spawning the Claude CLI.
 * Streams output to the UI via task logs + broadcast.
 * Throws on non-zero exit code.
 *
 * @param effectivePrompt - The already-built prompt to send (caller applies buildExecutionPrompt)
 */
export async function executeTask(
	taskId: string,
	prompt: string,
	projectId: string,
	deps: OrchestratorDeps,
	taskType: TaskType = "execution",
	timeoutMs?: number,
	verifyCommand?: string,
): Promise<string | undefined> {
	const project = deps.db.getProject(projectId);
	if (!project) throw new Error(`Project ${projectId} not found`);

	const taskLog = deps.db.appendTaskLog(taskId, `Starting Claude in ${project.path}`, "system");
	deps.broadcast({ type: "task_log", log: taskLog });

	const effectivePrompt = taskType === "execution" ? buildExecutionPrompt(prompt, verifyCommand) : prompt;

	const mcpConfig = await getMcpConfigPath();

	const extraTools = taskType === "discovery" ? DISCOVERY_EXTRA_TOOLS : [];

	const args = [
		"claude",
		"-p",
		effectivePrompt,
		"--output-format",
		"stream-json",
		"--verbose",
		"--dangerously-skip-permissions",
		"--mcp-config",
		mcpConfig,
		"--allowedTools",
		...ALLOWED_TOOLS,
		...extraTools,
		"mcp__autocoder__*",
	];

	log.info("orchestrator", `Spawning Claude CLI for task ${taskId} in ${project.path}`, JSON.stringify(args));

	const env = buildClaudeEnv();

	const proc = Bun.spawn(args, {
		cwd: project.path,
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
		env,
	});

	// Close stdin immediately so Claude doesn't wait for interactive input
	proc.stdin.end();

	log.info("orchestrator", `Claude process spawned for task ${taskId}, pid=${proc.pid}`);

	activeProcesses.set(projectId, proc);

	let timedOut = false;
	const effectiveTimeoutMs = timeoutMs ?? TASK_TIMEOUT_MS;
	const timeout =
		effectiveTimeoutMs > 0
			? setTimeout(() => {
					timedOut = true;
					log.warn("orchestrator", `Task ${taskId} timed out after ${effectiveTimeoutMs / 1000}s, killing process`);
					const timeoutLog = deps.db.appendTaskLog(
						taskId,
						`Task timed out after ${effectiveTimeoutMs / 1000} seconds`,
						"stderr",
					);
					deps.broadcast({ type: "task_log", log: timeoutLog });
					proc.kill();
				}, effectiveTimeoutMs)
			: null;

	try {
		log.info("orchestrator", `[task=${taskId}] reading stdout+stderr streams…`);

		// Process stdout and stderr concurrently
		const [resultText] = await Promise.all([
			processStdout(proc.stdout as ReadableStream<Uint8Array>, taskId, deps),
			processStderr(proc.stderr as ReadableStream<Uint8Array>, taskId, deps),
		]);

		log.info("orchestrator", `[task=${taskId}] streams closed, awaiting exit code…`);

		const exitCode = await proc.exited;
		log.info(
			"orchestrator",
			`[task=${taskId}] process exited code=${exitCode}, resultText=${resultText ? `${resultText.length} chars` : "none"}`,
		);

		if (timedOut) {
			throw new Error(`Task timed out after ${effectiveTimeoutMs / 1000} seconds`);
		}

		if (exitCode !== 0) {
			throw new Error(`Claude exited with code ${exitCode}`);
		}

		if (resultText) {
			const resultLog = deps.db.appendTaskLog(taskId, resultText, "system");
			deps.broadcast({ type: "task_log", log: resultLog });
		}

		return resultText;
	} finally {
		if (timeout) clearTimeout(timeout);
		activeProcesses.delete(projectId);
	}
}
