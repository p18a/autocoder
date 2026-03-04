import type { Subprocess } from "bun";
import type { TaskType } from "../../shared/types.ts";
import { ALLOWED_ENV_KEYS, ALLOWED_TOOLS, TASK_TIMEOUT_MS } from "../constants.ts";
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

Task:
`;

/** Wrap a raw task prompt with autonomous execution context. */
export function buildExecutionPrompt(prompt: string): string {
	return EXECUTION_PREAMBLE + prompt;
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
 */
export async function executeTask(
	taskId: string,
	prompt: string,
	projectId: string,
	deps: OrchestratorDeps,
	taskType: TaskType = "execution",
): Promise<string | undefined> {
	const project = deps.db.getProject(projectId);
	if (!project) throw new Error(`Project ${projectId} not found`);

	const taskLog = deps.db.appendTaskLog(taskId, `Starting Claude in ${project.path}`, "system");
	deps.broadcast({ type: "task_log", log: taskLog });

	const effectivePrompt = taskType === "execution" ? buildExecutionPrompt(prompt) : prompt;

	const args = [
		"claude",
		"-p",
		effectivePrompt,
		"--output-format",
		"stream-json",
		"--verbose",
		"--dangerously-skip-permissions",
		"--allowedTools",
		...ALLOWED_TOOLS,
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

	const timeout = setTimeout(() => {
		log.warn("orchestrator", `Task ${taskId} timed out after ${TASK_TIMEOUT_MS / 1000}s, killing process`);
		const timeoutLog = deps.db.appendTaskLog(
			taskId,
			`Task timed out after ${TASK_TIMEOUT_MS / 1000} seconds`,
			"stderr",
		);
		deps.broadcast({ type: "task_log", log: timeoutLog });
		proc.kill();
	}, TASK_TIMEOUT_MS);

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

		if (exitCode !== 0) {
			throw new Error(`Claude exited with code ${exitCode}`);
		}

		if (resultText) {
			const resultLog = deps.db.appendTaskLog(taskId, resultText, "system");
			deps.broadcast({ type: "task_log", log: resultLog });
		}

		return resultText;
	} finally {
		clearTimeout(timeout);
		activeProcesses.delete(projectId);
	}
}
