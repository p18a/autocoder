import { AUTO_CONTINUE_DELAY_MS, MAX_DISCOVERY_FAILS } from "../constants.ts";
import { gitAutoCommit, gitHasChanges, gitRevertToCheckpoint, gitSaveCheckpoint } from "../git.ts";
import { log } from "../logger.ts";
import type { OrchestratorDeps } from "./deps.ts";
import { buildAutopilotPrompt, buildDiscoveryPrompt, countTasksFromDiscovery } from "./discovery.ts";
import { compressJournalIfNeeded } from "./journal.ts";
import { executeTask, parseCommitSummary, runVerifyCommand } from "./process.ts";

export interface QueueProcessor {
	/** Kick the queue processor. Safe to call multiple times — it won't double-run. */
	processQueue(): void;
	/** Whether the queue loop is currently running. */
	isProcessing(): boolean;
}

/** Auto-commit changes after a successful execution task. */
async function autoCommitTask(
	projectPath: string,
	resultText: string | undefined,
	taskPrompt: string,
	taskId: string,
	deps: OrchestratorDeps,
): Promise<void> {
	try {
		const message = await parseCommitSummary(resultText ?? "", taskPrompt);
		const sha = await gitAutoCommit(projectPath, message);
		if (sha) {
			const commitLog = deps.db.appendTaskLog(taskId, `Auto-committed: ${sha.slice(0, 8)} — ${message}`, "system");
			deps.broadcast({ type: "task_log", log: commitLog });
		}
	} catch (err) {
		log.warn(
			"orchestrator",
			`Auto-commit failed for task ${taskId}: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
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

				const mode = deps.db.getProjectConfig(project.id, "discovery_mode");
				const prompt =
					mode === "autopilot" ? buildAutopilotPrompt(project.id, deps) : buildDiscoveryPrompt(project.id, deps);
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

				// Read per-project config
				const timeoutConfig = deps.db.getProjectConfig(task.projectId, "timeout_minutes");
				const timeoutMinutes = Number(timeoutConfig ?? "15");
				const timeoutMs = timeoutMinutes > 0 ? timeoutMinutes * 60 * 1000 : 0;
				const verifyCommand = discovery ? "" : (deps.db.getProjectConfig(task.projectId, "verify_command") ?? "");
				const project = deps.db.getProject(task.projectId);

				try {
					// Refuse to start if the project repo has uncommitted or untracked changes
					if (project) {
						try {
							const dirty = await gitHasChanges(project.path);
							if (dirty) {
								const dirtyMsg =
									"Refusing to start task: repository has uncommitted or untracked changes. Please commit or stash your changes first.";
								log.warn("orchestrator", `${dirtyMsg} (project=${task.projectId})`);
								const dirtyLog = deps.db.appendTaskLog(task.id, dirtyMsg, "stderr");
								deps.broadcast({ type: "task_log", log: dirtyLog });
								const failed = deps.db.updateTask(task.id, "failed");
								if (failed) deps.broadcast({ type: "task_updated", task: failed });
								continue;
							}
						} catch (err) {
							log.warn(
								"orchestrator",
								`Could not check git status for ${task.projectId}: ${err instanceof Error ? err.message : String(err)}`,
							);
						}
					}

					// Save checkpoint before execution tasks
					let checkpoint: string | null = null;
					if (!discovery && project) {
						try {
							checkpoint = await gitSaveCheckpoint(project.path);
						} catch (err) {
							log.warn(
								"orchestrator",
								`Could not save git checkpoint for ${task.projectId}: ${err instanceof Error ? err.message : String(err)}`,
							);
						}
					}

					// For discovery tasks, the prompt contains {{TASK_ID}} placeholders
					// that need to be interpolated now that we have the task ID.
					const effectivePrompt = discovery ? task.prompt.replaceAll("{{TASK_ID}}", task.id) : task.prompt;

					const resultText = await executeTask(
						task.id,
						effectivePrompt,
						task.projectId,
						deps,
						task.taskType,
						timeoutMs,
						verifyCommand || undefined,
					);

					// Re-read task — stopProject may have already marked it cancelled
					const afterExec = deps.db.getTask(task.id);
					if (afterExec?.status === "cancelled") {
						// stopProject already handled it, nothing to do
						continue;
					}

					if (discovery) {
						// Discovery agents create tasks via the add_task MCP tool during execution.
						// Count how many tasks were created by this discovery cycle.
						const createdCount = countTasksFromDiscovery(task.id, task.projectId, deps);

						if (!resultText) {
							// No output at all — genuine failure (process likely crashed)
							const warnLog = deps.db.appendTaskLog(task.id, "Discovery produced no output", "stderr");
							deps.broadcast({ type: "task_log", log: warnLog });
							const streak = Number(deps.db.getProjectConfig(task.projectId, "discovery_fail_streak") ?? "0");
							deps.db.setProjectConfig(task.projectId, "discovery_fail_streak", String(streak + 1));
							const failed = deps.db.updateTask(task.id, "failed");
							if (failed) deps.broadcast({ type: "task_updated", task: failed });
							continue;
						}

						if (createdCount > 0) {
							const infoLog = deps.db.appendTaskLog(
								task.id,
								`Discovery completed: ${createdCount} task(s) created via MCP`,
								"system",
							);
							deps.broadcast({ type: "task_log", log: infoLog });
							deps.db.setProjectConfig(task.projectId, "discovery_fail_streak", "0");
						} else {
							// Agent finished but created no tasks — could be legitimate (no issues found)
							// or a failure (MCP connection issue, agent didn't use the tool).
							// Increment fail streak so the circuit breaker trips if this keeps happening.
							const streak = Number(deps.db.getProjectConfig(task.projectId, "discovery_fail_streak") ?? "0");
							deps.db.setProjectConfig(task.projectId, "discovery_fail_streak", String(streak + 1));
							const infoLog = deps.db.appendTaskLog(
								task.id,
								`Discovery completed but created no tasks (streak: ${streak + 1}/${MAX_DISCOVERY_FAILS})`,
								"system",
							);
							deps.broadcast({ type: "task_log", log: infoLog });
						}
					} else if (verifyCommand && project) {
						// Execution task with verify command
						const verifyResult = await runVerifyCommand(project.path, verifyCommand, task.id, deps);

						if (verifyResult.success) {
							// Verify passed — auto-commit
							await autoCommitTask(project.path, resultText, task.prompt, task.id, deps);
						} else {
							// Verify failed — retry once
							const retryLog = deps.db.appendTaskLog(task.id, "Verification failed, asking Claude to fix…", "system");
							deps.broadcast({ type: "task_log", log: retryLog });

							const fixPrompt = `The previous changes failed verification. Fix the issues and try again.

Verification command: ${verifyCommand}
Verification output:
${verifyResult.output}

Original task: ${task.prompt}`;

							await executeTask(task.id, fixPrompt, task.projectId, deps, "execution", timeoutMs);

							// Re-check cancellation after retry
							const afterRetry = deps.db.getTask(task.id);
							if (afterRetry?.status === "cancelled") continue;

							const retryVerify = await runVerifyCommand(project.path, verifyCommand, task.id, deps);

							if (retryVerify.success) {
								await autoCommitTask(project.path, resultText, task.prompt, task.id, deps);
							} else {
								// Retry also failed — revert to checkpoint
								if (checkpoint) {
									const revertLog = deps.db.appendTaskLog(
										task.id,
										"Verification failed after retry — reverting changes",
										"stderr",
									);
									deps.broadcast({ type: "task_log", log: revertLog });
									try {
										await gitRevertToCheckpoint(project.path, checkpoint);
									} catch (err) {
										log.error("orchestrator", `Failed to revert: ${err instanceof Error ? err.message : String(err)}`);
									}
								}
								const failed = deps.db.updateTask(task.id, "failed");
								if (failed) {
									log.info("orchestrator", `Task ${task.id} → failed (verification failed after retry)`);
									deps.broadcast({ type: "task_updated", task: failed });
								}
								continue;
							}
						}
					} else if (!discovery && project) {
						// Execution task without verify command — just auto-commit
						await autoCommitTask(project.path, resultText, task.prompt, task.id, deps);
					}

					// Re-read task — it may have been cancelled/failed externally
					const beforeComplete = deps.db.getTask(task.id);
					if (beforeComplete?.status !== "running") {
						log.info(
							"orchestrator",
							`Task ${task.id} already ${beforeComplete?.status ?? "gone"}, skipping completion`,
						);
						continue;
					}

					const completed = deps.db.updateTask(task.id, "completed");
					if (completed) {
						log.info("orchestrator", `Task ${task.id} → completed`);
						deps.broadcast({ type: "task_updated", task: completed });
						// Compress journal in the background — don't block the queue
						compressJournalIfNeeded(task.projectId).catch((err) => {
							log.warn(
								"orchestrator",
								`Journal compression error: ${err instanceof Error ? err.message : String(err)}`,
							);
						});
					}
				} catch (err) {
					// Re-read task — if already cancelled/failed externally, don't mark failed
					const afterExec = deps.db.getTask(task.id);
					if (afterExec?.status !== "running") continue;

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
