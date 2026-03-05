import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as db from "./index.ts";
import {
	appendJournalEntry,
	clearJournalTier,
	getJournalEntries,
	getJournalEntriesByTier,
	getJournalEntryCount,
	getOldestRecentEntries,
	getOldestSummaryEntries,
	removeJournalEntry,
	searchJournalEntries,
} from "./journal.ts";

let projectId: string;

beforeAll(() => {
	const project = db.createProject("Journal Test", `/tmp/journal-test-${Date.now()}`);
	projectId = project.id;
});

afterAll(() => {
	db.deleteProjectCascade(projectId);
});

describe("journal DB", () => {
	test("appends and retrieves entries", () => {
		const entry = appendJournalEntry(projectId, "Discovered auth module uses deprecated API");
		expect(entry.projectId).toBe(projectId);
		expect(entry.content).toBe("Discovered auth module uses deprecated API");
		expect(entry.tier).toBe("recent");

		const entries = getJournalEntries(projectId, 10);
		const found = entries.find((e) => e.id === entry.id);
		expect(found).toBeTruthy();
	});

	test("returns entries in chronological order", () => {
		const e1 = appendJournalEntry(projectId, "Chrono first");
		const e2 = appendJournalEntry(projectId, "Chrono second");

		const entries = getJournalEntries(projectId, 50);
		const firstIdx = entries.findIndex((e) => e.id === e1.id);
		const secondIdx = entries.findIndex((e) => e.id === e2.id);
		expect(firstIdx).toBeLessThan(secondIdx);
	});

	test("respects limit parameter", () => {
		const entries = getJournalEntries(projectId, 1);
		expect(entries.length).toBe(1);
	});

	test("filters by tier", () => {
		appendJournalEntry(projectId, "Summary entry", "summary");
		appendJournalEntry(projectId, "Historical entry", "historical");

		const summaries = getJournalEntriesByTier(projectId, "summary", 50);
		expect(summaries.every((e) => e.tier === "summary")).toBe(true);

		const historical = getJournalEntriesByTier(projectId, "historical", 50);
		expect(historical.every((e) => e.tier === "historical")).toBe(true);
	});

	test("searches by content", () => {
		appendJournalEntry(projectId, "The auth module needs refactoring due to circular deps");

		const results = searchJournalEntries(projectId, "circular deps", 10);
		expect(results.length).toBeGreaterThanOrEqual(1);
		expect(results.some((e) => e.content.includes("circular deps"))).toBe(true);
	});

	test("returns no results for unmatched search", () => {
		const results = searchJournalEntries(projectId, "xyznonexistent123", 10);
		expect(results.length).toBe(0);
	});

	test("counts entries correctly", () => {
		const total = getJournalEntryCount(projectId);
		expect(total).toBeGreaterThan(0);

		const recentCount = getJournalEntryCount(projectId, "recent");
		const summaryCount = getJournalEntryCount(projectId, "summary");
		const historicalCount = getJournalEntryCount(projectId, "historical");
		expect(recentCount + summaryCount + historicalCount).toBe(total);
	});

	test("gets oldest recent entries in ascending order", () => {
		const oldest = getOldestRecentEntries(projectId, 2);
		expect(oldest.length).toBe(2);
		const first = oldest[0];
		const second = oldest[1];
		if (!first || !second) throw new Error("Expected 2 entries");
		expect(first.createdAt <= second.createdAt).toBe(true);
	});

	test("removes individual entries", () => {
		const entry = appendJournalEntry(projectId, "Temporary note to delete");
		const countBefore = getJournalEntryCount(projectId);

		const removed = removeJournalEntry(entry.id);
		expect(removed).toBe(true);

		const countAfter = getJournalEntryCount(projectId);
		expect(countAfter).toBe(countBefore - 1);
	});

	test("gets oldest summary entries in ascending order", () => {
		appendJournalEntry(projectId, "Summary oldest", "summary");
		appendJournalEntry(projectId, "Summary newest", "summary");

		const oldest = getOldestSummaryEntries(projectId, 2);
		expect(oldest.length).toBe(2);
		const first = oldest[0];
		const second = oldest[1];
		if (!first || !second) throw new Error("Expected 2 entries");
		expect(first.createdAt <= second.createdAt).toBe(true);
		expect(oldest.every((e) => e.tier === "summary")).toBe(true);
	});

	test("clears entries by tier", () => {
		appendJournalEntry(projectId, "Summary to clear", "summary");
		appendJournalEntry(projectId, "Another summary to clear", "summary");

		const countBefore = getJournalEntryCount(projectId, "summary");
		expect(countBefore).toBeGreaterThanOrEqual(2);

		clearJournalTier(projectId, "summary");
		const countAfter = getJournalEntryCount(projectId, "summary");
		expect(countAfter).toBe(0);
	});
});
