import {
	JOURNAL_COMPRESS_BATCH_SIZE,
	JOURNAL_COMPRESS_THRESHOLD,
	JOURNAL_COMPRESSION_TIMEOUT_MS,
	JOURNAL_HARD_CAP,
	JOURNAL_ROLLUP_BATCH_SIZE,
	JOURNAL_SUMMARY_MAX,
} from "../constants.ts";
import {
	appendJournalEntry,
	clearJournalTier,
	getJournalEntriesByTier,
	getJournalEntryCount,
	getOldestRecentEntries,
	removeJournalEntry,
} from "../db/journal.ts";
import { log } from "../logger.ts";
import { buildClaudeEnv } from "./process.ts";

/**
 * Check if a project's journal needs compression and run it if so.
 * Called after each discovery/execution cycle completes.
 *
 * Two-stage compression:
 * 1. recent → summary: When recent entries exceed threshold, compress the oldest batch into bullet-point summaries.
 * 2. summary → historical: When summary entries exceed max, roll up the oldest batch, keeping only important decisions.
 */
export async function compressJournalIfNeeded(projectId: string): Promise<void> {
	try {
		await compressRecentToSummary(projectId);
		await compressSummaryToHistorical(projectId);
		enforceHardCap(projectId);
	} catch (err) {
		log.warn(
			"orchestrator",
			`Journal compression failed for project ${projectId}: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
}

/** Stage 1: Compress oldest "recent" entries into "summary" bullet points. */
async function compressRecentToSummary(projectId: string): Promise<void> {
	const recentCount = getJournalEntryCount(projectId, "recent");
	if (recentCount < JOURNAL_COMPRESS_THRESHOLD) return;

	const oldest = getOldestRecentEntries(projectId, JOURNAL_COMPRESS_BATCH_SIZE);
	if (oldest.length === 0) return;

	log.info("orchestrator", `Compressing ${oldest.length} recent journal entries → summary for project ${projectId}`);

	const entriesText = oldest.map((e) => `[${e.createdAt}]\n${e.content}`).join("\n\n---\n\n");

	const prompt = `Compress these developer journal entries into concise bullet-point summaries. Keep key decisions, discoveries, and outcomes. Drop routine details and redundant information. Each bullet should be self-contained and useful without the original context.

Return ONLY the bullet points, one per line starting with "- ". No preamble, no commentary.

--- BEGIN ENTRIES ---
${entriesText}`;

	const summary = await callClaudeForCompression(prompt);
	if (!summary) {
		log.warn("orchestrator", "Journal compression (recent→summary) produced no output, skipping");
		return;
	}

	// Replace the old entries with the summary
	for (const entry of oldest) {
		removeJournalEntry(entry.id);
	}
	appendJournalEntry(projectId, summary, "summary");
}

/** Stage 2: Roll up oldest "summary" entries into "historical" — only important decisions survive. */
async function compressSummaryToHistorical(projectId: string): Promise<void> {
	const summaryCount = getJournalEntryCount(projectId, "summary");
	if (summaryCount < JOURNAL_SUMMARY_MAX) return;

	const allSummaries = getJournalEntriesByTier(projectId, "summary", JOURNAL_ROLLUP_BATCH_SIZE);
	if (allSummaries.length === 0) return;

	log.info(
		"orchestrator",
		`Rolling up ${allSummaries.length} summary journal entries → historical for project ${projectId}`,
	);

	// Get existing historical context to inform the rollup
	const existingHistorical = getJournalEntriesByTier(projectId, "historical", 1);
	const historicalContext = existingHistorical.length > 0 ? (existingHistorical[0]?.content ?? "") : "";

	const summariesText = allSummaries.map((e) => e.content).join("\n\n");

	const prompt = `You are maintaining a project's historical context document. This captures only the most important architectural decisions, strategic direction changes, and critical discoveries — not routine work.

${historicalContext ? `Current historical context:\n${historicalContext}\n\n` : ""}New summary entries to incorporate:
${summariesText}

Write an updated historical context paragraph (or short paragraphs). Rules:
- Only keep information that would matter weeks or months from now
- Drop routine bug fixes, minor improvements, and implementation details
- Keep: architectural decisions, strategic pivots, critical discoveries, recurring patterns
- Be concise — this should fit in a few short paragraphs
- Return ONLY the updated historical context, no preamble`;

	const historical = await callClaudeForCompression(prompt);
	if (!historical) {
		log.warn("orchestrator", "Journal compression (summary→historical) produced no output, skipping");
		return;
	}

	// Replace old summaries and historical with the new consolidated entry
	for (const entry of allSummaries) {
		removeJournalEntry(entry.id);
	}
	clearJournalTier(projectId, "historical");
	appendJournalEntry(projectId, historical, "historical");
}

/** Safety net: if total entries exceed hard cap, drop oldest recent entries. */
function enforceHardCap(projectId: string): void {
	const total = getJournalEntryCount(projectId);
	if (total <= JOURNAL_HARD_CAP) return;

	const excess = total - JOURNAL_HARD_CAP;
	const toRemove = getOldestRecentEntries(projectId, excess);
	for (const entry of toRemove) {
		removeJournalEntry(entry.id);
	}
	log.warn("orchestrator", `Journal hard cap: removed ${toRemove.length} oldest entries for project ${projectId}`);
}

/** Call Claude CLI with a compression prompt and return the output text. */
async function callClaudeForCompression(prompt: string): Promise<string | null> {
	const env = buildClaudeEnv();
	const args = ["claude", "-p", prompt, "--dangerously-skip-permissions"];

	const proc = Bun.spawn(args, {
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
		env,
	});
	proc.stdin.end();

	const timeout = setTimeout(() => proc.kill(), JOURNAL_COMPRESSION_TIMEOUT_MS);

	try {
		const stdout = await new Response(proc.stdout).text();
		const exitCode = await proc.exited;
		clearTimeout(timeout);

		if (exitCode !== 0) {
			log.warn("orchestrator", `Journal compression Claude call exited with code ${exitCode}`);
			return null;
		}

		return stdout.trim() || null;
	} catch (err) {
		clearTimeout(timeout);
		log.error(
			"orchestrator",
			`Journal compression Claude call failed: ${err instanceof Error ? err.message : String(err)}`,
		);
		return null;
	}
}
