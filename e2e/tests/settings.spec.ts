import { readFileSync } from "node:fs";
import { expect, newAccount, openContext, signIn, test } from "../fixtures";

// One version for the whole app (backend/pyproject.toml must agree, checked by the backend tests).
const VERSION: string = JSON.parse(readFileSync(new URL("../../frontend/package.json", import.meta.url), "utf8")).version;

test("Settings opens from Me and shows the version; privacy from the footer", async ({ browser }) => {
  const ctx = await openContext(browser);
  await signIn(ctx, newAccount("Sam"), "register");
  const page = await ctx.newPage();
  await page.goto("/me");
  // Me keeps the profile; the device and the language moved to Settings.
  await expect(page.getByTestId("profile")).toBeVisible();
  await expect(page.getByTestId("this-device")).toHaveCount(0);
  await expect(page.getByTestId("lang-fr")).toHaveCount(0);

  await page.getByTestId("btn-settings").click();
  await expect(page).toHaveURL(/\/settings$/);
  const panel = page.getByTestId("settings-panel");
  await expect(panel.getByTestId("this-device")).toBeVisible();
  await expect(panel.getByTestId("lang-en")).toBeVisible();
  await expect(panel.getByTestId("btn-logout")).toBeVisible();
  await expect(page.getByTestId("about-version")).toHaveText(VERSION);
  await expect(page.getByTestId("about-revision")).toHaveText(/^(dev|[0-9a-f]{4,40})$/);
  await expect(page.getByTestId("tab-me")).toHaveClass(/active/);
  await expect(page.getByTestId("app-footer")).toContainText(`Oukilé ${VERSION}`);

  await page.getByTestId("app-footer").getByRole("link", { name: "Privacy" }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page.getByTestId("privacy-panel")).toContainText("Who sees what");
  await page.getByTestId("back").click();
  await expect(page).toHaveURL(/\/settings$/);

  // Back to Me through the header, and to Settings again through the row.
  await page.getByTestId("back").click();
  await expect(page).toHaveURL(/\/me$/);
  await page.getByTestId("link-settings").click();
  await expect(page.getByTestId("settings-panel")).toBeVisible();
  await ctx.close();
});

test("privacy page readable signed out, linked from the sign-in page", async ({ browser }) => {
  const ctx = await openContext(browser);
  const page = await ctx.newPage();
  const res = await page.goto("/login");
  expect(res?.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
  await expect(page.getByTestId("app-footer")).toContainText(`Oukilé ${VERSION}`);

  await page.getByTestId("link-privacy").click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page.getByTestId("privacy")).toContainText("What is stored");
  await expect(page.getByTestId("privacy-history")).toContainText("deleted after 30 days");
  await page.getByTestId("back").click();
  await expect(page.getByTestId("auth-submit")).toBeVisible();

  // Straight to the page, and robots.txt for crawlers.
  await page.goto("/privacy");
  await expect(page.getByTestId("privacy")).toBeVisible();
  const robots = await ctx.request.get("/robots.txt");
  expect(await robots.text()).toBe("User-agent: *\nDisallow: /\n");
  const manifest = await (await ctx.request.get("/manifest.webmanifest")).json();
  expect(manifest).toMatchObject({ id: "/", lang: "en", categories: ["navigation", "utilities"] });
  expect(manifest.shortcuts.map((s: { url: string }) => s.url)).toEqual(["/people", "/devices", "/items"]);
  await ctx.close();
});

test("low battery: the people who see me hear of it, only if I chose so", async ({ browser }) => {
  const [aliceCtx, bobCtx] = [await openContext(browser), await openContext(browser)];
  const alice = newAccount("Alice");
  const bob = newAccount("Bob");
  await signIn(aliceCtx, alice, "register");
  await signIn(bobCtx, bob, "register");
  const created = await aliceCtx.request.post("/api/devices", { data: { name: "iPhone", kind: "browser" } });
  const { device_token } = await created.json();
  const share = await aliceCtx.request.post("/api/shares", { data: { recipient_email: bob.email } });
  expect(share.ok()).toBeTruthy();
  const accepted = await bobCtx.request.post(`/api/shares/${(await share.json()).id}/accept`);
  expect(accepted.ok()).toBeTruthy();
  const battery = (level: number) =>
    aliceCtx.request.post("/api/report/locations", {
      data: { fixes: [{ ts: new Date().toISOString(), lat: 48.85, lon: 2.35, accuracy: 10 }], battery: { level, charging: false } },
      headers: { Authorization: `Bearer ${device_token}` },
    });

  // Off by default: nothing said.
  const page = await aliceCtx.newPage();
  await page.goto("/settings");
  const toggle = page.getByTestId("toggle-battery-alerts");
  await expect(toggle).not.toBeChecked();
  await battery(0.5);
  await battery(0.1);
  const bobPage = await bobCtx.newPage();
  await bobPage.goto("/me");
  await expect(bobPage.getByTestId("notifications")).toBeVisible();
  await expect(bobPage.getByTestId("notification-item").filter({ hasText: "low battery" })).toHaveCount(0);

  // Turned on, it stays on, and the next fall below 15% is told.
  await toggle.click();
  await expect(toggle).toBeChecked();
  await page.reload();
  await expect(page.getByTestId("toggle-battery-alerts")).toBeChecked();
  await battery(0.6);
  await battery(0.12);
  await bobPage.reload();
  await expect(bobPage.getByTestId("notification-item").filter({ hasText: "Alice: low battery" })).toContainText("iPhone is down to 12%");
  await aliceCtx.close();
  await bobCtx.close();
});
