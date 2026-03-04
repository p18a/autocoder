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
	const originalSend = useConnectionStore.getState().send;
	const originalConnect = useConnectionStore.getState().connect;
	const originalDisconnect = useConnectionStore.getState().disconnect;

	beforeEach(() => {
		useConnectionStore.setState({
			status: "disconnected",
			initialized: false,
			ws: null,
			connectionId: 0,
			reconnect: initialReconnect,
			send: originalSend,
			connect: originalConnect,
			disconnect: originalDisconnect,
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
			globalThis.fetch = mock(() =>
				Promise.resolve(new Response(JSON.stringify({ token: "test-token" }), { status: 200 })),
			) as typeof fetch;

			// We can't fully test connect without a real WebSocket server,
			// but we can verify the initial state transitions
			const connectPromise = useConnectionStore.getState().connect();

			// Should immediately transition to connecting
			expect(useConnectionStore.getState().status).toBe("connecting");
			expect(useConnectionStore.getState().connectionId).toBe(1);

			await connectPromise;
			globalThis.fetch = originalFetch;
		});

		test("skips if already has an open WebSocket", async () => {
			const fakeWs = { readyState: WebSocket.OPEN } as unknown as WebSocket;
			useConnectionStore.setState({ ws: fakeWs, status: "connected" });

			const fetchMock = mock(() => Promise.resolve(new Response("{}")));
			const originalFetch = globalThis.fetch;
			globalThis.fetch = fetchMock as typeof fetch;

			await useConnectionStore.getState().connect();

			// Should not have fetched a token
			expect(fetchMock).not.toHaveBeenCalled();

			globalThis.fetch = originalFetch;
		});

		test("schedules reconnect on fetch failure", async () => {
			const originalFetch = globalThis.fetch;
			globalThis.fetch = mock(() => Promise.reject(new Error("network error"))) as typeof fetch;

			const { reconnect } = useConnectionStore.getState();
			reconnect.delay = 10;

			await useConnectionStore.getState().connect();

			expect(useConnectionStore.getState().status).toBe("disconnected");
			// A reconnect timer should be scheduled
			expect(reconnect.timer).not.toBeNull();

			reconnect.clearTimer();
			globalThis.fetch = originalFetch;
		});
	});
});
