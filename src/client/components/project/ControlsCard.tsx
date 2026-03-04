import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

export interface ControlsCardProps {
	isStarted: boolean;
	autoContinue: boolean;
	customInstructions: string;
	startLabel: string;
	onStart: () => void;
	onStop: () => void;
	onToggleAutoContinue: () => void;
	onCustomInstructionsChange: (value: string) => void;
}

export function ControlsCard({
	isStarted,
	autoContinue,
	customInstructions,
	startLabel,
	onStart,
	onStop,
	onToggleAutoContinue,
	onCustomInstructionsChange,
}: ControlsCardProps) {
	const [localInstructions, setLocalInstructions] = useState(customInstructions);
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Sync external → local when the store value changes from another source
	useEffect(() => {
		setLocalInstructions(customInstructions);
	}, [customInstructions]);

	const flushSave = useCallback(
		(value: string) => {
			if (debounceRef.current) {
				clearTimeout(debounceRef.current);
				debounceRef.current = null;
			}
			onCustomInstructionsChange(value);
		},
		[onCustomInstructionsChange],
	);

	useEffect(() => {
		return () => {
			if (debounceRef.current) clearTimeout(debounceRef.current);
		};
	}, []);

	function handleChange(value: string) {
		setLocalInstructions(value);
		if (debounceRef.current) clearTimeout(debounceRef.current);
		debounceRef.current = setTimeout(() => {
			debounceRef.current = null;
			onCustomInstructionsChange(value);
		}, 400);
	}

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
				<Textarea
					placeholder="Custom instructions for discovery (e.g. focus on security issues, refactor the auth module...)"
					value={localInstructions}
					onChange={(e) => handleChange(e.target.value)}
					onBlur={() => flushSave(localInstructions)}
					rows={2}
					className="text-sm resize-none"
				/>
			</CardContent>
		</Card>
	);
}
