import { createRootRoute, type ErrorComponentProps, Outlet, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import "../../index.css";
import { useConnectionStore } from "../stores/connection.ts";
import { useThemeStore } from "../stores/theme.ts";

function ConnectionBanner() {
	const { status, error } = useConnectionStore(useShallow((s) => ({ status: s.status, error: s.error })));

	if (status === "connected" || (!error && status !== "disconnected")) return null;

	return (
		<div className="bg-destructive text-destructive-foreground px-4 py-2 text-center text-sm">
			{error ?? "Disconnected from server."} {status === "connecting" ? "Reconnecting\u2026" : ""}
		</div>
	);
}

function RootLayout() {
	const connect = useConnectionStore((s) => s.connect);
	const theme = useThemeStore((s) => s.theme);

	useEffect(() => {
		connect();
		return () => {
			useConnectionStore.getState().disconnect();
		};
	}, [connect]);

	useEffect(() => {
		const root = window.document.documentElement;
		root.classList.remove("light", "dark");
		root.classList.add(theme);
	}, [theme]);

	return (
		<div className={`${theme} h-dvh w-screen overflow-hidden flex flex-col`}>
			<ConnectionBanner />
			<div className="flex-1 overflow-hidden">
				<Outlet />
			</div>
			<Toaster />
		</div>
	);
}

function RootErrorComponent({ error, reset }: ErrorComponentProps) {
	const router = useRouter();
	return (
		<div className="flex flex-col items-center justify-center h-dvh gap-4 p-8 text-center">
			<h1 className="text-lg font-semibold text-destructive">Something went wrong</h1>
			<p className="text-sm text-muted-foreground max-w-md">{error.message}</p>
			<Button
				variant="outline"
				onClick={() => {
					reset();
					router.invalidate();
				}}
			>
				Try again
			</Button>
		</div>
	);
}

export const rootRoute = createRootRoute({
	component: RootLayout,
	errorComponent: RootErrorComponent,
});
