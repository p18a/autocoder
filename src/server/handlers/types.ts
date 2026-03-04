import type { ServerWebSocket } from "bun";
import type { ClientMessage, ServerMessage } from "../../shared/types.ts";
import type { WSData } from "../ws.ts";

export type HandlerContext = {
	ws: ServerWebSocket<WSData>;
	broadcast: (message: ServerMessage) => void;
	sendTo: (ws: ServerWebSocket<WSData>, message: ServerMessage) => void;
};

/** Extract the message shape for a specific ClientMessage type. */
export type MessageOf<T extends ClientMessage["type"]> = Extract<ClientMessage, { type: T }>;

export type Handler<T extends ClientMessage["type"] = ClientMessage["type"]> = (
	ctx: HandlerContext,
	msg: MessageOf<T>,
) => Promise<void> | void;

/** A map where each message type key maps to its correctly-typed handler. */
export type HandlerMap = {
	[T in ClientMessage["type"]]: Handler<T>;
};
