import { create } from "zustand";

type Theme = "dark" | "light";

const STORAGE_KEY = "autocoder-theme";

function getInitialTheme(): Theme {
	const stored = localStorage.getItem(STORAGE_KEY);
	if (stored === "light" || stored === "dark") return stored;
	return "dark";
}

interface ThemeState {
	theme: Theme;
	toggle: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
	theme: getInitialTheme(),
	toggle() {
		const next = get().theme === "dark" ? "light" : "dark";
		localStorage.setItem(STORAGE_KEY, next);
		set({ theme: next });
	},
}));
