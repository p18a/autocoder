import { createRootRoute, type ErrorComponentProps, Outlet, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import "../../index.css";
import { useConnectionStore } from "../stores/connection.ts";
import { useThemeStore } from "../stores/theme.ts";

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
		<div className={`${theme} h-dvh w-screen overflow-hidden`}>
			<Outlet />
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
