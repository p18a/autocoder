import type { Config } from "../../shared/types.ts";
import { db } from "./connection.ts";

class ConfigRow implements Config {
	key!: string;
	value!: string;
}

const selectConfig = db.prepare("SELECT key, value FROM config WHERE key = ?").as(ConfigRow);
const selectAllConfig = db.prepare("SELECT key, value FROM config").as(ConfigRow);
const upsertConfig = db.prepare(
	"INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?",
);

export function getConfig(key: string): Config | null {
	return selectConfig.get(key) ?? null;
}

export function listConfig(): Config[] {
	return selectAllConfig.all();
}

export function setConfig(key: string, value: string): Config {
	upsertConfig.run(key, value, value);
	return { key, value };
}

export function getProjectConfig(projectId: string, key: string): string | null {
	const config = getConfig(`${key}:${projectId}`);
	return config?.value ?? null;
}

export function setProjectConfig(projectId: string, key: string, value: string): Config {
	return setConfig(`${key}:${projectId}`, value);
}
