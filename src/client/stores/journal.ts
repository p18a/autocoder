import { create } from "zustand";
import type { JournalEntry } from "../../shared/types.ts";

interface JournalState {
	entries: Record<string, JournalEntry[]>; // keyed by projectId
	setEntries: (projectId: string, entries: JournalEntry[]) => void;
}

export const useJournalStore = create<JournalState>((set) => ({
	entries: {},
	setEntries: (projectId, entries) =>
		set((state) => ({
			entries: { ...state.entries, [projectId]: entries },
		})),
}));
