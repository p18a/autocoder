import { useCallback, useEffect, useRef, useState } from "react";

interface ScrollShadowProps {
	children: React.ReactNode;
	className?: string;
}

export function ScrollShadow({ children, className }: ScrollShadowProps) {
	const ref = useRef<HTMLDivElement>(null);
	const [top, setTop] = useState(false);
	const [bottom, setBottom] = useState(false);

	const update = useCallback(() => {
		const el = ref.current;
		if (!el) return;
		setTop(el.scrollTop > 0);
		setBottom(el.scrollHeight - el.scrollTop - el.clientHeight > 1);
	}, []);

	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		el.addEventListener("scroll", update, { passive: true });
		const ro = new ResizeObserver(update);
		ro.observe(el);
		update();
		return () => {
			el.removeEventListener("scroll", update);
			ro.disconnect();
		};
	}, [update]);

	return (
		<div className="relative flex-1 min-h-0">
			<div ref={ref} className={`h-full overflow-y-auto ${className ?? ""}`}>
				{children}
			</div>
			<div
				className="pointer-events-none absolute inset-x-0 top-0 h-6 bg-gradient-to-b from-background to-transparent transition-opacity duration-200"
				style={{ opacity: top ? 1 : 0 }}
			/>
			<div
				className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-background to-transparent transition-opacity duration-200"
				style={{ opacity: bottom ? 1 : 0 }}
			/>
		</div>
	);
}
