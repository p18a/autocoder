import { create } from "zustand";
import type { Config } from "../../shared/types.ts";

interface ConfigState {
	configs: Record<string, string>;
	setConfigs: (configs: Config[]) => void;
	setConfig: (config: Config) => void;
	removeConfigsByProject: (projectId: string) => void;
	get: (key: string) => string | undefined;
}

export const useConfigStore = create<ConfigState>((set, get) => ({
	configs: {},

	setConfigs(configs) {
		const map: Record<string, string> = {};
		for (const c of configs) {
			map[c.key] = c.value;
		}
		set({ configs: map });
	},

	setConfig(config) {
		set((state) => ({
			configs: { ...state.configs, [config.key]: config.value },
		}));
	},

	removeConfigsByProject(projectId) {
		set((state) => ({
			configs: Object.fromEntries(Object.entries(state.configs).filter(([k]) => !k.endsWith(`:${projectId}`))),
		}));
	},

	get(key) {
		return get().configs[key];
	},
}));
