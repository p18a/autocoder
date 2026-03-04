import { createRoute } from "@tanstack/react-router";
import { Dashboard } from "../components/Dashboard.tsx";
import { ServerLogsPage } from "../components/ServerLogsPage.tsx";
import { rootRoute } from "./__root.tsx";

function LogsRoute() {
	return (
		<Dashboard projectId={null}>
			<ServerLogsPage />
		</Dashboard>
	);
}

export const logsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/logs",
	component: LogsRoute,
});
