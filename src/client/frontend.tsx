import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { router } from "./router.ts";

// biome-ignore lint/style/noNonNullAssertion: root element always exists in index.html
const elem = document.getElementById("root")!;
const app = (
	<StrictMode>
		<RouterProvider router={router} />
	</StrictMode>
);

if (import.meta.hot) {
	// biome-ignore lint/suspicious/noAssignInExpressions: Bun HMR pattern
	const root = (import.meta.hot.data.root ??= createRoot(elem));
	root.render(app);
} else {
	createRoot(elem).render(app);
}
