import { describe, expect, test } from "bun:test";
import { assertTransition, IllegalTransitionError, isTerminalStatus, isValidTransition } from "./fsm.ts";

describe("Task FSM", () => {
	test("valid transitions", () => {
		expect(isValidTransition("queued", "running")).toBe(true);
		expect(isValidTransition("queued", "cancelled")).toBe(true);
		expect(isValidTransition("running", "completed")).toBe(true);
		expect(isValidTransition("running", "failed")).toBe(true);
		expect(isValidTransition("running", "cancelled")).toBe(true);
	});

	test("invalid transitions", () => {
		expect(isValidTransition("queued", "completed")).toBe(false);
		expect(isValidTransition("queued", "failed")).toBe(false);
		expect(isValidTransition("completed", "running")).toBe(false);
		expect(isValidTransition("failed", "queued")).toBe(false);
		expect(isValidTransition("cancelled", "running")).toBe(false);
	});

	test("terminal states", () => {
		expect(isValidTransition("completed", "cancelled")).toBe(false);
		expect(isValidTransition("failed", "cancelled")).toBe(false);
		expect(isValidTransition("cancelled", "queued")).toBe(false);
	});

	test("assertTransition throws on invalid", () => {
		expect(() => assertTransition("queued", "completed")).toThrow(IllegalTransitionError);
	});

	test("assertTransition passes on valid", () => {
		expect(() => assertTransition("queued", "running")).not.toThrow();
	});

	test("isTerminalStatus", () => {
		expect(isTerminalStatus("completed")).toBe(true);
		expect(isTerminalStatus("failed")).toBe(true);
		expect(isTerminalStatus("cancelled")).toBe(true);
		expect(isTerminalStatus("queued")).toBe(false);
		expect(isTerminalStatus("running")).toBe(false);
	});
});
