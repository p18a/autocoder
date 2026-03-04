import type { Task } from "../../../shared/types.ts";

export function taskLabel(task: Task): string {
	if (task.taskType === "discovery") return "Discovery";
	return task.title ?? task.prompt;
}
