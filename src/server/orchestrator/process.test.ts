import { describe, expect, test } from "bun:test";
import { buildExecutionPrompt } from "./process.ts";

describe("buildExecutionPrompt", () => {
	test("wraps task prompt with autonomous execution context", () => {
		const result = buildExecutionPrompt("Fix the null check in user.ts");
		expect(result).toContain("autonomous coding agent");
		expect(result).toContain("Fix the null check in user.ts");
	});

	test("includes guidance about minimal changes and verification", () => {
		const result = buildExecutionPrompt("Add error handling");
		expect(result).toContain("minimal, focused changes");
		expect(result).toContain("verify");
	});

	test("ends preamble with the task prompt", () => {
		const prompt = "Refactor the database module";
		const result = buildExecutionPrompt(prompt);
		expect(result.endsWith(prompt)).toBe(true);
	});
});
