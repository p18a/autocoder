import { create } from "zustand";
import type { Project } from "../../shared/types.ts";

interface ProjectsState {
	projects: Project[];
	setProjects: (projects: Project[]) => void;
	upsertProject: (project: Project) => void;
	removeProject: (projectId: string) => void;
}

export const useProjectsStore = create<ProjectsState>((set) => ({
	projects: [],

	setProjects(projects) {
		set({ projects });
	},

	upsertProject(project) {
		set((state) => {
			const idx = state.projects.findIndex((p) => p.id === project.id);
			if (idx >= 0) {
				const updated = [...state.projects];
				updated[idx] = project;
				return { projects: updated };
			}
			return { projects: [project, ...state.projects] };
		});
	},

	removeProject(projectId) {
		set((state) => ({
			projects: state.projects.filter((p) => p.id !== projectId),
		}));
	},
}));
