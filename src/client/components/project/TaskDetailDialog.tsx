import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useEffect, useRef } from "react";
import type { Task, TaskLog as TaskLogType, TaskStatus } from "../../../shared/types.ts";
import { sendRequestTaskLogs } from "../../stores/commands.ts";
import { useTasksStore } from "../../stores/tasks.ts";
import { LogViewer } from "../LogViewer.tsx";
import { taskLabel } from "./utils.ts";

const statusVariant: Record<TaskStatus, "default" | "secondary" | "destructive" | "outline"> = {
	queued: "outline",
	running: "default",
	completed: "secondary",
	failed: "destructive",
	cancelled: "outline",
};

const EMPTY_LOGS: TaskLogType[] = [];

interface TaskDetailDialogProps {
	task: Task | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function TaskDetailDialog({ task, open, onOpenChange }: TaskDetailDialogProps) {
	const logs = useTasksStore((s) => (task ? (s.logs[task.id] ?? EMPTY_LOGS) : EMPTY_LOGS));
	const meta = useTasksStore((s) => (task ? s.logMeta[task.id] : undefined));

	const scrollRef = useRef<HTMLDivElement>(null);
	const hasScrolledRef = useRef(false);

	// Reset scroll flag when dialog opens
	useEffect(() => {
		if (open) {
			hasScrolledRef.current = false;
		}
	}, [open]);

	// Scroll to bottom once logs are loaded after opening
	useEffect(() => {
		if (open && logs.length > 0 && !hasScrolledRef.current) {
			hasScrolledRef.current = true;
			requestAnimationFrame(() => {
				const viewport = scrollRef.current?.querySelector("[data-slot='scroll-area-viewport']");
				if (viewport) {
					viewport.scrollTop = viewport.scrollHeight;
				}
			});
		}
	}, [open, logs.length]);

	if (!task) return null;

	const hasMore = meta?.hasMore ?? false;

	function handleLoadMore() {
		if (!task) return;
		const firstId = logs[0]?.id;
		if (firstId) {
			sendRequestTaskLogs(task.id, firstId);
		}
	}

	const createdAt = new Date(task.createdAt).toLocaleString();
	const updatedAt = new Date(task.updatedAt).toLocaleString();

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="flex flex-col max-sm:h-dvh max-sm:max-w-full max-sm:rounded-none max-sm:border-0 sm:max-w-2xl sm:max-h-[80vh]">
				<DialogHeader className="shrink-0 pr-8">
					<div className="flex items-center gap-2">
						<DialogTitle className="truncate">{taskLabel(task)}</DialogTitle>
						<Badge variant={statusVariant[task.status]} className="text-xs shrink-0">
							{task.status}
						</Badge>
					</div>
					<DialogDescription className="text-left">
						<span className="text-xs">
							{task.taskType === "discovery" ? "Discovery" : "Execution"}
							{" \u00b7 "}
							Created {createdAt}
							{task.updatedAt !== task.createdAt && (
								<>
									{" \u00b7 "}
									Updated {updatedAt}
								</>
							)}
						</span>
					</DialogDescription>
				</DialogHeader>

				{task.prompt && task.taskType !== "discovery" && (
					<div className="shrink-0 rounded border border-border bg-muted p-3">
						<p className="text-xs font-medium text-muted-foreground mb-1">Prompt</p>
						<p className="text-sm whitespace-pre-wrap">{task.prompt}</p>
					</div>
				)}

				<ScrollArea ref={scrollRef} className="flex-1 min-h-0 rounded border border-border bg-muted p-2">
					{logs.length === 0 ? (
						<p className="text-xs text-muted-foreground">No logs yet</p>
					) : (
						<LogViewer logs={logs} hasMore={hasMore} onLoadMore={handleLoadMore} />
					)}
				</ScrollArea>
			</DialogContent>
		</Dialog>
	);
}
