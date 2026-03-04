import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { LogLevel, ServerLog } from "../../shared/types.ts";
import { sendRequestServerLogs } from "../stores/commands.ts";
import { useConnectionStore } from "../stores/connection.ts";
import { useServerLogsStore } from "../stores/serverLogs.ts";
import { useThemeStore } from "../stores/theme.ts";

const LEVEL_FILTERS: Array<{ label: string; value: LogLevel | "all" }> = [
	{ label: "All", value: "all" },
	{ label: "Error", value: "error" },
	{ label: "Warn", value: "warn" },
	{ label: "Info", value: "info" },
	{ label: "Debug", value: "debug" },
];

const levelColor: Record<LogLevel, string> = {
	error: "text-destructive",
	warn: "text-amber-400",
	info: "text-sky-400",
	debug: "text-muted-foreground",
};

function formatTime(iso: string): string {
	const d = new Date(iso);
	return d.toLocaleTimeString(undefined, {
		hour12: false,
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});
}

export function ServerLogsPage() {
	const logs = useServerLogsStore((s) => s.logs);
	const initialized = useConnectionStore((s) => s.initialized);
	const theme = useThemeStore((s) => s.theme);
	const [filter, setFilter] = useState<LogLevel | "all">("all");

	useEffect(() => {
		if (initialized) {
			sendRequestServerLogs(200);
		}
	}, [initialized]);

	const filteredLogs = filter === "all" ? logs : logs.filter((l) => l.level === filter);

	return (
		<div className="flex flex-col h-full">
			<div className="flex items-center gap-3 p-4 border-b border-border h-16">
				<h2 className="text-sm font-medium">Server logs</h2>
				<span className="text-xs text-muted-foreground">{filteredLogs.length} entries</span>
				<div className="flex items-center gap-1 ml-auto">
					{LEVEL_FILTERS.map((f) => (
						<Button
							key={f.value}
							variant={filter === f.value ? "default" : "ghost"}
							size="sm"
							className="h-7 px-2 text-xs"
							onClick={() => setFilter(f.value)}
						>
							{f.label}
						</Button>
					))}
					<Button
						variant="outline"
						size="sm"
						className="h-7 px-2 text-xs ml-2"
						onClick={() => sendRequestServerLogs(200)}
					>
						Refresh
					</Button>
				</div>
			</div>

			<div className="flex-1 min-h-0 overflow-auto" style={{ colorScheme: theme }}>
				<pre className="p-4 text-xs font-mono leading-relaxed">
					{filteredLogs.length === 0 ? (
						<span className="text-muted-foreground">No log entries</span>
					) : (
						filteredLogs.map((entry) => <LogLine key={entry.id} entry={entry} />)
					)}
				</pre>
			</div>
		</div>
	);
}

function LogLine({ entry }: { entry: ServerLog }) {
	const [expanded, setExpanded] = useState(false);
	const hasMeta = Boolean(entry.meta);

	const line = (
		<>
			<span className="text-muted-foreground">{formatTime(entry.createdAt)}</span>{" "}
			<span className={`font-semibold ${levelColor[entry.level]}`}>{entry.level.toUpperCase().padEnd(5)}</span>{" "}
			<span className="text-primary">[{entry.source}]</span> <span>{entry.message}</span>
		</>
	);

	return (
		<>
			{hasMeta ? (
				<button
					type="button"
					className="block w-full text-left hover:bg-accent/50 px-1 -mx-1 rounded cursor-pointer"
					onClick={() => setExpanded(!expanded)}
				>
					{line}
				</button>
			) : (
				<span className="block px-1 -mx-1">{line}</span>
			)}
			{expanded && entry.meta && (
				<span className="block pl-6 pb-1 text-muted-foreground">{formatMeta(entry.meta)}</span>
			)}
		</>
	);
}

function formatMeta(meta: string): string {
	try {
		return JSON.stringify(JSON.parse(meta), null, 2);
	} catch {
		return meta;
	}
}
