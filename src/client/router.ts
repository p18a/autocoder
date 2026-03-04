import { createRouter } from "@tanstack/react-router";
import { rootRoute } from "./routes/__root.tsx";
import { indexRoute } from "./routes/index.tsx";
import { logsRoute } from "./routes/logs.tsx";
import { projectRoute } from "./routes/project.$projectId.tsx";

const routeTree = rootRoute.addChildren([indexRoute, projectRoute, logsRoute]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}
