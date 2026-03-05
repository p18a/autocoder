import { serve } from "bun";
import index from "../index.html";
import * as db from "./db/index.ts";
import { log } from "./logger.ts";
import { processQueue, recoverStaleTasks, stopProject } from "./orchestrator/index.ts";
import { type WSData, websocket } from "./ws.ts";

export const authToken = crypto.randomUUID();

const server = serve({
	port: 4000,
	// Bind to all interfaces so the UI is reachable from LAN devices
	hostname: process.env.HOST ?? "0.0.0.0",
	routes: {
		"/*": index,

		"/api/health": {
			GET() {
				return Response.json({ status: "ok", timestamp: new Date().toISOString() });
			},
		},

		"/api/token": {
			GET(req: Request) {
				const fetchSite = req.headers.get("sec-fetch-site");
				// Block only cross-site requests; allow same-origin, same-site,
				// none (user-initiated), and null (browsers that omit the header)
				if (fetchSite === "cross-site") {
					return new Response("Forbidden", { status: 403 });
				}
				return Response.json({ token: authToken });
			},
		},
	},

	websocket,

	fetch(req, server) {
		const url = new URL(req.url);
		if (url.pathname === "/ws") {
			if (url.searchParams.get("token") !== authToken) {
				log.warn("server", "WS upgrade rejected: unauthorized");
				return new Response("Unauthorized", { status: 401 });
			}
			const id = crypto.randomUUID();
			const upgraded = server.upgrade(req, { data: { id } satisfies WSData });
			if (upgraded) {
				log.info("server", `WS upgrade success: ${id}`);
				return undefined;
			}
			log.error("server", "WS upgrade failed");
			return new Response("WebSocket upgrade failed", { status: 400 });
		}
		return new Response("Not found", { status: 404 });
	},

	development: process.env.NODE_ENV !== "production" && {
		hmr: true,
		console: true,
	},
});

await recoverStaleTasks();
await processQueue();

log.info("server", `Server running at ${server.url}`);
log.info("server", "Auth token generated");

async function shutdown(signal: string) {
	log.info("server", `Received ${signal}, shutting down…`);

	const projects = db.listProjects();
	const started = projects.filter((p) => db.getProjectConfig(p.id, "started") === "true");

	for (const project of started) {
		log.info("server", `Stopping project ${project.id}…`);
		await stopProject(project.id);
	}

	log.info("server", "All projects stopped, exiting");
	process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
