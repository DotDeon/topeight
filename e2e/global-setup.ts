import { execFileSync } from "node:child_process";

/**
 * Seeds the sandbox fixture profiles (convex/testing.ts) into the Convex
 * deployment the dev server talks to. seedSandboxFixture is an
 * internalMutation, so only the CLI with deploy credentials can run it, and
 * it refuses to run unless the deployment has OPENSPACE_TEST_FIXTURES=1.
 * This setup sets that on the (dev/preview) deployment first.
 * Set E2E_CONVEX_ENV_FILE to pass `--env-file` (self-hosted backends).
 */
export default function globalSetup() {
  const port = process.env.PORT ?? "3000";
  const envFile = process.env.E2E_CONVEX_ENV_FILE ? ["--env-file", process.env.E2E_CONVEX_ENV_FILE] : [];
  const convex = (...args: string[]) => execFileSync("npx", ["convex", ...args], { stdio: "inherit" });
  convex("env", "set", ...envFile, "OPENSPACE_TEST_FIXTURES", "1");
  convex("run", ...envFile, "testing:seedSandboxFixture", JSON.stringify({ mainOrigin: `http://localhost:${port}` }));
}
