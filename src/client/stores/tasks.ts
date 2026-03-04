import { create } from "zustand";
import type { Task, TaskLog } from "../../shared/types.ts";

interface TasksState {
	tasks: Task[];
	logs: Record<string, TaskLog[]>;
	logMeta: Record<string, { total: number; hasMore: boolean }>;
	setTasks: (tasks: Task[]) => void;
	upsertTask: (task: Task) => void;
	removeTask: (taskId: string) => void;
	removeTasksByProject: (projectId: string) => void;
	appendLog: (log: TaskLog) => void;
	setLogs: (taskId: string, logs: TaskLog[], total: number, hasMore: boolean) => void;
	prependLogs: (taskId: string, logs: TaskLog[], total: number, hasMore: boolean) => void;
}

export const useTasksStore = create<TasksState>((set) => ({
	tasks: [],
	logs: {},
	logMeta: {},

	setTasks(tasks) {
		set({ tasks });
	},

	upsertTask(task) {
		set((state) => {
			const idx = state.tasks.findIndex((t) => t.id === task.id);
			if (idx >= 0) {
				const updated = [...state.tasks];
				updated[idx] = task;
				return { tasks: updated };
			}
			return { tasks: [...state.tasks, task] };
		});
	},

	removeTask(taskId) {
		set((state) => ({
			tasks: state.tasks.filter((t) => t.id !== taskId),
			logs: Object.fromEntries(Object.entries(state.logs).filter(([k]) => k !== taskId)),
			logMeta: Object.fromEntries(Object.entries(state.logMeta).filter(([k]) => k !== taskId)),
		}));
	},

	removeTasksByProject(projectId) {
		set((state) => {
			const removedIds = new Set(state.tasks.filter((t) => t.projectId === projectId).map((t) => t.id));
			return {
				tasks: state.tasks.filter((t) => t.projectId !== projectId),
				logs: Object.fromEntries(Object.entries(state.logs).filter(([k]) => !removedIds.has(k))),
				logMeta: Object.fromEntries(Object.entries(state.logMeta).filter(([k]) => !removedIds.has(k))),
			};
		});
	},

	appendLog(log) {
		set((state) => {
			const MAX_TASK_LOGS = 2000;
			const existing = state.logs[log.taskId] ?? [];
			const updated = [...existing, log];
			return {
				logs: {
					...state.logs,
					[log.taskId]: updated.length > MAX_TASK_LOGS ? updated.slice(-MAX_TASK_LOGS) : updated,
				},
			};
		});
	},

	setLogs(taskId, logs, total, hasMore) {
		set((state) => ({
			logs: { ...state.logs, [taskId]: logs },
			logMeta: { ...state.logMeta, [taskId]: { total, hasMore } },
		}));
	},

	prependLogs(taskId, olderLogs, total, hasMore) {
		set((state) => {
			const existing = state.logs[taskId] ?? [];
			return {
				logs: { ...state.logs, [taskId]: [...olderLogs, ...existing] },
				logMeta: { ...state.logMeta, [taskId]: { total, hasMore } },
			};
		});
	},
}));
