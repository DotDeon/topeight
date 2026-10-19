import { execFileSync } from "node:child_process";
import { assertLocalBackend, targetConvexUrl } from "./global-setup";

/** Turns the fixture flag back off and puts ADMIN_EMAILS back the way it was. */
export default function globalTeardown() {
  assertLocalBackend(targetConvexUrl());
  const envFile = process.env.E2E_CONVEX_ENV_FILE ? ["--env-file", process.env.E2E_CONVEX_ENV_FILE] : [];
  const convex = (...args: string[]) => execFileSync("npx", ["convex", ...args], { stdio: "inherit" });
  convex("env", "remove", ...envFile, "OPENSPACE_TEST_FIXTURES");
  const prior = process.env.E2E_PRIOR_ADMIN_EMAILS;
  if (prior === undefined) return; // setup never got that far
  if (prior === "") convex("env", "remove", ...envFile, "ADMIN_EMAILS");
  else convex("env", "set", ...envFile, "ADMIN_EMAILS", prior);
}
