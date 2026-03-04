import * as db from "../db/index.ts";
import type { Handler } from "./types.ts";

export const handleSetConfig: Handler<"set_config"> = (ctx, msg) => {
	const config = db.setConfig(msg.key, msg.value);
	ctx.broadcast({ type: "config_updated", config });
};
