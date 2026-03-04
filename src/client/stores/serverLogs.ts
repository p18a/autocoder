import { create } from "zustand";
import type { ServerLog } from "../../shared/types.ts";

interface ServerLogsState {
	logs: ServerLog[];
	setLogs: (logs: ServerLog[]) => void;
	appendLog: (log: ServerLog) => void;
}

const MAX_CLIENT_LOGS = 500;

export const useServerLogsStore = create<ServerLogsState>((set) => ({
	logs: [],

	setLogs(logs) {
		set({ logs });
	},

	appendLog(log) {
		set((s) => {
			const next = [log, ...s.logs];
			if (next.length > MAX_CLIENT_LOGS) {
				return { logs: next.slice(0, MAX_CLIENT_LOGS) };
			}
			return { logs: next };
		});
	},
}));
