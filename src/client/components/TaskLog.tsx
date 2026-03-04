import { ScrollArea } from "@/components/ui/scroll-area";
import type { TaskLog as TaskLogType } from "../../shared/types.ts";
import { sendRequestTaskLogs } from "../stores/commands.ts";
import { useTasksStore } from "../stores/tasks.ts";
import { LogViewer } from "./LogViewer.tsx";

const EMPTY_LOGS: TaskLogType[] = [];

interface TaskLogProps {
	taskId: string;
}

export function TaskLog({ taskId }: TaskLogProps) {
	const logs = useTasksStore((s) => s.logs[taskId] ?? EMPTY_LOGS);
	const meta = useTasksStore((s) => s.logMeta[taskId]);

	if (logs.length === 0) {
		return <div className="text-xs text-muted-foreground">No logs yet</div>;
	}

	const hasMore = meta?.hasMore ?? false;

	function handleLoadMore() {
		const firstId = logs[0]?.id;
		if (firstId) {
			sendRequestTaskLogs(taskId, firstId);
		}
	}

	return (
		<ScrollArea className="h-48 rounded border border-border bg-muted p-2">
			<LogViewer logs={logs} hasMore={hasMore} onLoadMore={handleLoadMore} />
		</ScrollArea>
	);
}
