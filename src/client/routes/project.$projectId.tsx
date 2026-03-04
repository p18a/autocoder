import { createRoute } from "@tanstack/react-router";
import { Dashboard } from "../components/Dashboard.tsx";
import { rootRoute } from "./__root.tsx";

export const projectRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/project/$projectId",
	component: ProjectRoute,
});

function ProjectRoute() {
	const { projectId } = projectRoute.useParams();
	return <Dashboard projectId={projectId} />;
}
