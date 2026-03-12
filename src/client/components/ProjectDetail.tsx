import { useNavigate } from "@tanstack/react-router";
import { Activity, Clock, ListTodo, Settings } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
	sendAddTask,
	sendDeleteTask,
	sendRetryTask,
	sendStartProject,
	sendStopProject,
	sendUpdateConfig,
} from "../stores/commands.ts";
import { useConfigStore } from "../stores/config.ts";
import { useConnectionStore } from "../stores/connection.ts";
import { useProjectsStore } from "../stores/sessions.ts";
import { useTasksStore } from "../stores/tasks.ts";
import { AgentActivityCard } from "./project/AgentActivityCard.tsx";
import { ControlsCard } from "./project/ControlsCard.tsx";
import { HistoryCard } from "./project/HistoryCard.tsx";
import { QueueCard } from "./project/QueueCard.tsx";

interface ProjectDetailProps {
	projectId: string;
}

type MobileTab = "controls" | "queue" | "history" | "activity";

const TABS: { id: MobileTab; label: string; icon: typeof Settings }[] = [
	{ id: "controls", label: "Controls", icon: Settings },
	{ id: "queue", label: "Queue", icon: ListTodo },
	{ id: "history", label: "History", icon: Clock },
	{ id: "activity", label: "Activity", icon: Activity },
];

export function ProjectDetail({ projectId }: ProjectDetailProps) {
	const navigate = useNavigate();
	const project = useProjectsStore((s) => s.projects.find((p) => p.id === projectId));
	const projectTasks = useTasksStore(useShallow((s) => s.tasks.filter((t) => t.projectId === projectId)));

	const isStarted = useConfigStore((s) => s.configs[`started:${projectId}`] === "true");
	const autoContinue = useConfigStore((s) => s.configs[`auto_continue:${projectId}`] === "true");
	const customInstructions = useConfigStore((s) => s.configs[`custom_instructions:${projectId}`] ?? "");
	const timeoutMinutes = useConfigStore((s) => s.configs[`timeout_minutes:${projectId}`] ?? "15");
	const verifyCommand = useConfigStore((s) => s.configs[`verify_command:${projectId}`] ?? "");
	const discoveryMode = useConfigStore((s): "janitor" | "autopilot" =>
		s.configs[`discovery_mode:${projectId}`] === "autopilot" ? "autopilot" : "janitor",
	);
	const projectPurpose = useConfigStore((s) => s.configs[`project_purpose:${projectId}`] ?? "");

	const activeTask = useMemo(() => projectTasks.find((t) => t.status === "running"), [projectTasks]);
	const queuedTasks = useMemo(() => projectTasks.filter((t) => t.status === "queued"), [projectTasks]);
	const historyTasks = useMemo(
		() =>
			projectTasks
				.filter((t) => t.status === "completed" || t.status === "failed" || t.status === "cancelled")
				.reverse(),
		[projectTasks],
	);

	const hasQueuedTasks = queuedTasks.length > 0;

	const wsInitialized = useConnectionStore((s) => s.initialized);

	const [mobileTab, setMobileTab] = useState<MobileTab>("activity");
	const [newTaskPrompt, setNewTaskPrompt] = useState("");

	useEffect(() => {
		if (wsInitialized && !project) {
			navigate({ to: "/" });
		}
	}, [project, navigate, wsInitialized]);

	if (!project) {
		return null;
	}

	const controlsProps = {
		projectId,
		isStarted,
		autoContinue,
		discoveryMode,
		projectPurpose,
		customInstructions,
		timeoutMinutes,
		verifyCommand,
		startLabel: hasQueuedTasks ? "Start execution" : "Start discovery",
		onStart: () => sendStartProject(projectId, hasQueuedTasks ? "execute" : "discover"),
		onStop: () => sendStopProject(projectId),
		onToggleAutoContinue: () => sendUpdateConfig(`auto_continue:${projectId}`, autoContinue ? "false" : "true"),
		onDiscoveryModeChange: (mode: "janitor" | "autopilot") => sendUpdateConfig(`discovery_mode:${projectId}`, mode),
		onProjectPurposeChange: (value: string) => sendUpdateConfig(`project_purpose:${projectId}`, value),
		onCustomInstructionsChange: (value: string) => sendUpdateConfig(`custom_instructions:${projectId}`, value),
		onTimeoutChange: (value: string) => sendUpdateConfig(`timeout_minutes:${projectId}`, value),
		onVerifyCommandChange: (value: string) => sendUpdateConfig(`verify_command:${projectId}`, value),
	};

	const queueProps = {
		tasks: queuedTasks,
		activeTask,
		projectId,
		onAddTask: sendAddTask,
		newPrompt: newTaskPrompt,
		onNewPromptChange: setNewTaskPrompt,
	};

	const historyProps = {
		tasks: historyTasks,
		onRetry: sendRetryTask,
		onRemove: sendDeleteTask,
		onClear: () => {
			for (const t of historyTasks) sendDeleteTask(t.id);
		},
	};

	return (
		<div className="flex flex-col h-full">
			{/* Header */}
			<div className="flex items-center gap-3 p-4 border-b border-border h-16">
				<h2 className="text-sm font-medium truncate">{project.name}</h2>
				<span className="text-xs text-muted-foreground font-mono truncate">{project.path}</span>
			</div>

			{/* Desktop: grid layout — left column has 3 equal-height cards, right column spans all rows */}
			<div className="hidden lg:grid flex-1 overflow-hidden grid-cols-[2fr_3fr] grid-rows-3 gap-4 p-4">
				<ControlsCard {...controlsProps} />
				<AgentActivityCard task={activeTask} className="row-span-3" />
				<QueueCard {...queueProps} />
				<HistoryCard {...historyProps} />
			</div>

			{/* Mobile: single tab content + bottom tab bar */}
			<div className="flex-1 flex flex-col overflow-hidden lg:hidden">
				<div className="flex-1 overflow-auto p-2">
					{mobileTab === "controls" && <ControlsCard {...controlsProps} />}
					{mobileTab === "queue" && <QueueCard {...queueProps} className="h-full" />}
					{mobileTab === "history" && <HistoryCard {...historyProps} className="h-full" />}
					{mobileTab === "activity" && <AgentActivityCard task={activeTask} className="h-full" />}
				</div>

				{/* Fixed bottom tab bar */}
				<nav className="shrink-0 border-t border-border bg-background flex">
					{TABS.map(({ id, label, icon: Icon }) => (
						<button
							key={id}
							type="button"
							onClick={() => setMobileTab(id)}
							className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-xs transition-colors ${
								mobileTab === id ? "text-primary" : "text-muted-foreground"
							}`}
						>
							<Icon className="size-5" />
							{label}
						</button>
					))}
				</nav>
			</div>
		</div>
	);
}
