import { execFileSync } from "node:child_process";
import { assertLocalBackend, targetConvexUrl } from "./global-setup";

/** Turns the fixture flag back off and puts ADMIN_EMAILS, the media URL and the audio settings back the way they were. */
export default function globalTeardown() {
  assertLocalBackend(targetConvexUrl());
  const envFile = process.env.E2E_CONVEX_ENV_FILE ? ["--env-file", process.env.E2E_CONVEX_ENV_FILE] : [];
  const convex = (...args: string[]) => execFileSync("npx", ["convex", ...args], { stdio: "inherit" });
  convex("env", "remove", ...envFile, "OPENSPACE_TEST_FIXTURES");
  if (process.env.E2E_SET_MEDIA_URL === "1") convex("env", "remove", ...envFile, "NEXT_PUBLIC_R2_PUBLIC_URL");
  for (const name of (process.env.E2E_SET_AUDIO_ENV ?? "").split(",").filter(Boolean)) {
    convex("env", "remove", ...envFile, name);
  }
  const prior = process.env.E2E_PRIOR_ADMIN_EMAILS;
  if (prior === undefined) return; // setup never got that far
  if (prior === "") convex("env", "remove", ...envFile, "ADMIN_EMAILS");
  else convex("env", "set", ...envFile, "ADMIN_EMAILS", prior);
}
