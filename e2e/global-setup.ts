import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

/**
 * Seeds the e2e fixtures (convex/testing.ts) into the Convex deployment the
 * dev server talks to. The fixtures are internalMutations, so only the CLI
 * with deploy credentials can run them, and they refuse to run unless the
 * deployment has TOPEIGHT_TEST_FIXTURES=1. This setup sets that flag, and
 * e2e/global-teardown.ts unsets it.
 *
 * It refuses to touch anything but a local Convex backend. Set
 * E2E_CONVEX_ENV_FILE to pass `--env-file` (self-hosted backends).
 * The commenter's password is random per run and reaches the specs through
 * E2E_COMMENTER_PASSWORD. The editor artist's goes through E2E_EDITOR_PASSWORD,
 * the admin's through E2E_ADMIN_PASSWORD, the banned fixture's through E2E_BANNED_PASSWORD.
 *
 * It also adds the admin fixture's email to ADMIN_EMAILS on the deployment.
 * The value from before the run goes in E2E_PRIOR_ADMIN_EMAILS so the
 * teardown can put it back, or remove the variable if there was none.
 * When NEXT_PUBLIC_R2_PUBLIC_URL is unset it sets a dummy one for the run, and
 * teardown removes it. The same goes for each of the audio bucket variables in
 * E2E_AUDIO_ENV, so fixture tracks get signed playback URLs (signing is local),
 * and for FRAME_PASS_SECRET (E2E_FRAME_ENV), so private profiles render for friends.
 * The names it set go in E2E_SET_AUDIO_ENV for the teardown.
 */

export const ADMIN_FIXTURE_EMAIL = "e2e-admin@fixture.invalid";
/** Media base set for the run when the deployment has none. Port 9 refuses connections. */
export const E2E_MEDIA_URL = "http://127.0.0.1:9/e2e-media";
/** Audio bucket settings for the run when the deployment has none. Nothing is fetched: port 9 refuses connections. */
export const E2E_AUDIO_ENV: Record<string, string> = {
  R2_AUDIO_BUCKET: "e2e-audio",
  R2_ENDPOINT: "http://127.0.0.1:9",
  R2_ACCESS_KEY_ID: "e2e-dummy-key",
  R2_SECRET_ACCESS_KEY: "e2e-dummy-secret",
};

/** Frame pass secret for the run when the deployment has none, so friends see private fixture profiles. Local only. */
export const E2E_FRAME_ENV: Record<string, string> = { FRAME_PASS_SECRET: "e2e-frame-pass-secret" };

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
  const bannedPassword = randomBytes(18).toString("base64url");
  process.env.E2E_BANNED_PASSWORD = bannedPassword;
  const venuePassword = randomBytes(18).toString("base64url");
  process.env.E2E_VENUE_PASSWORD = venuePassword;
  const bandPassword = randomBytes(18).toString("base64url");
  process.env.E2E_BAND_PASSWORD = bandPassword;
  const convex = (...args: string[]) => execFileSync("npx", ["convex", ...args], { stdio: "inherit" });
  convex("env", "set", ...envFile, "TOPEIGHT_TEST_FIXTURES", "1");

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

  // Playback URLs are signed with the audio bucket settings, and private profiles
  // need the frame pass secret. Set dummies for any that are missing (or left over
  // from a crashed run, so teardown removes them).
  const setAudio: string[] = [];
  for (const [name, dummy] of Object.entries({ ...E2E_AUDIO_ENV, ...E2E_FRAME_ENV })) {
    const value = execFileSync("npx", ["convex", "env", "get", ...envFile, name], {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    if (value === "" || value === dummy) {
      convex("env", "set", ...envFile, name, dummy);
      setAudio.push(name);
    }
  }
  process.env.E2E_SET_AUDIO_ENV = setAudio.join(",");

  convex("run", ...envFile, "testing:seedSandboxFixture", JSON.stringify({ mainOrigin: `http://localhost:${port}` }));
  convex("run", ...envFile, "testing:seedCommenterFixture", JSON.stringify({ password }));
  convex("run", ...envFile, "testing:seedArtistLoginFixture", JSON.stringify({ password: editorPassword }));
  convex("run", ...envFile, "testing:seedAdminLoginFixture", JSON.stringify({ password: adminPassword }));
  convex("run", ...envFile, "testing:seedBannedLoginFixture", JSON.stringify({ password: bannedPassword }));
  convex("run", ...envFile, "testing:seedCommenterFriendship");
  convex("run", ...envFile, "testing:seedEditorBlock");
  convex("run", ...envFile, "testing:seedMailFixture");
  convex("run", ...envFile, "testing:seedVenueFixture", JSON.stringify({ venuePassword, bandPassword }));
}
