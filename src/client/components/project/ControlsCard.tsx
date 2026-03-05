import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

export interface ControlsCardProps {
	isStarted: boolean;
	autoContinue: boolean;
	customInstructions: string;
	timeoutMinutes: string;
	verifyCommand: string;
	startLabel: string;
	onStart: () => void;
	onStop: () => void;
	onToggleAutoContinue: () => void;
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

export function ControlsCard({
	isStarted,
	autoContinue,
	customInstructions,
	timeoutMinutes,
	verifyCommand,
	startLabel,
	onStart,
	onStop,
	onToggleAutoContinue,
	onCustomInstructionsChange,
	onTimeoutChange,
	onVerifyCommandChange,
}: ControlsCardProps) {
	const instructions = useDebouncedInput(customInstructions, onCustomInstructionsChange);
	const timeout = useDebouncedInput(timeoutMinutes, onTimeoutChange);
	const verify = useDebouncedInput(verifyCommand, onVerifyCommandChange);

	return (
		<Card className="shrink-0">
			<CardContent className="space-y-3 py-3">
				<div className="flex items-center gap-4">
					{isStarted ? (
						<Button variant="destructive" onClick={onStop}>
							Stop
						</Button>
					) : (
						<Button onClick={onStart}>{startLabel}</Button>
					)}
					<div className="flex items-center gap-2">
						<Switch id="auto-discover" checked={autoContinue} onCheckedChange={onToggleAutoContinue} />
						<label htmlFor="auto-discover" className="text-sm text-muted-foreground cursor-pointer select-none">
							Auto-discover new tasks
						</label>
					</div>
				</div>

				<div className="flex items-center gap-3">
					<div className="flex items-center gap-2">
						<label htmlFor="timeout-minutes" className="text-sm text-muted-foreground whitespace-nowrap">
							Task timeout (min)
						</label>
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
					</div>
				</div>

				<div className="space-y-1">
					<Input
						placeholder="e.g. bun check && bun test"
						value={verify.local}
						onChange={(e) => verify.handleChange(e.target.value)}
						onBlur={() => verify.flush(verify.local)}
						className="text-sm"
					/>
					<p className="text-xs text-muted-foreground">
						Runs after each task. Reverts changes if check fails after 1 retry.
					</p>
				</div>

				<Textarea
					placeholder="Custom instructions for discovery (e.g. focus on security issues, refactor the auth module...)"
					value={instructions.local}
					onChange={(e) => instructions.handleChange(e.target.value)}
					onBlur={() => instructions.flush(instructions.local)}
					rows={2}
					className="text-sm resize-none"
				/>
			</CardContent>
		</Card>
	);
}
