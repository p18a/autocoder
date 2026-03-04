import type { TaskStatus } from "./types.ts";

export const TASK_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
	queued: ["running", "cancelled"],
	running: ["completed", "failed", "cancelled"],
	completed: [],
	failed: [],
	cancelled: [],
};

export class IllegalTransitionError extends Error {
	constructor(from: TaskStatus, to: TaskStatus) {
		super(`Illegal task transition from ${from} to ${to}`);
		this.name = "IllegalTransitionError";
	}
}

export function isValidTransition(from: TaskStatus, to: TaskStatus): boolean {
	return TASK_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: TaskStatus, to: TaskStatus): void {
	if (!isValidTransition(from, to)) {
		throw new IllegalTransitionError(from, to);
	}
}

const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set(["completed", "failed", "cancelled"]);

export function isTerminalStatus(status: TaskStatus): boolean {
	return TERMINAL_STATUSES.has(status);
}
