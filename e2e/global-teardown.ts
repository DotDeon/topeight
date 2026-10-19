import { execFileSync } from "node:child_process";
import { assertLocalBackend, targetConvexUrl } from "./global-setup";

/** Turns the fixture flag back off once the run is over. */
export default function globalTeardown() {
  assertLocalBackend(targetConvexUrl());
  const envFile = process.env.E2E_CONVEX_ENV_FILE ? ["--env-file", process.env.E2E_CONVEX_ENV_FILE] : [];
  execFileSync("npx", ["convex", "env", "remove", ...envFile, "OPENSPACE_TEST_FIXTURES"], { stdio: "inherit" });
}
