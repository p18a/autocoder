import { toast } from "sonner";
import { create } from "zustand";
import type { ServerMessage } from "../../shared/types.ts";
import { handleServerMessage } from "./messageHandler.ts";

export class ReconnectController {
	timer: ReturnType<typeof setTimeout> | null = null;
	delay = 1000;
	nextConnectionId = 0;

	scheduleReconnect(callback: () => void): void {
		this.clearTimer();
		this.timer = setTimeout(() => {
			this.delay = Math.min(this.delay * 2, 30000);
			callback();
		}, this.delay);
	}

	clearTimer(): void {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
	}

	resetDelay(): void {
		this.delay = 1000;
	}

	allocateConnectionId(): number {
		this.nextConnectionId++;
		return this.nextConnectionId;
	}
}

interface ConnectionState {
	status: "connecting" | "connected" | "disconnected";
	error: string | null;
	initialized: boolean;
	ws: WebSocket | null;
	connectionId: number;
	reconnect: ReconnectController;
	connect: () => Promise<void>;
	send: (data: string) => boolean;
	disconnect: () => void;
}

export const useConnectionStore = create<ConnectionState>((set, get) => ({
	status: "disconnected",
	error: null,
	initialized: false,
	ws: null,
	connectionId: 0,
	reconnect: new ReconnectController(),

	async connect() {
		const { reconnect } = get();
		const existing = get().ws;
		if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) {
			return;
		}

		reconnect.clearTimer();

		const thisConnectionId = reconnect.allocateConnectionId();
		set({ status: "connecting", error: null, initialized: false, connectionId: thisConnectionId });

		let token: string;
		try {
			const res = await fetch("/api/token");
			if (!res.ok) throw new Error(`Token fetch failed: ${res.status}`);
			const data = (await res.json()) as { token: string };
			token = data.token;
		} catch {
			if (get().connectionId !== thisConnectionId) return;
			set({ status: "disconnected", error: "Cannot reach server" });
			reconnect.scheduleReconnect(() => get().connect());
			return;
		}

		if (get().connectionId !== thisConnectionId) return;

		const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
		const ws = new WebSocket(`${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`);

		set({ ws });

		ws.onopen = () => {
			if (get().connectionId !== thisConnectionId) return;
			set({ status: "connected", error: null });
			reconnect.resetDelay();
		};

		ws.onmessage = (event) => {
			if (get().connectionId !== thisConnectionId) return;
			try {
				const msg = JSON.parse(event.data) as ServerMessage;
				handleServerMessage(msg);
			} catch {
				console.error("Failed to parse WS message");
			}
		};

		ws.onclose = () => {
			if (get().connectionId !== thisConnectionId) return;
			set({ status: "disconnected", ws: null });
			reconnect.scheduleReconnect(() => get().connect());
		};

		ws.onerror = () => {
			ws.close();
		};
	},

	send(data: string): boolean {
		const { ws, status } = get();
		if (ws && status === "connected") {
			ws.send(data);
			return true;
		}
		toast.error("Not connected to server");
		return false;
	},

	disconnect() {
		const { reconnect, ws } = get();
		reconnect.clearTimer();
		if (ws) {
			ws.close();
		}
		set({ status: "disconnected", initialized: false, ws: null });
	},
}));
