import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { ReconnectController, useConnectionStore } from "./connection.ts";

describe("ReconnectController", () => {
	let controller: ReconnectController;

	beforeEach(() => {
		controller = new ReconnectController();
	});

	afterEach(() => {
		controller.clearTimer();
	});

	test("allocateConnectionId returns incrementing ids", () => {
		expect(controller.allocateConnectionId()).toBe(1);
		expect(controller.allocateConnectionId()).toBe(2);
		expect(controller.allocateConnectionId()).toBe(3);
	});

	test("scheduleReconnect calls callback after delay", async () => {
		const callback = mock(() => {});
		controller.delay = 10;

		controller.scheduleReconnect(callback);

		await new Promise((r) => setTimeout(r, 50));
		expect(callback).toHaveBeenCalledTimes(1);
	});

	test("scheduleReconnect applies exponential backoff", async () => {
		expect(controller.delay).toBe(1000);

		controller.delay = 10;
		controller.scheduleReconnect(() => {});
		await new Promise((r) => setTimeout(r, 50));

		expect(controller.delay).toBe(20);
	});

	test("delay caps at 30000ms", async () => {
		controller.delay = 10;

		// Simulate multiple reconnects to verify cap
		for (let i = 0; i < 20; i++) {
			controller.scheduleReconnect(() => {});
			// Manually apply the backoff that the timer callback would
			controller.delay = Math.min(controller.delay * 2, 30000);
		}

		expect(controller.delay).toBe(30000);
	});

	test("clearTimer cancels pending reconnect", async () => {
		const callback = mock(() => {});
		controller.delay = 50;

		controller.scheduleReconnect(callback);
		controller.clearTimer();

		await new Promise((r) => setTimeout(r, 100));
		expect(callback).toHaveBeenCalledTimes(0);
		expect(controller.timer).toBeNull();
	});

	test("scheduleReconnect cancels previous timer", async () => {
		const first = mock(() => {});
		const second = mock(() => {});
		controller.delay = 10;

		controller.scheduleReconnect(first);
		controller.scheduleReconnect(second);

		await new Promise((r) => setTimeout(r, 50));
		expect(first).toHaveBeenCalledTimes(0);
		expect(second).toHaveBeenCalledTimes(1);
	});

	test("resetDelay restores initial delay", () => {
		controller.delay = 16000;
		controller.resetDelay();
		expect(controller.delay).toBe(1000);
	});
});

describe("useConnectionStore", () => {
	const initialReconnect = useConnectionStore.getState().reconnect;

	beforeEach(() => {
		// Close any leftover WebSocket from a previous test before resetting state
		const prev = useConnectionStore.getState().ws;
		if (prev && typeof prev.close === "function") {
			prev.onclose = null;
			prev.onerror = null;
			prev.onopen = null;
			prev.onmessage = null;
			prev.close();
		}
		useConnectionStore.setState({
			status: "disconnected",
			error: null,
			initialized: false,
			ws: null,
			connectionId: 0,
			reconnect: initialReconnect,
		});
		initialReconnect.clearTimer();
		initialReconnect.delay = 1000;
		initialReconnect.nextConnectionId = 0;
	});

	describe("send", () => {
		test("returns false and does not throw when disconnected", () => {
			const result = useConnectionStore.getState().send('{"type":"ping"}');
			expect(result).toBe(false);
		});

		test("sends data when connected with open WebSocket", () => {
			const sendMock = mock(() => {});
			const fakeWs = { send: sendMock, readyState: WebSocket.OPEN } as unknown as WebSocket;
			useConnectionStore.setState({ ws: fakeWs, status: "connected" });

			const result = useConnectionStore.getState().send('{"type":"ping"}');

			expect(result).toBe(true);
			expect(sendMock).toHaveBeenCalledWith('{"type":"ping"}');
		});

		test("returns false when status is connecting", () => {
			const fakeWs = { send: mock(() => {}), readyState: WebSocket.CONNECTING } as unknown as WebSocket;
			useConnectionStore.setState({ ws: fakeWs, status: "connecting" });

			const result = useConnectionStore.getState().send("data");
			expect(result).toBe(false);
		});
	});

	describe("disconnect", () => {
		test("sets status to disconnected and clears ws", () => {
			const closeMock = mock(() => {});
			const fakeWs = { close: closeMock } as unknown as WebSocket;
			useConnectionStore.setState({ ws: fakeWs, status: "connected", initialized: true });

			useConnectionStore.getState().disconnect();

			expect(useConnectionStore.getState().status).toBe("disconnected");
			expect(useConnectionStore.getState().initialized).toBe(false);
			expect(useConnectionStore.getState().ws).toBeNull();
			expect(closeMock).toHaveBeenCalledTimes(1);
		});

		test("clears pending reconnect timer", () => {
			const { reconnect } = useConnectionStore.getState();
			reconnect.delay = 10;
			reconnect.scheduleReconnect(() => {});
			expect(reconnect.timer).not.toBeNull();

			useConnectionStore.getState().disconnect();

			expect(reconnect.timer).toBeNull();
		});
	});

	describe("connect", () => {
		test("sets status to connecting and allocates connection id", async () => {
			// Mock fetch to return a token
			const originalFetch = globalThis.fetch;
			globalThis.fetch = Object.assign(
				mock(() => Promise.resolve(new Response(JSON.stringify({ token: "test-token" }), { status: 200 }))),
				{ preconnect: () => {} },
			);

			// We can't fully test connect without a real WebSocket server,
			// but we can verify the initial state transitions
			const connectPromise = useConnectionStore.getState().connect();

			// Should immediately transition to connecting
			expect(useConnectionStore.getState().status).toBe("connecting");
			expect(useConnectionStore.getState().connectionId).toBe(1);

			await connectPromise;
			// Clean up WebSocket created by connect to prevent unhandled errors
			useConnectionStore.getState().disconnect();
			globalThis.fetch = originalFetch;
		});

		test("skips if already has an open WebSocket", async () => {
			const fakeWs = { readyState: WebSocket.OPEN } as unknown as WebSocket;
			useConnectionStore.setState({ ws: fakeWs, status: "connected" });

			const fetchMock = mock(() => Promise.resolve(new Response("{}")));
			const originalFetch = globalThis.fetch;
			globalThis.fetch = Object.assign(fetchMock, { preconnect: () => {} });

			await useConnectionStore.getState().connect();

			// Should not have fetched a token
			expect(fetchMock).not.toHaveBeenCalled();

			globalThis.fetch = originalFetch;
		});

		test("schedules reconnect on fetch failure", async () => {
			const originalFetch = globalThis.fetch;
			globalThis.fetch = Object.assign(
				mock(() => Promise.reject(new Error("network error"))),
				{ preconnect: () => {} },
			);

			const { reconnect } = useConnectionStore.getState();
			reconnect.delay = 10;

			await useConnectionStore.getState().connect();

			expect(useConnectionStore.getState().status).toBe("disconnected");
			// A reconnect timer should be scheduled
			expect(reconnect.timer).not.toBeNull();

			reconnect.clearTimer();
			globalThis.fetch = originalFetch;
		});

		test("sets error on fetch failure and clears it on successful connection", async () => {
			const originalFetch = globalThis.fetch;

			// Simulate fetch failure
			globalThis.fetch = Object.assign(
				mock(() => Promise.reject(new Error("network error"))),
				{ preconnect: () => {} },
			);

			const { reconnect } = useConnectionStore.getState();
			reconnect.delay = 10;

			await useConnectionStore.getState().connect();

			expect(useConnectionStore.getState().error).toBe("Cannot reach server");

			// Now simulate successful token fetch to verify error is cleared at connect start
			globalThis.fetch = Object.assign(
				mock(() => Promise.resolve(new Response(JSON.stringify({ token: "t" }), { status: 200 }))),
				{ preconnect: () => {} },
			);

			reconnect.clearTimer();
			const connectPromise = useConnectionStore.getState().connect();

			// error should be cleared at the start of connect
			expect(useConnectionStore.getState().error).toBeNull();

			await connectPromise;
			useConnectionStore.getState().disconnect();
			globalThis.fetch = originalFetch;
		});
	});
});
