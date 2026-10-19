import { expect, test, type Frame, type Page } from "@playwright/test";
import { buildUsercontentCsp } from "../lib/profile/csp";

// Seeded by e2e/global-setup.ts (convex/testing.ts seedSandboxFixture).
const port = Number(process.env.PORT ?? 3000);
const MAIN = `http://localhost:${port}`;
const USERCONTENT = process.env.NEXT_PUBLIC_USERCONTENT_ORIGIN ?? `http://127.0.0.1:${port}`;

type Probes = {
  cookie?: string;
  localStorage?: string;
  parentDocument?: string;
  topNav?: string;
  fetch?: string;
  form?: string;
  violations?: string[];
  done?: boolean;
};

function profileFrame(page: Page): Frame | undefined {
  return page.frames().find((f) => f.url().startsWith(`${USERCONTENT}/sandboxtest`));
}

/** Probe results the artist code wrote into the iframe's document.title. */
async function probes(page: Page): Promise<Probes> {
  let result: Probes = {};
  await expect
    .poll(
      async () => {
        const frame = profileFrame(page);
        if (!frame) return false;
        try {
          result = JSON.parse(await frame.title()) as Probes;
        } catch {
          return false;
        }
        return result.done === true;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  return result;
}

test.describe("artist sandbox", () => {
  test("profile iframe is sandboxed without same-origin", async ({ page }) => {
    await page.goto("/sandboxtest");
    const iframe = page.locator("iframe[data-openspace-profile]");
    await expect(iframe).toHaveAttribute("sandbox", "allow-scripts allow-popups");
    await expect(iframe).toHaveAttribute("allow", "autoplay");
    await expect(iframe).toHaveAttribute("src", `${USERCONTENT}/sandboxtest`);
  });

  test("artist code cannot reach cookies, storage, the parent or the main origin", async ({ page }) => {
    // A cookie on the main origin that artist code must never see.
    await page.context().addCookies([{ name: "secret", value: "main-only", url: MAIN }]);
    await page.goto("/sandboxtest");
    const r = await probes(page);
    console.log("sandbox probes:", JSON.stringify(r));

    // document.cookie: the opaque origin has no cookie jar ("" or a throw).
    expect(r.cookie).toMatch(/^threw:|^$/);
    expect(r.localStorage).toMatch(/^threw:/);
    expect(r.parentDocument).toMatch(/^threw:/);
    // A no-cors POST resolves with an opaque response unless CSP blocks it.
    expect(r.fetch).toMatch(/^rejected:/);
    expect(r.violations?.some((v) => v.startsWith("connect-src"))).toBe(true);
    // The form probe writes "stayed" only if the document survived submit().
    expect(r.form).toBe("stayed");
    expect(profileFrame(page)?.url()).toBe(`${USERCONTENT}/sandboxtest`);
    // Top navigation is blocked too.
    expect(page.url()).toBe(`${MAIN}/sandboxtest`);
  });

  test("bridge actions need a click in the parent's own dialog", async ({ page }) => {
    await page.goto("/sandboxtest");
    await probes(page);
    const dialog = page.locator("[data-openspace-confirm]");
    await expect(dialog).toBeHidden();

    await page.frameLocator("iframe[data-openspace-profile]").locator("#probe-add-friend").click();
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Add Sandbox Test to your friends?");
    // Nothing has run yet.
    await expect(dialog).not.toHaveAttribute("data-last-action", /.*/);
    await page.waitForTimeout(800);
    await expect(dialog).not.toHaveAttribute("data-last-action", /.*/);

    await dialog.getByRole("button", { name: "Confirm" }).click();
    await expect(dialog).toHaveAttribute("data-last-action", "addFriend");
    await expect(dialog).toContainText("Log in to add friends");
  });

  test("the dialog starts on Cancel and Enter does not confirm", async ({ page }) => {
    await page.goto("/sandboxtest");
    await probes(page);
    const dialog = page.locator("[data-openspace-confirm]");
    await page.frameLocator("iframe[data-openspace-profile]").locator("#probe-add-friend").click();
    await expect(dialog).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.activeElement?.textContent)).toBe("Cancel");
    // Wait past the arm delay so Confirm is live, then press Enter.
    await expect(dialog.getByRole("button", { name: "Confirm" })).toBeEnabled();
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    await expect(dialog).not.toHaveAttribute("data-last-action", /.*/);
  });

  test("frame dialogs are throttled visibly, coming-soon ones never count", async ({ page }) => {
    await page.goto("/sandboxtest");
    await probes(page);
    const frame = page.frameLocator("iframe[data-openspace-profile]");
    const dialog = page.locator("[data-openspace-confirm]");
    const note = page.locator("[data-openspace-strip]").getByText("This profile is sending too many requests");
    const pastCooldown = () => page.waitForTimeout(1_100);

    // Closing coming-soon dialogs (Forward to Friend) never counts.
    for (let i = 0; i < 4; i++) {
      await frame.locator('[data-openspace-action="forward"]').click();
      await expect(dialog).toContainText("Forward to Friend is coming soon.");
      await dialog.getByRole("button", { name: "Close" }).click();
      await expect(dialog).toBeHidden();
      await pastCooldown();
    }

    // Three cancelled requests that could act, then the frame is throttled.
    for (let i = 0; i < 3; i++) {
      await frame.locator("#probe-add-friend").click();
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await expect(dialog).toBeHidden();
      await pastCooldown();
    }
    await expect(note).toBeHidden();
    await frame.locator("#probe-add-friend").click();
    await expect(note).toBeVisible();
    await expect(dialog).toBeHidden();

    // Any trusted strip click lifts the throttle.
    await page.locator("[data-openspace-strip]").getByRole("button", { name: "Report" }).click();
    await expect(note).toBeHidden();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await pastCooldown();
    await frame.locator("#probe-add-friend").click();
    await expect(dialog).toContainText("Add Sandbox Test to your friends?");
  });

  test("main-host pages cannot be framed", async ({ request }) => {
    for (const path of ["/", "/sandboxtest", "/about"]) {
      const h = (await request.get(`${MAIN}${path}`)).headers();
      expect(h["content-security-policy"], path).toBe("frame-ancestors 'none'");
      expect(h["x-frame-options"], path).toBe("DENY");
    }
  });

  test("cancel runs nothing", async ({ page }) => {
    await page.goto("/sandboxtest");
    await probes(page);
    const dialog = page.locator("[data-openspace-confirm]");
    await page.frameLocator("iframe[data-openspace-profile]").locator("#probe-add-friend").click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await expect(dialog).not.toHaveAttribute("data-last-action", /.*/);
  });

  test("trusted strip opens the same dialog", async ({ page }) => {
    await page.goto("/sandboxtest");
    const strip = page.locator("[data-openspace-strip]");
    await strip.getByRole("button", { name: "Block" }).click();
    const dialog = page.locator("[data-openspace-confirm]");
    await expect(dialog).toContainText("Block Sandbox Test?");
    await dialog.getByRole("button", { name: "Confirm" }).click();
    await expect(dialog).toHaveAttribute("data-last-action", "block");
  });

  test("iframe takes the height its content reports", async ({ page }) => {
    await page.goto("/sandboxtest");
    await probes(page);
    const content = await profileFrame(page)!.evaluate(() => {
      const b = document.body;
      const margin = parseFloat(getComputedStyle(b).marginBottom) || 0;
      return Math.ceil(b.getBoundingClientRect().top + window.scrollY + b.scrollHeight + margin);
    });
    const iframe = page.locator("iframe[data-openspace-profile]");
    await expect
      .poll(async () => Math.abs(((await iframe.boundingBox())?.height ?? 0) - Math.max(150, content)))
      .toBeLessThan(3);
  });

  test("navigate messages move the parent to a profile path", async ({ page }) => {
    await page.goto("/sandboxtest");
    await probes(page);
    await page.frameLocator("iframe[data-openspace-profile]").locator("#probe-navigate").click();
    // The first visit compiles the route in dev, so allow time.
    await expect(page).toHaveURL(`${MAIN}/sandboxtest/friends`, { timeout: 30_000 });
  });

  test("main origin does not serve /usercontent", async ({ request }) => {
    const res = await request.get(`${MAIN}/usercontent/lowveld`);
    expect(res.status()).toBe(404);
    const seeded = await request.get(`${MAIN}/usercontent/sandboxtest`);
    expect(seeded.status()).toBe(404);
  });

  test("usercontent origin serves the document with locked-down headers", async ({ request }) => {
    const res = await request.get(`${USERCONTENT}/sandboxtest`);
    expect(res.status()).toBe(200);
    const h = res.headers();
    expect(h["content-type"]).toContain("text/html");
    expect(h["content-security-policy"]).toBe(
      `${buildUsercontentCsp(USERCONTENT)}; frame-ancestors ${MAIN}; sandbox allow-scripts allow-popups`,
    );
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["referrer-policy"]).toBe("no-referrer");
    expect(h["cache-control"]).toContain("no-store");
    expect(h["x-frame-options"]).toBeUndefined();
    expect(h["set-cookie"]).toBeUndefined();
    expect(await res.text()).toContain("window.openspace");
  });

  test("usercontent origin 404s unknown profiles and other paths", async ({ request }) => {
    expect((await request.get(`${USERCONTENT}/nobody_here`)).status()).toBe(404);
    expect((await request.get(`${USERCONTENT}/`)).status()).toBe(404);
    expect((await request.get(`${USERCONTENT}/sandboxtest/friends`)).status()).toBe(404);
  });

  test("unknown profiles 404 on the main origin", async ({ page }) => {
    const res = await page.goto("/nobody_here");
    expect(res?.status()).toBe(404);
  });

  test("fan profile renders in the frame", async ({ page }) => {
    await page.goto("/sandboxfan");
    const frame = page.frameLocator("iframe[data-openspace-profile]");
    await expect(frame.locator("h1.name")).toHaveText("Sandbox Fan");
  });
});
