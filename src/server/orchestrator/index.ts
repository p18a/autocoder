import { createDefaultDeps } from "./deps.ts";
import {
	cancelTask as cancelTaskImpl,
	isProjectStarted as isProjectStartedImpl,
	recoverStaleTasks as recoverStaleTasksImpl,
	startProject as startProjectImpl,
	stopProject as stopProjectImpl,
} from "./project.ts";
import { createQueueProcessor } from "./queue.ts";

export type { OrchestratorDeps } from "./deps.ts";
export type { QueueProcessor } from "./queue.ts";
export { createQueueProcessor } from "./queue.ts";

// Lazily initialised default deps — avoids import-time side effects from db/ws
let _defaultDepsPromise: Promise<Awaited<ReturnType<typeof createDefaultDeps>>> | null = null;
function defaultDeps() {
	if (!_defaultDepsPromise) _defaultDepsPromise = createDefaultDeps();
	return _defaultDepsPromise;
}

let _queueProcessorPromise: Promise<ReturnType<typeof createQueueProcessor>> | null = null;
function defaultQueueProcessor() {
	if (!_queueProcessorPromise) _queueProcessorPromise = defaultDeps().then((deps) => createQueueProcessor(deps));
	return _queueProcessorPromise;
}

// Pre-bound convenience exports that use the real db + broadcast.
// Handlers call these directly so they don't need to know about deps.
// Tests import the raw functions from project.ts / queue.ts and inject their own deps.

export async function isProjectStarted(projectId: string) {
	return isProjectStartedImpl(projectId, await defaultDeps());
}

export async function recoverStaleTasks() {
	return recoverStaleTasksImpl(await defaultDeps());
}

export async function startProject(projectId: string, mode: "discover" | "execute") {
	const [deps, qp] = await Promise.all([defaultDeps(), defaultQueueProcessor()]);
	return startProjectImpl(projectId, mode, deps, qp.processQueue);
}

export async function stopProject(projectId: string) {
	return stopProjectImpl(projectId, await defaultDeps());
}

export async function cancelTask(taskId: string) {
	return cancelTaskImpl(taskId, await defaultDeps());
}

export async function processQueue() {
	return (await defaultQueueProcessor()).processQueue();
}
