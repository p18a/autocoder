import { Link } from "@tanstack/react-router";
import { Menu, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { LAST_PROJECT_KEY } from "../lib/last-project.ts";
import { useThemeStore } from "../stores/theme.ts";
import { ProjectDetail } from "./ProjectDetail.tsx";
import { ProjectList } from "./ProjectList.tsx";

interface DashboardProps {
	projectId: string | null;
	children?: React.ReactNode;
}

function SidebarContent({ projectId }: { projectId: string | null }) {
	const theme = useThemeStore((s) => s.theme);
	const toggleTheme = useThemeStore((s) => s.toggle);

	return (
		<>
			<ProjectList selectedProjectId={projectId} />
			<div className="p-3 border-t border-border flex items-center justify-between">
				<Link to="/logs" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
					Server logs
				</Link>
				<Button variant="ghost" size="icon-sm" onClick={toggleTheme} className="text-muted-foreground">
					{theme === "dark" ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
				</Button>
			</div>
		</>
	);
}

export function Dashboard({ projectId, children }: DashboardProps) {
	const [sheetOpen, setSheetOpen] = useState(false);

	useEffect(() => {
		if (projectId) {
			localStorage.setItem(LAST_PROJECT_KEY, projectId);
		}
	}, [projectId]);

	// Close sheet on navigation
	// biome-ignore lint/correctness/useExhaustiveDependencies: projectId change triggers sheet close
	useEffect(() => {
		setSheetOpen(false);
	}, [projectId]);

	return (
		<div className="flex h-full bg-background text-foreground">
			{/* Desktop sidebar */}
			<div className="hidden md:flex w-60 flex-shrink-0 border-r border-border flex-col">
				<div className="flex items-center justify-between p-4 border-b border-border h-16">
					<h1 className="text-lg font-semibold">Autocoder</h1>
				</div>
				<SidebarContent projectId={projectId} />
			</div>

			{/* Mobile header + sheet */}
			<div className="md:hidden fixed top-0 left-0 right-0 z-30 flex items-center gap-3 p-4 border-b border-border bg-background h-14">
				<Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
					<SheetTrigger asChild>
						<Button variant="ghost" size="icon-sm">
							<Menu className="size-5" />
						</Button>
					</SheetTrigger>
					<SheetContent side="left" className="w-80 p-0 flex flex-col">
						<SheetTitle className="p-4 border-b border-border text-lg font-semibold">Autocoder</SheetTitle>
						<SidebarContent projectId={projectId} />
					</SheetContent>
				</Sheet>
				<h1 className="text-sm font-semibold truncate">Autocoder</h1>
			</div>

			{/* Main content */}
			<div className="flex-1 overflow-hidden pt-14 md:pt-0">
				{children ??
					(projectId ? (
						<ProjectDetail projectId={projectId} />
					) : (
						<div className="flex items-center justify-center h-full text-muted-foreground">
							Select or create a project to get started
						</div>
					))}
			</div>
		</div>
	);
}
