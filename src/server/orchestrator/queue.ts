import { AUTO_CONTINUE_DELAY_MS, MAX_DISCOVERY_FAILS } from "../constants.ts";
import { log } from "../logger.ts";
import type { OrchestratorDeps } from "./deps.ts";
import {
	buildDiscoveryPrompt,
	enqueueDiscoveryIssues,
	extractDiscoveryWithClaude,
	postProcessDiscovery,
} from "./discovery.ts";
import { executeTask } from "./process.ts";

export interface QueueProcessor {
	/** Kick the queue processor. Safe to call multiple times — it won't double-run. */
	processQueue(): void;
	/** Whether the queue loop is currently running. */
	isProcessing(): boolean;
}

export function createQueueProcessor(deps: OrchestratorDeps): QueueProcessor {
	let processing = false;

	/** Per-project wakeup signals for handleAutoContinue's interruptible sleep. */
	const wakeUpByProject = new Map<string, () => void>();

	/** Check if a project is started (allowed to process tasks). */
	function isProjectStarted(projectId: string): boolean {
		return deps.db.getProjectConfig(projectId, "started") === "true";
	}

	async function handleAutoContinue(): Promise<boolean> {
		const allProjects = deps.db.listProjects();
		let seeded = false;

		for (const project of allProjects) {
			if (!isProjectStarted(project.id)) continue;

			const queued = deps.db.getQueuedTasksByProject(project.id);
			const running = deps.db.getRunningTasksByProject(project.id);
			if (queued.length > 0 || running.length > 0) continue;

			// Queue is empty for this started project
			const autoContinue = deps.db.getProjectConfig(project.id, "auto_continue");
			if (autoContinue === "true") {
				const failStreak = Number(deps.db.getProjectConfig(project.id, "discovery_fail_streak") ?? "0");
				if (failStreak >= MAX_DISCOVERY_FAILS) {
					log.warn(
						"orchestrator",
						`Auto-discovery paused for project ${project.id}: ${failStreak} consecutive failures`,
					);
					const stopConfig = deps.db.setProjectConfig(project.id, "started", "false");
					deps.broadcast({ type: "config_updated", config: stopConfig });
					continue;
				}

				log.info(
					"orchestrator",
					`Auto-continue: sleeping ${AUTO_CONTINUE_DELAY_MS / 1000}s before next discovery for ${project.id}`,
				);

				// Interruptible sleep — processQueue() can wake us up if new work arrives
				await new Promise<void>((resolve) => {
					const timer = setTimeout(resolve, AUTO_CONTINUE_DELAY_MS);
					wakeUpByProject.set(project.id, () => {
						clearTimeout(timer);
						resolve();
					});
				});
				wakeUpByProject.delete(project.id);

				// Re-check: if new queued tasks appeared (e.g., user clicked Start), skip seeding
				const existingQueued = deps.db.getQueuedTasks();
				if (existingQueued.length > 0) {
					log.info("orchestrator", "Auto-continue interrupted: queue has new tasks, skipping seed");
					return true;
				}

				if (!isProjectStarted(project.id)) continue;

				const prompt = buildDiscoveryPrompt(project.id, deps);
				const task = deps.db.createTask(project.id, prompt, "discovery");
				deps.broadcast({ type: "task_added", task });
				seeded = true;
			} else {
				// No auto-continue: queue finished, mark project as stopped
				const config = deps.db.setProjectConfig(project.id, "started", "false");
				deps.broadcast({ type: "config_updated", config });
			}
		}

		return seeded;
	}

	async function runQueue() {
		processing = true;
		log.info("orchestrator", "runQueue() started");

		try {
			while (true) {
				const queued = deps.db.getQueuedTasks();
				if (queued.length === 0) {
					log.info("orchestrator", "Queue empty, checking auto-continue…");
					if (await handleAutoContinue()) continue;
					log.info("orchestrator", "No auto-continue work, exiting queue loop");
					break;
				}

				log.info("orchestrator", `Queue has ${queued.length} task(s), looking for started project…`);

				// Find the first queued task whose project is started
				const task = queued.find((t) => isProjectStarted(t.projectId));
				if (!task) {
					log.warn("orchestrator", "No queued tasks belong to a started project — exiting queue loop");
					break;
				}

				// Atomically transition queued → running (compare-and-set)
				const running = deps.db.updateTask(task.id, "running", "queued");
				if (!running) continue;
				log.info(
					"orchestrator",
					`Task ${task.id} → running`,
					JSON.stringify({ projectId: task.projectId, taskType: task.taskType }),
				);
				deps.broadcast({ type: "task_updated", task: running });

				const discovery = task.taskType === "discovery";
				try {
					const resultText = await executeTask(task.id, task.prompt, task.projectId, deps, task.taskType);

					// Re-read task — stopProject may have already marked it cancelled
					const afterExec = deps.db.getTask(task.id);
					if (afterExec?.status === "cancelled") {
						// stopProject already handled it, nothing to do
						continue;
					}

					if (discovery) {
						const issues = resultText ? postProcessDiscovery(task.id, task.projectId, resultText, deps) : null;

						if (!resultText) {
							// No output at all — genuine failure
							const warnLog = deps.db.appendTaskLog(task.id, "Discovery produced no output", "stderr");
							deps.broadcast({ type: "task_log", log: warnLog });
							const streak = Number(deps.db.getProjectConfig(task.projectId, "discovery_fail_streak") ?? "0");
							deps.db.setProjectConfig(task.projectId, "discovery_fail_streak", String(streak + 1));
							const failed = deps.db.updateTask(task.id, "failed");
							if (failed) deps.broadcast({ type: "task_updated", task: failed });
							continue;
						}

						if (!issues) {
							// Had output but couldn't parse it — try Phase 2 extraction
							const extracted = await extractDiscoveryWithClaude(task.id, task.projectId, resultText, deps);
							if (extracted && extracted.length > 0) {
								enqueueDiscoveryIssues(task.id, task.projectId, extracted, deps);
								deps.db.setProjectConfig(task.projectId, "discovery_fail_streak", "0");
							} else {
								const warnLog = deps.db.appendTaskLog(
									task.id,
									"Failed to parse discovery output into tasks (both markdown and structured extraction failed)",
									"stderr",
								);
								deps.broadcast({ type: "task_log", log: warnLog });
								const streak = Number(deps.db.getProjectConfig(task.projectId, "discovery_fail_streak") ?? "0");
								deps.db.setProjectConfig(task.projectId, "discovery_fail_streak", String(streak + 1));
								const failed = deps.db.updateTask(task.id, "failed");
								if (failed) deps.broadcast({ type: "task_updated", task: failed });
								continue;
							}
						} else if (issues.length === 0) {
							// Parsed successfully but found zero issues — valid outcome, not a failure
							const infoLog = deps.db.appendTaskLog(task.id, "Discovery completed: no issues found", "system");
							deps.broadcast({ type: "task_log", log: infoLog });
							deps.db.setProjectConfig(task.projectId, "discovery_fail_streak", "0");
						} else {
							enqueueDiscoveryIssues(task.id, task.projectId, issues, deps);
							deps.db.setProjectConfig(task.projectId, "discovery_fail_streak", "0");
						}
					}

					const completed = deps.db.updateTask(task.id, "completed");
					if (completed) {
						log.info("orchestrator", `Task ${task.id} → completed`);
						deps.broadcast({ type: "task_updated", task: completed });
					}
				} catch (err) {
					// Re-read task — if already cancelled by stopProject, don't mark failed
					const afterExec = deps.db.getTask(task.id);
					if (afterExec?.status === "cancelled") continue;

					log.error("orchestrator", `Task ${task.id} failed: ${err instanceof Error ? err.message : String(err)}`);
					const taskLog = deps.db.appendTaskLog(task.id, String(err), "stderr");
					deps.broadcast({ type: "task_log", log: taskLog });

					if (discovery) {
						const streak = Number(deps.db.getProjectConfig(task.projectId, "discovery_fail_streak") ?? "0");
						deps.db.setProjectConfig(task.projectId, "discovery_fail_streak", String(streak + 1));
					}

					const failed = deps.db.updateTask(task.id, "failed");
					if (failed) deps.broadcast({ type: "task_updated", task: failed });
				}
			}
		} finally {
			processing = false;
			log.info("orchestrator", "runQueue() finished, processing=false");
		}
	}

	function processQueue() {
		if (processing) {
			log.warn("orchestrator", "processQueue() called but queue is already processing — waking up if sleeping");
			// Wake up all sleeping projects so they re-check the queue
			for (const wakeUp of wakeUpByProject.values()) wakeUp();
			return;
		}
		log.info("orchestrator", "processQueue() starting queue processor");
		runQueue().catch((err) => {
			log.error("orchestrator", `Queue processor error: ${err instanceof Error ? err.message : String(err)}`);
		});
	}

	return {
		processQueue,
		isProcessing: () => processing,
	};
}
