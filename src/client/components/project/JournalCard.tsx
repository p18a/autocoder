import { RefreshCw } from "lucide-react";
import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { JournalTier } from "../../../shared/types.ts";
import { sendRequestJournal } from "../../stores/commands.ts";
import { useJournalStore } from "../../stores/journal.ts";

const tierVariant: Record<JournalTier, "default" | "secondary" | "outline"> = {
	recent: "outline",
	summary: "secondary",
	historical: "default",
};

export interface JournalCardProps {
	projectId: string;
	className?: string;
}

function formatTimestamp(iso: string): string {
	const date = new Date(iso);
	const now = new Date();
	const diffMs = now.getTime() - date.getTime();
	const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

	if (diffDays === 0) {
		return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
	}
	if (diffDays === 1) return "yesterday";
	if (diffDays < 7) return `${diffDays}d ago`;
	return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function JournalCard({ projectId, className }: JournalCardProps) {
	const entries = useJournalStore(useShallow((s) => s.entries[projectId] ?? []));

	useEffect(() => {
		sendRequestJournal(projectId);
	}, [projectId]);

	return (
		<Card className={`flex flex-col overflow-hidden h-80 lg:h-auto ${className ?? ""}`}>
			<CardHeader className="pb-2 shrink-0">
				<div className="flex items-center justify-between">
					<CardTitle className="text-sm">Journal</CardTitle>
					<Button
						variant="ghost"
						size="icon-sm"
						className="size-6 text-muted-foreground hover:text-foreground"
						onClick={() => sendRequestJournal(projectId)}
						title="Refresh journal"
					>
						<RefreshCw className="size-3.5" />
					</Button>
				</div>
			</CardHeader>
			<CardContent className="flex-1 overflow-hidden pb-3">
				<ScrollArea className="h-full">
					{entries.length === 0 ? (
						<p className="text-xs text-muted-foreground">No journal entries yet</p>
					) : (
						<ul className="space-y-3">
							{entries.map((entry) => (
								<li key={entry.id} className="space-y-1">
									<div className="flex items-center gap-2">
										<Badge variant={tierVariant[entry.tier]} className="text-[10px] px-1.5 py-0">
											{entry.tier}
										</Badge>
										<span className="text-[10px] text-muted-foreground">{formatTimestamp(entry.createdAt)}</span>
									</div>
									<p className="text-xs text-foreground whitespace-pre-wrap leading-relaxed">{entry.content}</p>
								</li>
							))}
						</ul>
					)}
				</ScrollArea>
			</CardContent>
		</Card>
	);
}
