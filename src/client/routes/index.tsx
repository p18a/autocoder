import { createRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Dashboard } from "../components/Dashboard.tsx";
import { LAST_PROJECT_KEY } from "../lib/last-project.ts";
import { useConnectionStore } from "../stores/connection.ts";
import { useProjectsStore } from "../stores/sessions.ts";
import { rootRoute } from "./__root.tsx";

function IndexRoute() {
	const navigate = useNavigate();
	const projects = useProjectsStore((s) => s.projects);
	const status = useConnectionStore((s) => s.status);

	const lastProjectId = localStorage.getItem(LAST_PROJECT_KEY);
	const shouldWaitForProjects = status !== "connected" && !!lastProjectId;

	useEffect(() => {
		if (!lastProjectId || projects.length === 0) return;

		if (projects.some((p) => p.id === lastProjectId)) {
			navigate({ to: "/project/$projectId", params: { projectId: lastProjectId }, replace: true });
		}
	}, [projects, navigate, lastProjectId]);

	if (shouldWaitForProjects) {
		return null;
	}

	return <Dashboard projectId={null} />;
}

export const indexRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/",
	component: IndexRoute,
});
