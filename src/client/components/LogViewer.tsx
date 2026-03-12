import { Button } from "@/components/ui/button";
import type { TaskLog } from "../../shared/types.ts";

interface LogViewerProps {
	logs: TaskLog[];
	hasMore: boolean;
	onLoadMore: () => void;
	emptyMessage?: string;
}

const TOOL_RE = /^Tool: (\S+)(?: (.+))?$/;

const TOOL_PRIMARY_PARAM: Record<string, string[]> = {
	Read: ["file_path"],
	Write: ["file_path"],
	Edit: ["file_path"],
	Bash: ["command"],
	Grep: ["pattern", "path"],
	Glob: ["pattern"],
	WebFetch: ["url"],
	WebSearch: ["query"],
};

function extractToolSummary(toolName: string, jsonStr: string | undefined): string | null {
	if (!jsonStr) return null;
	try {
		const parsed: unknown = JSON.parse(jsonStr);
		if (typeof parsed !== "object" || parsed === null) return jsonStr;
		const obj = parsed as Record<string, unknown>;
		const keys = TOOL_PRIMARY_PARAM[toolName];
		if (keys) {
			const parts = keys.map((k) => (typeof obj[k] === "string" ? obj[k] : null)).filter(Boolean);
			if (parts.length > 0) return parts.join("  ");
		}
		// Fallback: truncated JSON
		const raw = jsonStr.length > 80 ? `${jsonStr.slice(0, 77)}...` : jsonStr;
		return raw;
	} catch {
		return jsonStr.length > 80 ? `${jsonStr.slice(0, 77)}...` : jsonStr;
	}
}

function LogLine({ log }: { log: TaskLog }) {
	if (log.stream === "system") {
		const match = TOOL_RE.exec(log.content);
		if (match?.[1]) {
			const toolName = match[1];
			const summary = extractToolSummary(toolName, match[2]);
			return (
				<div className="py-0.5">
					<span className="text-neutral-500">▸ </span>
					<span className="text-cyan-400 font-semibold">{toolName}</span>
					{summary && (
						<>
							{"  "}
							<span className="text-green-400">{summary}</span>
						</>
					)}
				</div>
			);
		}
		return <div className="py-0.5 text-neutral-500">{log.content}</div>;
	}

	if (log.stream === "stderr") {
		return <div className="py-0.5 text-red-400">{log.content}</div>;
	}

	// stdout — assistant text or tool results
	return <div className="py-0.5">{log.content}</div>;
}

export function LogViewer({ logs, hasMore, onLoadMore, emptyMessage }: LogViewerProps) {
	return (
		<>
			{hasMore && (
				<div className="mb-1">
					<Button variant="ghost" size="sm" className="h-6 text-xs text-muted-foreground w-full" onClick={onLoadMore}>
						Load earlier logs
					</Button>
				</div>
			)}
			<div className="text-xs font-mono whitespace-pre-wrap">
				{logs.length === 0 && emptyMessage && <span className="text-muted-foreground">{emptyMessage}</span>}
				{logs.map((log) => (
					<LogLine key={log.id} log={log} />
				))}
			</div>
		</>
	);
}
