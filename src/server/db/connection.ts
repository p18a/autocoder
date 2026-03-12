import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const DB_PATH = process.env.AUTOCODER_DB_PATH ?? "./data/autocoder.db";

const dir = dirname(DB_PATH);
try {
	mkdirSync(dir, { recursive: true });
} catch {
	// already exists
}

export const db = new Database(DB_PATH, { create: true });
db.run("PRAGMA journal_mode = WAL");
db.run("PRAGMA foreign_keys = ON");
