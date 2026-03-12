import { X } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollShadow } from "@/components/ui/scroll-shadow";
import type { Task } from "../../../shared/types.ts";
import { sendCancelTask, sendRequestTaskLogs } from "../../stores/commands.ts";
import { TaskDetailDialog } from "./TaskDetailDialog.tsx";
import { taskLabel } from "./utils.ts";

export interface QueueCardProps {
	tasks: Task[];
	activeTask: Task | undefined;
	projectId: string;
	onAddTask: (projectId: string, prompt: string) => void;
	newPrompt: string;
	onNewPromptChange: (value: string) => void;
	className?: string;
}

export function QueueCard({
	tasks,
	activeTask,
	projectId,
	onAddTask,
	newPrompt,
	onNewPromptChange,
	className,
}: QueueCardProps) {
	const [selectedTask, setSelectedTask] = useState<Task | null>(null);

	function openDetail(task: Task) {
		sendRequestTaskLogs(task.id);
		setSelectedTask(task);
	}

	function handleAdd() {
		const trimmed = newPrompt.trim();
		if (!trimmed) return;
		onAddTask(projectId, trimmed);
		onNewPromptChange("");
	}

	function handleKeyDown(e: React.KeyboardEvent) {
		if (e.key === "Enter") {
			e.preventDefault();
			handleAdd();
		}
	}

	return (
		<section className={`flex flex-col overflow-hidden h-80 lg:h-auto ${className ?? ""}`}>
			<h3 className="text-sm font-semibold pb-2 shrink-0">Queue ({tasks.length})</h3>
			<div className="flex-1 overflow-hidden flex flex-col gap-2 min-h-0">
				<ScrollShadow>
					{activeTask && (
						<div className="flex items-center gap-2 mb-2 pb-2 border-b border-border">
							<button
								type="button"
								className="text-sm truncate text-left flex-1 min-w-0 hover:underline cursor-pointer"
								onClick={() => openDetail(activeTask)}
							>
								{taskLabel(activeTask)}
							</button>
							<Badge variant="default" className="text-xs shrink-0">
								running
							</Badge>
						</div>
					)}
					{tasks.length === 0 && !activeTask ? (
						<p className="text-xs text-muted-foreground">No tasks queued</p>
					) : (
						<ul className="space-y-1">
							{tasks.map((task, i) => (
								<li key={task.id} className="flex items-center gap-2">
									<button
										type="button"
										className="text-sm truncate text-left flex-1 min-w-0 hover:underline cursor-pointer"
										onClick={() => openDetail(task)}
									>
										<span className="text-muted-foreground mr-1">{i + 1}.</span>
										{taskLabel(task)}
									</button>
									<Button
										variant="ghost"
										size="icon-sm"
										className="size-6 text-muted-foreground hover:text-destructive shrink-0"
										onClick={() => sendCancelTask(task.id)}
									>
										<X className="size-3.5" />
									</Button>
								</li>
							))}
						</ul>
					)}
				</ScrollShadow>
				{/* Inline add task */}
				<div className="flex gap-2 shrink-0">
					<Input
						placeholder="Add a task..."
						value={newPrompt}
						onChange={(e) => onNewPromptChange(e.target.value)}
						onKeyDown={handleKeyDown}
						className="h-8 text-sm"
					/>
					<Button size="sm" variant="outline" onClick={handleAdd} disabled={!newPrompt.trim()} className="shrink-0 h-8">
						Add
					</Button>
				</div>
			</div>
			<TaskDetailDialog
				task={selectedTask}
				open={selectedTask !== null}
				onOpenChange={(open) => {
					if (!open) setSelectedTask(null);
				}}
			/>
		</section>
	);
}
