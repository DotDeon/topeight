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
 * E2E_COMMENTER_PASSWORD. The editor artist's goes through E2E_EDITOR_PASSWORD,
 * the admin's through E2E_ADMIN_PASSWORD.
 *
 * It also adds the admin fixture's email to ADMIN_EMAILS on the deployment.
 * The value from before the run goes in E2E_PRIOR_ADMIN_EMAILS so the
 * teardown can put it back, or remove the variable if there was none.
 * When NEXT_PUBLIC_R2_PUBLIC_URL is unset it sets a dummy one for the run, so
 * fixture tracks get URLs, and teardown removes it.
 */

export const ADMIN_FIXTURE_EMAIL = "e2e-admin@fixture.invalid";
/** Media base set for the run when the deployment has none. Port 9 refuses connections. */
export const E2E_MEDIA_URL = "http://127.0.0.1:9/e2e-media";

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
  const editorPassword = randomBytes(18).toString("base64url");
  process.env.E2E_EDITOR_PASSWORD = editorPassword;
  const adminPassword = randomBytes(18).toString("base64url");
  process.env.E2E_ADMIN_PASSWORD = adminPassword;
  const convex = (...args: string[]) => execFileSync("npx", ["convex", ...args], { stdio: "inherit" });
  convex("env", "set", ...envFile, "OPENSPACE_TEST_FIXTURES", "1");

  // `env get` prints nothing on stdout when the variable is unset.
  const prior = execFileSync("npx", ["convex", "env", "get", ...envFile, "ADMIN_EMAILS"], {
    stdio: ["ignore", "pipe", "ignore"],
  })
    .toString()
    .trim();
  // Drop the fixture in case a crashed run left it behind, so teardown never restores it.
  const others = prior.split(",").map((e) => e.trim()).filter((e) => e && e !== ADMIN_FIXTURE_EMAIL);
  process.env.E2E_PRIOR_ADMIN_EMAILS = others.join(",");
  convex("env", "set", ...envFile, "ADMIN_EMAILS", [...others, ADMIN_FIXTURE_EMAIL].join(","));

  // Track URLs need a public media base. Without one the fixture tracks have no
  // URL and no player. Nothing is fetched from it; teardown removes it again.
  const media = execFileSync("npx", ["convex", "env", "get", ...envFile, "NEXT_PUBLIC_R2_PUBLIC_URL"], {
    stdio: ["ignore", "pipe", "ignore"],
  })
    .toString()
    .trim();
  // A leftover dummy from a crashed run is ours too, so this run's teardown removes it.
  if (media === "" || media === E2E_MEDIA_URL) {
    convex("env", "set", ...envFile, "NEXT_PUBLIC_R2_PUBLIC_URL", E2E_MEDIA_URL);
    process.env.E2E_SET_MEDIA_URL = "1";
  }

  convex("run", ...envFile, "testing:seedSandboxFixture", JSON.stringify({ mainOrigin: `http://localhost:${port}` }));
  convex("run", ...envFile, "testing:seedCommenterFixture", JSON.stringify({ password }));
  convex("run", ...envFile, "testing:seedArtistLoginFixture", JSON.stringify({ password: editorPassword }));
  convex("run", ...envFile, "testing:seedAdminLoginFixture", JSON.stringify({ password: adminPassword }));
}
