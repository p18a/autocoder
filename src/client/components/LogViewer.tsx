import { Button } from "@/components/ui/button";
import type { TaskLog } from "../../shared/types.ts";

interface LogViewerProps {
	logs: TaskLog[];
	hasMore: boolean;
	onLoadMore: () => void;
	emptyMessage?: string;
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
			<pre className="text-xs font-mono whitespace-pre-wrap">
				{logs.length === 0 && emptyMessage && <span className="text-muted-foreground">{emptyMessage}</span>}
				{logs.map((log) => (
					<span
						key={log.id}
						className={
							log.stream === "stderr" ? "text-destructive" : log.stream === "system" ? "text-muted-foreground" : ""
						}
					>
						{log.content}
						{"\n"}
					</span>
				))}
			</pre>
		</>
	);
}
