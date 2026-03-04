import { createRootRoute, Outlet } from "@tanstack/react-router";
import { useEffect } from "react";
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
		<div className={`${theme} h-screen w-screen overflow-hidden`}>
			<Outlet />
			<Toaster />
		</div>
	);
}

export const rootRoute = createRootRoute({
	component: RootLayout,
});
