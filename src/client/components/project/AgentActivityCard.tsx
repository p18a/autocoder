import { useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

	const taskId = task?.id;
	useEffect(() => {
		if (taskId) {
			sendRequestTaskLogs(taskId);
		}
	}, [taskId]);

	// Auto-scroll to bottom only when user is already near the bottom
	const logCount = logs.length;
	// biome-ignore lint/correctness/useExhaustiveDependencies: logCount triggers scroll on new logs
	useEffect(() => {
		if (scrollRef.current) {
			const el = scrollRef.current;
			const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
			if (isNearBottom) {
				el.scrollTop = el.scrollHeight;
			}
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
		<Card className={`flex flex-col overflow-hidden h-120 lg:h-full ${className ?? ""}`}>
			<CardHeader className="pb-2 shrink-0">
				<div className="flex items-center gap-2">
					<CardTitle className="text-sm">Agent activity</CardTitle>
				</div>
				{task && !discovery && <p className="text-xs text-muted-foreground truncate">{task.prompt}</p>}
			</CardHeader>
			<CardContent className="flex-1 overflow-hidden pb-3">
				<div ref={scrollRef} className="h-full overflow-y-auto rounded border border-border bg-muted p-2">
					<LogViewer logs={logs} hasMore={hasMore} onLoadMore={handleLoadMore} emptyMessage={emptyMessage} />
				</div>
			</CardContent>
		</Card>
	);
}
