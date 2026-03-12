import { useCallback, useEffect, useRef } from "react";
import type { Task, TaskLog as TaskLogEntry } from "../../../shared/types.ts";
import { sendRequestTaskLogs } from "../../stores/commands.ts";
import { useTasksStore } from "../../stores/tasks.ts";
import { LogViewer } from "../LogViewer.tsx";

const EMPTY_LOGS: TaskLogEntry[] = [];

export interface AgentActivityCardProps {
	task: Task | undefined;
	className?: string;
}

export function AgentActivityCard({ task, className }: AgentActivityCardProps) {
	const logs = useTasksStore((s) => (task ? (s.logs[task.id] ?? EMPTY_LOGS) : EMPTY_LOGS));
	const meta = useTasksStore((s) => (task ? s.logMeta[task.id] : undefined));
	const scrollRef = useRef<HTMLDivElement>(null);
	const isNearBottomRef = useRef(true);

	const taskId = task?.id;
	useEffect(() => {
		if (taskId) {
			sendRequestTaskLogs(taskId);
		}
	}, [taskId]);

	const handleScroll = useCallback(() => {
		if (scrollRef.current) {
			const el = scrollRef.current;
			isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
		}
	}, []);

	// Auto-scroll to bottom only when user was already near the bottom
	const logCount = logs.length;
	// biome-ignore lint/correctness/useExhaustiveDependencies: logCount triggers scroll on new logs
	useEffect(() => {
		if (scrollRef.current && isNearBottomRef.current) {
			scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
		}
	}, [logCount]);

	const discovery = task ? task.taskType === "discovery" : false;
	const hasMore = meta?.hasMore ?? false;

	function handleLoadMore() {
		if (!taskId) return;
		const firstId = logs[0]?.id;
		if (firstId) {
			sendRequestTaskLogs(taskId, firstId);
		}
	}

	const emptyMessage = !task
		? "Agent idle — press Start"
		: !discovery && logs.length === 0
			? "Waiting for output..."
			: undefined;

	return (
		<section className={`flex flex-col overflow-hidden h-120 lg:h-full ${className ?? ""}`}>
			<div className="pb-2 shrink-0">
				<h3 className="text-sm font-semibold">Agent activity</h3>
				{task && !discovery && <p className="text-xs text-muted-foreground truncate">{task.prompt}</p>}
			</div>
			<div
				ref={scrollRef}
				onScroll={handleScroll}
				className="flex-1 min-h-0 overflow-y-auto rounded border border-border/50 bg-muted/30 p-2"
			>
				<LogViewer logs={logs} hasMore={hasMore} onLoadMore={handleLoadMore} emptyMessage={emptyMessage} />
			</div>
		</section>
	);
}
