import { db } from "./connection.ts";

// --- Table creation ---

db.run(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    prompt TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS task_logs (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id),
    content TEXT NOT NULL,
    stream TEXT NOT NULL DEFAULT 'stdout',
    created_at TEXT NOT NULL
  )
`);

db.run("CREATE INDEX IF NOT EXISTS idx_task_logs_task_id ON task_logs(task_id)");

db.run(`
  CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS server_logs (
    id TEXT PRIMARY KEY,
    level TEXT NOT NULL,
    source TEXT NOT NULL,
    message TEXT NOT NULL,
    meta TEXT,
    created_at TEXT NOT NULL
  )
`);
db.run("CREATE INDEX IF NOT EXISTS idx_server_logs_created_at ON server_logs(created_at)");
db.run("CREATE INDEX IF NOT EXISTS idx_server_logs_level ON server_logs(level)");

// --- Migrations ---

function runMigration(sql: string) {
	try {
		db.run(sql);
	} catch (e) {
		if (e instanceof Error && e.message.includes("duplicate column name")) {
			return;
		}
		throw e;
	}
}

runMigration("ALTER TABLE tasks ADD COLUMN task_type TEXT NOT NULL DEFAULT 'execution'");
runMigration("ALTER TABLE tasks ADD COLUMN origin_task_id TEXT");
runMigration("ALTER TABLE tasks ADD COLUMN title TEXT");

// Add unique constraint on project path
db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_path ON projects(path)");

// Dev journal table
db.run(`
  CREATE TABLE IF NOT EXISTS journal_entries (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    content TEXT NOT NULL,
    tier TEXT NOT NULL DEFAULT 'recent',
    created_at TEXT NOT NULL
  )
`);
db.run("CREATE INDEX IF NOT EXISTS idx_journal_entries_project_id ON journal_entries(project_id)");
db.run("CREATE INDEX IF NOT EXISTS idx_journal_entries_tier ON journal_entries(project_id, tier)");
