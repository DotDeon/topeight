import { execFileSync } from "node:child_process";

/**
 * Seeds the sandbox fixture profiles (convex/testing.ts) into the Convex
 * deployment the dev server talks to. seedSandboxFixture is an
 * internalMutation, so only the CLI with deploy credentials can run it.
 * Set E2E_CONVEX_ENV_FILE to pass `--env-file` (self-hosted backends).
 */
export default function globalSetup() {
  const port = process.env.PORT ?? "3000";
  const args = ["convex", "run"];
  if (process.env.E2E_CONVEX_ENV_FILE) args.push("--env-file", process.env.E2E_CONVEX_ENV_FILE);
  args.push("testing:seedSandboxFixture", JSON.stringify({ mainOrigin: `http://localhost:${port}` }));
  execFileSync("npx", args, { stdio: "inherit" });
}
