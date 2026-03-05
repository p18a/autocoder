import type { z } from "zod/v4";
import { discoveryResultSchema } from "../../shared/schema.ts";
import { EXTRACTION_TIMEOUT_MS, MAX_AUTOPILOT_ISSUES, MAX_DISCOVERY_ISSUES } from "../constants.ts";
import { log } from "../logger.ts";
import type { OrchestratorDeps } from "./deps.ts";
import { buildClaudeEnv } from "./process.ts";

export const DISCOVERY_PROMPT = `You are an autonomous code reviewer. Analyze this codebase and identify concrete issues worth fixing. Prioritize by impact:

1. **Bugs & correctness** — crashes, wrong behavior, data loss, race conditions
2. **Security** — injection, auth bypass, secrets exposure, unsafe deserialization
3. **Error handling** — unhandled exceptions, silent failures, missing validation at system boundaries
4. **Performance** — O(n²) in hot paths, memory leaks, unnecessary re-renders, missing indexes
5. **Code quality** — dead code, duplicated logic, misleading names (only if they cause real confusion)

Skip cosmetic issues (formatting, comment style, naming preferences). Each issue must be a single, focused fix — do not bundle multiple unrelated changes.

Output ONLY a list of tasks. No preamble, no summary, no commentary before or after the list. Separate each task with "---".

For each task, write a markdown heading with a short title, followed by an actionable prompt that gives an autonomous coding agent enough context to implement the fix without asking questions. Include:
- The exact file path(s) and function/component names involved
- What the current behavior is and why it's wrong
- What the correct behavior should be
- Any edge cases or constraints to watch for

Example output:

# Missing null check in user handler
In src/handlers/user.ts, the getUser function (line ~42) calls db.findUser(id) and immediately accesses result.name without checking for null. If the user ID doesn't exist in the database, this throws a TypeError at runtime. Add a null check after the query and return a 404 JSON response ({ error: "User not found" }) if the result is null. Make sure the response content-type is application/json to match the other error responses in this file.
---
# SQL injection in search endpoint
In src/routes/search.ts, the searchProducts function (line ~15) builds a SQL query by concatenating req.query.q directly into the WHERE clause. An attacker can inject arbitrary SQL. Replace the string concatenation with a parameterized query using db.prepare("SELECT * FROM products WHERE name LIKE ?").all(\`%\${query}%\`). Verify the existing tests still pass after the change.`;

/** Build the prompt for a discovery task, incorporating custom instructions if set. */
export function buildDiscoveryPrompt(projectId: string, deps: OrchestratorDeps): string {
	const customInstructions = deps.db.getProjectConfig(projectId, "custom_instructions");
	if (customInstructions) {
		return `${DISCOVERY_PROMPT}\n\nAdditional focus areas from the user:\n${customInstructions}`;
	}
	return DISCOVERY_PROMPT;
}

export const AUTOPILOT_PROMPT = `You are an autonomous product developer. You have full context on this project's purpose and can review its git history for what has already been done.

## Your Task
Start by running \`git log --oneline -20\` to see what has been done recently. If any commits look relevant, check their details with \`git log -5 --format="### %s%n%b"\` for the 5 most recent.

Then analyze the codebase and decide what to do next. Consider three perspectives:

1. **Product**: What feature or improvement would add the most value toward the project's purpose? What's the next logical step?
2. **Architecture**: Is the codebase ready for that next step, or does it need refactoring/infrastructure work first? Don't build on a shaky foundation.
3. **Quality**: Are there bugs, security issues, or broken tests that would undermine new work? Fix blockers before adding features.

Produce a prioritized task list. Put foundational/blocking work first, then features. Each cycle should be a coherent unit of progress — 3-5 focused tasks, not 20 scattered ones. Don't repeat work that git history shows was already done.

Output ONLY a list of tasks. No preamble, no summary, no commentary before or after the list. Separate each task with "---".

For each task, write a markdown heading with a short title, followed by an actionable prompt that gives an autonomous coding agent enough context to implement the change without asking questions. Include:
- The exact file path(s) and function/component names involved (or where to create new ones)
- What the current state is
- What the desired state should be
- Any edge cases or constraints to watch for`;

/** Build the prompt for an autopilot discovery task. */
export function buildAutopilotPrompt(projectId: string, deps: OrchestratorDeps): string {
	const purpose = deps.db.getProjectConfig(projectId, "project_purpose");
	const customInstructions = deps.db.getProjectConfig(projectId, "custom_instructions");

	if (!purpose) {
		log.warn("orchestrator", `Autopilot mode with no purpose doc for project ${projectId}, falling back to janitor`);
		return buildDiscoveryPrompt(projectId, deps);
	}

	let prompt = `${AUTOPILOT_PROMPT}\n\n## Project Purpose\n${purpose}`;

	if (customInstructions) {
		prompt += `\n\nAdditional focus areas from the user:\n${customInstructions}`;
	}

	return prompt;
}

/** Get the max issues cap for the current discovery mode. */
export function getMaxIssuesForMode(projectId: string, deps: OrchestratorDeps): number {
	const mode = deps.db.getProjectConfig(projectId, "discovery_mode");
	return mode === "autopilot" ? MAX_AUTOPILOT_ISSUES : MAX_DISCOVERY_ISSUES;
}

/** Parse discovery result text into structured issues. */
export function parseDiscoveryResult(resultText: string): z.infer<typeof discoveryResultSchema> | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(resultText);
	} catch (err) {
		log.error(
			"orchestrator",
			`parseDiscoveryResult: JSON parse failed: ${err instanceof Error ? err.message : String(err)}`,
		);
		log.error("orchestrator", `parseDiscoveryResult: raw text (first 500 chars): ${resultText.slice(0, 500)}`);
		return null;
	}

	const result = discoveryResultSchema.safeParse(parsed);
	if (!result.success) {
		log.error("orchestrator", `parseDiscoveryResult: schema validation failed: ${result.error.message}`);
		log.error(
			"orchestrator",
			`parseDiscoveryResult: parsed type=${typeof parsed}, isArray=${Array.isArray(parsed)}, preview=${JSON.stringify(parsed).slice(0, 300)}`,
		);
	}
	return result.success ? result.data : null;
}

/**
 * Parse discovery output into structured issues.
 * Handles multiple heading levels (# through ####), horizontal-rule separators
 * (---, ***, ___), and tolerates preamble/postamble text outside of headings.
 */
export function parseDiscoveryMarkdown(text: string): { title: string; prompt: string }[] {
	const issues: { title: string; prompt: string }[] = [];

	// Split on horizontal rules: ---, ***, ___ (with optional trailing whitespace)
	const sections = text.split(/^(?:---+|\*\*\*+|___+)\s*$/m);

	for (const section of sections) {
		// Match headings at any level: #, ##, ###, ####
		const titleMatch = section.match(/^#{1,4}\s+(.+)/m);
		if (!titleMatch?.[1]) continue;

		const title = titleMatch[1].trim();
		// Everything after the heading line is the prompt
		const headingEnd = section.indexOf("\n", section.indexOf(titleMatch[0]));
		const prompt = headingEnd === -1 ? "" : section.slice(headingEnd + 1).trim();

		if (title && prompt) {
			issues.push({ title, prompt });
		}
	}

	return issues;
}

/** Parse discovery result text into structured issues. */
export function dedupeIssues(
	issues: { prompt: string; title: string }[],
	existingTasks: { prompt: string }[],
): { prompt: string; title: string }[] {
	const existingPrompts = new Set(existingTasks.map((t) => t.prompt.trim().toLowerCase()));
	const seen = new Set<string>();
	return issues.filter((issue) => {
		const key = issue.prompt.trim().toLowerCase();
		if (seen.has(key) || existingPrompts.has(key)) return false;
		seen.add(key);
		return true;
	});
}

/** Dedupe, cap, and enqueue discovery issues as execution tasks. */
export function enqueueDiscoveryIssues(
	discoveryTaskId: string,
	projectId: string,
	issues: { title: string; prompt: string }[],
	deps: OrchestratorDeps,
) {
	const maxIssues = getMaxIssuesForMode(projectId, deps);
	const capped = issues.slice(0, maxIssues);
	if (issues.length > maxIssues) {
		const capLog = deps.db.appendTaskLog(
			discoveryTaskId,
			`Discovery returned ${issues.length} issues, capped to ${maxIssues}`,
			"system",
		);
		deps.broadcast({ type: "task_log", log: capLog });
	}

	const existing = deps.db.getQueuedTasksByProject(projectId);
	const deduped = dedupeIssues(capped, existing);

	for (const issue of deduped) {
		const newTask = deps.db.createTask(projectId, issue.prompt, "execution", discoveryTaskId, issue.title);
		deps.broadcast({ type: "task_added", task: newTask });
	}
}

/**
 * Post-process discovery output: parse the markdown into structured issues.
 * Extracts ### headings as titles and > **Prompt:** blocks as prompts.
 * No second Claude call needed — the discovery prompt already produces structured output.
 */
export function postProcessDiscovery(
	taskId: string,
	_projectId: string,
	resultText: string,
	deps: OrchestratorDeps,
): z.infer<typeof discoveryResultSchema> | null {
	const ppLog = deps.db.appendTaskLog(
		taskId,
		"Post-processing: extracting structured tasks from discovery output…",
		"system",
	);
	deps.broadcast({ type: "task_log", log: ppLog });

	const issues = parseDiscoveryMarkdown(resultText);

	if (issues.length > 0) {
		const doneLog = deps.db.appendTaskLog(taskId, `Extracted ${issues.length} issues from discovery output`, "system");
		deps.broadcast({ type: "task_log", log: doneLog });
	} else {
		log.warn("orchestrator", `[task=${taskId}] post-process: no issues extracted from discovery markdown`);
		log.warn("orchestrator", `[task=${taskId}] post-process: first 500 chars: ${resultText.slice(0, 500)}`);
	}

	return issues.length > 0 ? issues : null;
}

/**
 * Phase 2 fallback: when markdown parsing fails, use a second Claude call
 * with --output-format json to extract structured issues from the raw text.
 */
export async function extractDiscoveryWithClaude(
	taskId: string,
	projectId: string,
	rawText: string,
	deps: OrchestratorDeps,
): Promise<{ title: string; prompt: string }[] | null> {
	const project = deps.db.getProject(projectId);
	if (!project) return null;

	const extractLog = deps.db.appendTaskLog(
		taskId,
		"Markdown parsing failed — running structured extraction (Phase 2)…",
		"system",
	);
	deps.broadcast({ type: "task_log", log: extractLog });

	const extractionPrompt = `Extract every distinct issue from this codebase analysis into a JSON array.

Each element must have:
- "title": short title for the issue (under 80 chars)
- "prompt": actionable prompt with file paths, current vs. expected behavior, and implementation guidance — detailed enough for an autonomous agent to fix it without asking questions

Return ONLY a valid JSON array. No markdown fences, no commentary, no wrapping object.

Example: [{"title":"Missing null check in getUser","prompt":"In src/handlers/user.ts, the getUser function does not check if db.findUser returns null before accessing properties. Add a null check after the query and return a 404 response if the user is not found."}]

--- BEGIN DISCOVERY OUTPUT (may be truncated) ---
${rawText.slice(0, 15_000)}`;

	const args = ["claude", "-p", extractionPrompt, "--output-format", "json", "--dangerously-skip-permissions"];

	const env = buildClaudeEnv();

	try {
		const proc = Bun.spawn(args, {
			cwd: project.path,
			stdin: "pipe",
			stdout: "pipe",
			stderr: "pipe",
			env,
		});
		proc.stdin.end();

		const timeout = setTimeout(() => proc.kill(), EXTRACTION_TIMEOUT_MS);

		const stdout = await new Response(proc.stdout).text();
		const exitCode = await proc.exited;
		clearTimeout(timeout);

		if (exitCode !== 0) {
			log.warn("orchestrator", `[task=${taskId}] Phase 2 extraction exited with code ${exitCode}`);
			return null;
		}

		return parseDiscoveryResult(stdout.trim());
	} catch (err) {
		log.error(
			"orchestrator",
			`[task=${taskId}] Phase 2 extraction error: ${err instanceof Error ? err.message : String(err)}`,
		);
		return null;
	}
}
