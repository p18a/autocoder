import { RotateCw, X } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Task, TaskStatus } from "../../../shared/types.ts";
import { sendRequestTaskLogs } from "../../stores/commands.ts";
import { TaskDetailDialog } from "./TaskDetailDialog.tsx";
import { taskLabel } from "./utils.ts";

const statusVariant: Record<TaskStatus, "default" | "secondary" | "destructive" | "outline"> = {
	queued: "outline",
	running: "default",
	completed: "secondary",
	failed: "destructive",
	cancelled: "outline",
};

export interface HistoryCardProps {
	tasks: Task[];
	onRetry: (taskId: string) => void;
	onRemove: (taskId: string) => void;
	onClear: () => void;
	className?: string;
}

export function HistoryCard({ tasks, onRetry, onRemove, onClear, className }: HistoryCardProps) {
	const [selectedTask, setSelectedTask] = useState<Task | null>(null);

	function openDetail(task: Task) {
		sendRequestTaskLogs(task.id);
		setSelectedTask(task);
	}

	return (
		<Card
			className={`flex flex-col overflow-hidden h-80 shrink-0 lg:shrink lg:h-auto lg:flex-[1_1_60%] ${className ?? ""}`}
		>
			<CardHeader className="pb-2 shrink-0">
				<div className="flex items-center justify-between">
					<CardTitle className="text-sm">History</CardTitle>
					{tasks.length > 0 && (
						<Button variant="ghost" size="sm" className="h-6 text-xs text-muted-foreground" onClick={onClear}>
							Clear all
						</Button>
					)}
				</div>
			</CardHeader>
			<CardContent className="flex-1 overflow-hidden pb-3">
				<ScrollArea className="h-full">
					{tasks.length === 0 ? (
						<p className="text-xs text-muted-foreground">No completed tasks yet</p>
					) : (
						<ul className="space-y-2">
							{tasks.map((task) => (
								<li key={task.id}>
									<div className="flex items-center gap-2">
										<button
											type="button"
											className="text-sm truncate text-left flex-1 min-w-0 hover:underline cursor-pointer"
											onClick={() => openDetail(task)}
										>
											{task.status === "completed" ? "\u2713" : "\u2717"} {taskLabel(task)}
										</button>
										<div className="flex items-center gap-2 shrink-0">
											<Badge variant={statusVariant[task.status]} className="text-xs">
												{task.status}
											</Badge>
											{(task.status === "failed" || task.status === "cancelled") && (
												<Button
													variant="ghost"
													size="icon-sm"
													className="size-6 text-muted-foreground hover:text-foreground"
													onClick={() => onRetry(task.id)}
													title="Retry task"
												>
													<RotateCw className="size-3.5" />
												</Button>
											)}
											<Button
												variant="ghost"
												size="icon-sm"
												className="size-6 text-muted-foreground hover:text-destructive"
												onClick={() => onRemove(task.id)}
											>
												<X className="size-3.5" />
											</Button>
										</div>
									</div>
								</li>
							))}
						</ul>
					)}
				</ScrollArea>
			</CardContent>
			<TaskDetailDialog
				task={selectedTask}
				open={selectedTask !== null}
				onOpenChange={(open) => {
					if (!open) setSelectedTask(null);
				}}
			/>
		</Card>
	);
}
