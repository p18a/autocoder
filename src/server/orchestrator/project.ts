import type { Task } from "../../shared/types.ts";
import { log } from "../logger.ts";
import type { OrchestratorDeps } from "./deps.ts";
import { buildAutopilotPrompt, buildDiscoveryPrompt } from "./discovery.ts";
import { activeProcesses } from "./process.ts";

/** Check if a project is started (allowed to process tasks). */
export function isProjectStarted(projectId: string, deps: OrchestratorDeps): boolean {
	return deps.db.getProjectConfig(projectId, "started") === "true";
}

/**
 * Recover from unclean shutdown: fail any "running" tasks (no process owns them)
 * and reset "started" for projects that have no remaining queued/running work.
 */
export function recoverStaleTasks(deps: OrchestratorDeps) {
	const allTasks = deps.db.listTasks();
	const staleRunning = allTasks.filter((t) => t.status === "running");

	for (const task of staleRunning) {
		log.warn("orchestrator", `Recovering stale running task ${task.id} → failed`);
		const taskLog = deps.db.appendTaskLog(task.id, "Task was still running when server restarted", "stderr");
		deps.broadcast({ type: "task_log", log: taskLog });
		const failed = deps.db.updateTask(task.id, "failed");
		if (failed) deps.broadcast({ type: "task_updated", task: failed });
	}

	// Reset "started" for ALL projects with no remaining queued work
	// (not just those with tasks — a project with started=true but no tasks
	// would otherwise block the queue via handleAutoContinue's sleep)
	const allProjects = deps.db.listProjects();
	for (const project of allProjects) {
		if (!isProjectStarted(project.id, deps)) continue;
		const queued = deps.db.getQueuedTasksByProject(project.id);
		if (queued.length === 0) {
			const autoContinue = deps.db.getProjectConfig(project.id, "auto_continue");
			if (autoContinue !== "true") {
				log.info("orchestrator", `Recovery: stopping project ${project.id} (no queued work, auto-continue off)`);
				const config = deps.db.setProjectConfig(project.id, "started", "false");
				deps.broadcast({ type: "config_updated", config });
			} else {
				log.info("orchestrator", `Recovery: project ${project.id} has auto-continue, keeping started`);
			}
		}
	}
}

/**
 * Start a project: set the started flag and kick the queue.
 * In "discover" mode, seeds a discovery task if no queued tasks exist.
 * In "execute" mode, just starts processing existing queued tasks.
 * Idempotent: double-clicking won't create duplicate discovery tasks.
 */
export function startProject(
	projectId: string,
	mode: "discover" | "execute",
	deps: OrchestratorDeps,
	processQueue: () => void,
) {
	log.info("orchestrator", `Starting project ${projectId} in ${mode} mode`);
	const config = deps.db.setProjectConfig(projectId, "started", "true");
	deps.broadcast({ type: "config_updated", config });

	// Reset circuit breaker so user can retry after failures
	deps.db.setProjectConfig(projectId, "discovery_fail_streak", "0");

	if (mode === "discover") {
		// Only create discovery task if no queued or running tasks exist (idempotent)
		const queued = deps.db.getQueuedTasksByProject(projectId);
		const running = deps.db.getRunningTasksByProject(projectId);
		if (queued.length === 0 && running.length === 0) {
			const mode = deps.db.getProjectConfig(projectId, "discovery_mode");
			const prompt =
				mode === "autopilot" ? buildAutopilotPrompt(projectId, deps) : buildDiscoveryPrompt(projectId, deps);
			const task = deps.db.createTask(projectId, prompt, "discovery");
			log.info("orchestrator", `Created discovery task ${task.id} for project ${projectId}`);
			deps.broadcast({ type: "task_added", task });
		} else {
			log.info("orchestrator", `Skipped discovery task creation: ${queued.length} queued, ${running.length} running`);
		}
	}

	log.info("orchestrator", "Calling processQueue() from startProject");
	processQueue();
}

/**
 * Stop all activity for a project: clear started flag, kill running process,
 * cancel running tasks, remove queued tasks.
 * Returns early if project doesn't exist.
 */
export function stopProject(projectId: string, deps: OrchestratorDeps): { cancelled: Task[]; removed: string[] } {
	const cancelled: Task[] = [];
	const removed: string[] = [];

	if (!deps.db.getProject(projectId)) {
		return { cancelled, removed };
	}

	log.info("orchestrator", `Stopping project ${projectId}`);

	// Clear started flag
	const config = deps.db.setProjectConfig(projectId, "started", "false");
	deps.broadcast({ type: "config_updated", config });

	// Kill the running Claude process if any
	const proc = activeProcesses.get(projectId);
	if (proc) {
		proc.kill();
		activeProcesses.delete(projectId);
	}

	// Cancel running tasks
	const running = deps.db.getRunningTasksByProject(projectId);
	for (const task of running) {
		const updated = deps.db.updateTask(task.id, "cancelled");
		if (updated) {
			cancelled.push(updated);
			deps.broadcast({ type: "task_updated", task: updated });
		}
	}

	// Keep queued tasks — they'll resume when the project is restarted

	return { cancelled, removed };
}

/**
 * Cancel a single task. If the task is currently running, kill its subprocess.
 * For queued tasks, just flips status to cancelled.
 */
export function cancelTask(taskId: string, deps: OrchestratorDeps) {
	const task = deps.db.getTask(taskId);
	if (!task) return;

	// Only queued or running tasks can be cancelled
	if (task.status !== "queued" && task.status !== "running") return;

	if (task.status === "running") {
		// Kill the running process for this project — the queue loop will
		// see the task was cancelled and skip marking it failed/completed.
		const proc = activeProcesses.get(task.projectId);
		if (proc) {
			proc.kill();
			activeProcesses.delete(task.projectId);
		}
	}

	const updated = deps.db.updateTask(taskId, "cancelled");
	if (updated) deps.broadcast({ type: "task_updated", task: updated });
}
