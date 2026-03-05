import { ChevronRight, Pencil } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

export type DiscoveryMode = "janitor" | "autopilot";

export interface ControlsCardProps {
	isStarted: boolean;
	autoContinue: boolean;
	discoveryMode: DiscoveryMode;
	projectPurpose: string;
	customInstructions: string;
	timeoutMinutes: string;
	verifyCommand: string;
	startLabel: string;
	onStart: () => void;
	onStop: () => void;
	onToggleAutoContinue: () => void;
	onDiscoveryModeChange: (mode: DiscoveryMode) => void;
	onProjectPurposeChange: (value: string) => void;
	onCustomInstructionsChange: (value: string) => void;
	onTimeoutChange: (value: string) => void;
	onVerifyCommandChange: (value: string) => void;
}

function useDebouncedInput(externalValue: string, onChange: (value: string) => void, delay = 400) {
	const [local, setLocal] = useState(externalValue);
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		setLocal(externalValue);
	}, [externalValue]);

	useEffect(() => {
		return () => {
			if (debounceRef.current) clearTimeout(debounceRef.current);
		};
	}, []);

	const flush = useCallback(
		(value: string) => {
			if (debounceRef.current) {
				clearTimeout(debounceRef.current);
				debounceRef.current = null;
			}
			onChange(value);
		},
		[onChange],
	);

	function handleChange(value: string) {
		setLocal(value);
		if (debounceRef.current) clearTimeout(debounceRef.current);
		debounceRef.current = setTimeout(() => {
			debounceRef.current = null;
			onChange(value);
		}, delay);
	}

	return { local, handleChange, flush };
}

function CustomInstructionsDialog({
	value,
	onChange,
	onFlush,
}: {
	value: string;
	onChange: (value: string) => void;
	onFlush: (value: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const [draft, setDraft] = useState(value);

	function handleOpen(nextOpen: boolean) {
		if (nextOpen) setDraft(value);
		if (!nextOpen) {
			onChange(draft);
			onFlush(draft);
		}
		setOpen(nextOpen);
	}

	return (
		<Dialog open={open} onOpenChange={handleOpen}>
			<DialogTrigger asChild>
				<Button variant="outline" size="sm" className="w-full justify-start text-muted-foreground font-normal">
					<Pencil className="size-3.5" />
					{value ? "Edit custom instructions" : "Add custom instructions"}
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>Custom instructions</DialogTitle>
					<DialogDescription>
						Additional context appended to every discovery prompt. Use this to steer what the agent focuses on.
					</DialogDescription>
				</DialogHeader>
				<Textarea
					value={draft}
					onChange={(e) => setDraft(e.target.value)}
					placeholder="e.g. Focus on security issues in the auth module. Ignore styling for now. Always add tests for new code."
					rows={12}
					className="text-sm"
				/>
				<DialogFooter showCloseButton />
			</DialogContent>
		</Dialog>
	);
}

export function ControlsCard({
	isStarted,
	autoContinue,
	discoveryMode,
	projectPurpose,
	customInstructions,
	timeoutMinutes,
	verifyCommand,
	startLabel,
	onStart,
	onStop,
	onToggleAutoContinue,
	onDiscoveryModeChange,
	onProjectPurposeChange,
	onCustomInstructionsChange,
	onTimeoutChange,
	onVerifyCommandChange,
}: ControlsCardProps) {
	const instructions = useDebouncedInput(customInstructions, onCustomInstructionsChange);
	const timeout = useDebouncedInput(timeoutMinutes, onTimeoutChange);
	const verify = useDebouncedInput(verifyCommand, onVerifyCommandChange);
	const purpose = useDebouncedInput(projectPurpose, onProjectPurposeChange);

	return (
		<Card className="shrink-0">
			<CardContent className="space-y-3 py-3">
				{/* Action row */}
				<div className="flex items-center gap-4">
					{isStarted ? (
						<Button variant="destructive" onClick={onStop}>
							Stop
						</Button>
					) : (
						<Button onClick={onStart}>{startLabel}</Button>
					)}
					<Field orientation="horizontal">
						<Switch id="auto-discover" checked={autoContinue} onCheckedChange={onToggleAutoContinue} />
						<FieldLabel htmlFor="auto-discover" className="font-normal cursor-pointer">
							Auto-discover new tasks
						</FieldLabel>
					</Field>
				</div>

				{/* Discovery settings */}
				<FieldSet>
					<FieldLegend variant="label">Discovery mode</FieldLegend>
					<RadioGroup
						value={discoveryMode}
						onValueChange={(v) => onDiscoveryModeChange(v as DiscoveryMode)}
						className="flex"
					>
						<Field orientation="horizontal">
							<RadioGroupItem value="janitor" id="mode-janitor" />
							<FieldLabel htmlFor="mode-janitor" className="font-normal">
								Janitor
							</FieldLabel>
						</Field>
						<Field orientation="horizontal">
							<RadioGroupItem value="autopilot" id="mode-autopilot" />
							<FieldLabel htmlFor="mode-autopilot" className="font-normal">
								Autopilot
							</FieldLabel>
						</Field>
					</RadioGroup>
					<FieldDescription>
						{discoveryMode === "janitor"
							? "Finds bugs, security issues, and code quality problems."
							: "Plans features and improvements toward the project purpose."}
					</FieldDescription>
				</FieldSet>

				{discoveryMode === "autopilot" && (
					<Field>
						<FieldLabel htmlFor="project-purpose">Project purpose</FieldLabel>
						<Textarea
							id="project-purpose"
							placeholder="What should this project become? Its goals, constraints, next steps..."
							value={purpose.local}
							onChange={(e) => purpose.handleChange(e.target.value)}
							onBlur={() => purpose.flush(purpose.local)}
							rows={3}
							className="text-sm resize-none"
						/>
					</Field>
				)}

				<CustomInstructionsDialog
					value={instructions.local}
					onChange={instructions.handleChange}
					onFlush={instructions.flush}
				/>

				{/* Advanced settings */}
				<Collapsible>
					<CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors group cursor-pointer">
						<ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
						Advanced settings
					</CollapsibleTrigger>
					<CollapsibleContent className="space-y-3 pt-2">
						<Field orientation="horizontal">
							<FieldLabel htmlFor="timeout-minutes" className="font-normal">
								Task timeout (min)
							</FieldLabel>
							<Input
								id="timeout-minutes"
								type="number"
								min={0}
								className="w-20 text-sm"
								value={timeout.local}
								onChange={(e) => timeout.handleChange(e.target.value)}
								onBlur={() => timeout.flush(timeout.local)}
							/>
							{timeout.local === "0" && <span className="text-xs text-muted-foreground">(no limit)</span>}
						</Field>

						<Field>
							<FieldLabel htmlFor="verify-command" className="font-normal">
								Verify command
							</FieldLabel>
							<Input
								id="verify-command"
								placeholder="e.g. bun check && bun test"
								value={verify.local}
								onChange={(e) => verify.handleChange(e.target.value)}
								onBlur={() => verify.flush(verify.local)}
								className="text-sm"
							/>
							<FieldDescription>Runs after each task. Reverts on failure after 1 retry.</FieldDescription>
						</Field>
					</CollapsibleContent>
				</Collapsible>
			</CardContent>
		</Card>
	);
}
