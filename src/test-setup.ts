import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";

// Use an isolated temporary database for tests so they never conflict
// with the live server's database.
const tmpDir = mkdtempSync(join(realpathSync(process.env.TMPDIR ?? "/tmp"), "autocoder-test-"));
process.env.AUTOCODER_DB_PATH = join(tmpDir, "test.db");

// Bun ≥1.3.10 CJS/ESM interop may omit React.act from require("react"),
// which breaks @testing-library/react's CJS build. Patch it before any
// test imports @testing-library/react.
// Cannot use `import { act } from "react"` — same named-export bug on 1.3.10.
const reactCjs = require("react") as Record<string, unknown>;
if (typeof reactCjs.act !== "function") {
	const testUtils = require("react-dom/test-utils") as Record<string, unknown>;
	if (typeof testUtils.act === "function") {
		reactCjs.act = testUtils.act;
	}
}

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
