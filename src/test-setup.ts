import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";

// Use an isolated temporary database for tests so they never conflict
// with the live server's database.
const tmpDir = mkdtempSync(join(realpathSync(process.env.TMPDIR ?? "/tmp"), "autocoder-test-"));
process.env.AUTOCODER_DB_PATH = join(tmpDir, "test.db");

import { afterAll } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();

afterAll(async () => {
	await GlobalRegistrator.unregister();
	// Clean up temp database
	try {
		rmSync(tmpDir, { recursive: true, force: true });
	} catch {
		// best-effort
	}
});
