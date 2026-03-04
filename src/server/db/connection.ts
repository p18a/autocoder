import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";

const DB_PATH = "./data/autocoder.db";

try {
	mkdirSync("./data", { recursive: true });
} catch {
	// already exists
}

export const db = new Database(DB_PATH, { create: true });
db.run("PRAGMA journal_mode = WAL");
db.run("PRAGMA foreign_keys = ON");
