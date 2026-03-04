import { Link } from "@tanstack/react-router";
import { Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Project } from "../../shared/types.ts";
import { sendDeleteProject } from "../stores/commands.ts";
import { useProjectsStore } from "../stores/sessions.ts";
import { useTasksStore } from "../stores/tasks.ts";
import { CreateProjectDialog } from "./CreateProjectDialog.tsx";

function ProjectItem({
	project,
	isSelected,
	taskCount,
}: {
	project: Project;
	isSelected: boolean;
	taskCount: { queued: number; running: number };
}) {
	const isActive = taskCount.running > 0;
	const statusParts: string[] = [];
	if (taskCount.running > 0) statusParts.push(`${taskCount.running} running`);
	if (taskCount.queued > 0) statusParts.push(`${taskCount.queued} queued`);

	return (
		<div
			className={`group relative block rounded-md mx-2 transition-colors ${
				isSelected ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"
			}`}
		>
			<Link to="/project/$projectId" params={{ projectId: project.id }} className="block px-3 py-2">
				<div className="flex items-center gap-2">
					<span className={`text-sm truncate pr-6 flex-1 ${isSelected ? "font-medium" : ""}`}>{project.name}</span>
					{isActive && <span className="size-1.5 rounded-full bg-green-500 animate-pulse shrink-0" title="Running" />}
				</div>
				<div className="text-xs text-muted-foreground mt-0.5 truncate pr-6" title={project.path}>
					{project.path}
				</div>
				{statusParts.length > 0 && <div className="text-xs text-muted-foreground mt-0.5">{statusParts.join(", ")}</div>}
			</Link>

			<div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
				<AlertDialog>
					<AlertDialogTrigger asChild>
						<Button
							variant="ghost"
							size="icon"
							className="size-6 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
						>
							<Trash2 className="size-3.5" />
						</Button>
					</AlertDialogTrigger>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>Remove project</AlertDialogTitle>
							<AlertDialogDescription>
								Are you sure you want to remove <strong>{project.name}</strong> from the workspace? This will not delete
								any files on your disk.
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel>Cancel</AlertDialogCancel>
							<AlertDialogAction
								onClick={() => sendDeleteProject(project.id)}
								className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
							>
								Remove
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			</div>
		</div>
	);
}

interface ProjectListProps {
	selectedProjectId: string | null;
}

export function ProjectList({ selectedProjectId }: ProjectListProps) {
	const [dialogOpen, setDialogOpen] = useState(false);
	const projects = useProjectsStore((s) => s.projects);
	const tasks = useTasksStore((s) => s.tasks);

	const taskCountsByProject = useMemo(() => {
		const counts = new Map<string, { queued: number; running: number }>();
		for (const t of tasks) {
			let entry = counts.get(t.projectId);
			if (!entry) {
				entry = { queued: 0, running: 0 };
				counts.set(t.projectId, entry);
			}
			if (t.status === "queued") entry.queued++;
			else if (t.status === "running") entry.running++;
		}
		return counts;
	}, [tasks]);

	return (
		<>
			<ScrollArea className="flex-1">
				<div className="flex flex-col gap-0.5 py-2">
					{projects.length === 0 ? (
						<div className="px-4 py-3 text-sm text-muted-foreground text-center">No projects yet</div>
					) : (
						projects.map((project) => (
							<ProjectItem
								key={project.id}
								project={project}
								isSelected={project.id === selectedProjectId}
								taskCount={taskCountsByProject.get(project.id) ?? { queued: 0, running: 0 }}
							/>
						))
					)}
				</div>
			</ScrollArea>
			<div className="p-3 border-t border-border">
				<Button variant="outline" size="sm" className="w-full" onClick={() => setDialogOpen(true)}>
					<Plus className="size-4 mr-2" />
					Add project
				</Button>
			</div>
			<CreateProjectDialog open={dialogOpen} onOpenChange={setDialogOpen} />
		</>
	);
}
