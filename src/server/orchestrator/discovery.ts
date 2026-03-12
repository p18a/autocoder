import { getJournalEntries, getJournalEntriesByTier } from "../db/journal.ts";
import { log } from "../logger.ts";
import type { OrchestratorDeps } from "./deps.ts";

export const DISCOVERY_PROMPT = `You are an autonomous code reviewer. Analyze this codebase and identify concrete issues worth fixing. Prioritize by impact:

1. **Bugs & correctness** — crashes, wrong behavior, data loss, race conditions
2. **Security** — injection, auth bypass, secrets exposure, unsafe deserialization
3. **Error handling** — unhandled exceptions, silent failures, missing validation at system boundaries
4. **Performance** — O(n²) in hot paths, memory leaks, unnecessary re-renders, missing indexes
5. **Code quality** — dead code, duplicated logic, misleading names (only if they cause real confusion)

Skip cosmetic issues (formatting, comment style, naming preferences). Each issue must be a single, focused fix — do not bundle multiple unrelated changes.

## How to submit issues

For each issue you find, call the \`add_task\` MCP tool with:
- **projectId**: \`{{PROJECT_ID}}\`
- **title**: short title (under 80 chars)
- **prompt**: actionable prompt with file paths, current vs. expected behavior, and implementation guidance — detailed enough for an autonomous agent to complete without asking questions
- **originTaskId**: \`{{TASK_ID}}\`
- **mode**: \`{{DISCOVERY_MODE}}\`

Include in each prompt:
- The exact file path(s) and function/component names involved
- What the current behavior is and why it's wrong
- What the correct behavior should be
- Any edge cases or constraints to watch for

Submit each issue as a separate \`add_task\` call. The tool handles deduplication and caps automatically. When you have submitted all issues, output a short summary of what you found.`;

/** Build journal context section for discovery prompts. */
function buildJournalContext(projectId: string): string {
	const historical = getJournalEntriesByTier(projectId, "historical", 1);
	const summaries = getJournalEntriesByTier(projectId, "summary", 3);
	const recent = getJournalEntries(projectId, 5);

	const parts: string[] = [];

	if (historical.length > 0) {
		parts.push(`Historical context:\n${historical[0]?.content ?? ""}`);
	}
	if (summaries.length > 0) {
		parts.push(`Previous cycle summaries:\n${summaries.map((e) => e.content).join("\n")}`);
	}
	if (recent.length > 0) {
		parts.push(`Recent notes:\n${recent.map((e) => `[${e.createdAt}] ${e.content}`).join("\n")}`);
	}

	if (parts.length === 0) return "";
	return `\n\n## Dev Journal\nThe following notes were recorded by previous autonomous agents working on this project. Use them to avoid repeating past mistakes, continue multi-step plans, and build on prior discoveries.\n\n${parts.join("\n\n")}`;
}

/**
 * Interpolate discovery-specific placeholders into a prompt.
 * {{PROJECT_ID}} and {{DISCOVERY_MODE}} are set at prompt build time.
 * {{TASK_ID}} is left as-is — it gets interpolated at execution time in the queue
 * once the task's actual ID is known.
 */
function interpolateDiscoveryPrompt(template: string, projectId: string, mode: string): string {
	return template.replaceAll("{{PROJECT_ID}}", projectId).replaceAll("{{DISCOVERY_MODE}}", mode);
}

/** Build the prompt for a discovery task, incorporating custom instructions if set. */
export function buildDiscoveryPrompt(projectId: string, deps: OrchestratorDeps): string {
	const customInstructions = deps.db.getProjectConfig(projectId, "custom_instructions");
	const journal = buildJournalContext(projectId);

	let prompt = DISCOVERY_PROMPT;
	if (customInstructions) {
		prompt += `\n\nAdditional focus areas from the user:\n${customInstructions}`;
	}
	if (journal) {
		prompt += journal;
	}
	return interpolateDiscoveryPrompt(prompt, projectId, "janitor");
}

const AUTOPILOT_MCP_INSTRUCTIONS = `
## How to submit tasks

For each task, call the \`add_task\` MCP tool with:
- **projectId**: \`{{PROJECT_ID}}\`
- **title**: short title (under 80 chars)
- **prompt**: actionable prompt with file paths, current vs. expected behavior, and implementation guidance — detailed enough for an autonomous agent to complete without asking questions
- **originTaskId**: \`{{TASK_ID}}\`
- **mode**: \`{{DISCOVERY_MODE}}\`

Include in each prompt:
- The exact file path(s) and function/component names involved (or where to create new ones)
- What the current state is
- What the desired state should be
- Any edge cases or constraints to watch for

Submit each task as a separate \`add_task\` call. The tool handles deduplication and caps automatically.`;

export const AUTOPILOT_PROMPT = `You are an autonomous product developer. You have full context on this project's goals and can review its git history for what has already been done.

## Your Task

Start by running \`git log --oneline -20\` to see what has been done recently. Then spawn **two subagents in parallel** using the Task tool:

### Subagent 1 — Quality & improvements (3-5 tasks)
Find 3-5 fixes or small improvements. Prioritize by impact:
1. Bugs & correctness — crashes, wrong behavior, data loss, race conditions
2. Security — injection, auth bypass, secrets exposure
3. Error handling — unhandled exceptions, silent failures, missing validation
4. Performance — O(n²) in hot paths, memory leaks, unnecessary re-renders
5. Small refactors — dead code, duplicated logic (only if they cause real confusion)

Skip cosmetic issues. Each task must be a single, focused fix.

### Subagent 2 — Features (1-2 tasks)
Identify 1-2 new feature tasks that advance the project toward its goals. Consider:
1. What feature or improvement would add the most value? What's the next logical step?
2. Is the codebase ready, or does it need groundwork first? Don't build on a shaky foundation.
3. Don't repeat work that git history shows was already done.

Each feature task should be scoped small enough for a single agent to complete autonomously.

### Instructions for both subagents
Give each subagent the full MCP instructions below and tell it to call \`add_task\` for each task it identifies. Put foundational/blocking work first, then features.
${AUTOPILOT_MCP_INSTRUCTIONS}

After both subagents complete, output a short summary of what was planned.`;

/** Build the prompt for an autopilot discovery task. */
export function buildAutopilotPrompt(projectId: string, deps: OrchestratorDeps): string {
	const purpose = deps.db.getProjectConfig(projectId, "project_purpose");

	if (!purpose) {
		log.warn("orchestrator", `Autopilot mode with no project goals for project ${projectId}, falling back to janitor`);
		return buildDiscoveryPrompt(projectId, deps);
	}

	const customInstructions = deps.db.getProjectConfig(projectId, "custom_instructions");
	const journal = buildJournalContext(projectId);

	let prompt = `${AUTOPILOT_PROMPT}\n\n## Project Goals\n${purpose}`;
	if (customInstructions) {
		prompt += `\n\nAdditional instructions from the user:\n${customInstructions}`;
	}
	if (journal) {
		prompt += journal;
	}
	return interpolateDiscoveryPrompt(prompt, projectId, "autopilot");
}

/**
 * Count how many execution tasks were created by a specific discovery task.
 * Used to determine if the discovery agent successfully created tasks via MCP.
 */
export function countTasksFromDiscovery(discoveryTaskId: string, projectId: string, deps: OrchestratorDeps): number {
	const allTasks = deps.db.listTasks(projectId);
	return allTasks.filter((t) => t.originTaskId === discoveryTaskId).length;
}
