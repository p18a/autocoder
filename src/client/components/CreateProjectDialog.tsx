import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { sendCreateProject } from "../stores/commands.ts";

interface CreateProjectDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function CreateProjectDialog({ open, onOpenChange }: CreateProjectDialogProps) {
	const [name, setName] = useState("");
	const [path, setPath] = useState("");

	function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		if (!name.trim() || !path.trim()) return;
		const sent = sendCreateProject(name.trim(), path.trim());
		if (!sent) return;
		setName("");
		setPath("");
		onOpenChange(false);
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<form onSubmit={handleSubmit}>
					<DialogHeader>
						<DialogTitle>Add project</DialogTitle>
						<DialogDescription>Add a project directory to work with.</DialogDescription>
					</DialogHeader>
					<div className="grid gap-4 py-4">
						<div className="grid gap-2">
							<Label htmlFor="name">Name</Label>
							<Input id="name" placeholder="My app" value={name} onChange={(e) => setName(e.target.value)} />
						</div>
						<div className="grid gap-2">
							<Label htmlFor="path">Path</Label>
							<Input
								id="path"
								placeholder="/Users/you/code/my-app"
								value={path}
								onChange={(e) => setPath(e.target.value)}
							/>
						</div>
					</div>
					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
							Cancel
						</Button>
						<Button type="submit" disabled={!name.trim() || !path.trim()}>
							Add project
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
