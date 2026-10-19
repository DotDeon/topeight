import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

/**
 * Seeds the e2e fixtures (convex/testing.ts) into the Convex deployment the
 * dev server talks to. The fixtures are internalMutations, so only the CLI
 * with deploy credentials can run them, and they refuse to run unless the
 * deployment has OPENSPACE_TEST_FIXTURES=1. This setup sets that flag, and
 * e2e/global-teardown.ts unsets it.
 *
 * It refuses to touch anything but a local Convex backend. Set
 * E2E_CONVEX_ENV_FILE to pass `--env-file` (self-hosted backends).
 * The commenter's password is random per run and reaches the specs through
 * E2E_COMMENTER_PASSWORD.
 */

function envFileValue(path: string, key: string): string | undefined {
  if (!existsSync(path)) return undefined;
  const line = readFileSync(path, "utf8")
    .split("\n")
    .find((l) => l.startsWith(`${key}=`));
  return line?.slice(key.length + 1).trim().replace(/^["']|["']$/g, "");
}

/** The Convex URL the CLI will target, or undefined when it cannot be told. */
export function targetConvexUrl(): string | undefined {
  const envFile = process.env.E2E_CONVEX_ENV_FILE;
  if (envFile) return envFileValue(envFile, "CONVEX_SELF_HOSTED_URL");
  return (
    process.env.CONVEX_SELF_HOSTED_URL ??
    process.env.NEXT_PUBLIC_CONVEX_URL ??
    envFileValue(".env.local", "CONVEX_SELF_HOSTED_URL") ??
    envFileValue(".env.local", "NEXT_PUBLIC_CONVEX_URL")
  );
}

export function assertLocalBackend(url: string | undefined): void {
  let host = "";
  try {
    host = new URL(url ?? "").hostname;
  } catch {
    // falls through to the refusal below
  }
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error("e2e fixtures only run against a local Convex backend");
  }
}

export default function globalSetup() {
  assertLocalBackend(targetConvexUrl());
  const port = process.env.PORT ?? "3000";
  const envFile = process.env.E2E_CONVEX_ENV_FILE ? ["--env-file", process.env.E2E_CONVEX_ENV_FILE] : [];
  const password = randomBytes(18).toString("base64url");
  process.env.E2E_COMMENTER_PASSWORD = password;
  const convex = (...args: string[]) => execFileSync("npx", ["convex", ...args], { stdio: "inherit" });
  convex("env", "set", ...envFile, "OPENSPACE_TEST_FIXTURES", "1");
  convex("run", ...envFile, "testing:seedSandboxFixture", JSON.stringify({ mainOrigin: `http://localhost:${port}` }));
  convex("run", ...envFile, "testing:seedCommenterFixture", JSON.stringify({ password }));
}
