import type { BrowserContext } from "@playwright/test";
import { expect, newAccount, openContext, signIn, test } from "../fixtures";

// The e2e server runs without the Apple providers (they need an Apple ID): Find My is turned on
// in the config the page reads, and its account answered for.
async function withFindMy(ctx: BrowserContext, state: "none" | "logged_in" | "reauth_required") {
  await ctx.route("**/api/config", async (route) => {
    const response = await route.fetch();
    const config = await response.json();
    await route.fulfill({ response, json: { ...config, features: { ...config.features, findmy: true } } });
  });
  await ctx.route("**/api/providers/findmy/account", (route) =>
    route.fulfill({
      json: { state, display: state === "none" ? null : "w***@example.com", last_poll_at: null, last_error: null },
    }),
  );
}

test("Items lists items only; the Find My network account and adding items are in Settings", async ({ browser }) => {
  const ctx = await openContext(browser);
  await signIn(ctx, newAccount("Iris"), "register", "fr");
  await withFindMy(ctx, "none");
  const page = await ctx.newPage();

  await page.goto("/items");
  const items = page.getByTestId("items-panel");
  await expect(items).toContainText("Connectez un compte Apple au réseau Localiser");
  await expect(items.getByTestId("findmy-section")).toHaveCount(0);
  await expect(items.getByTestId("findmy-account")).toHaveCount(0);
  await expect(items.locator('input[type="password"]')).toHaveCount(0);

  // The empty state leads to the right page of Settings, under Me.
  await page.getByTestId("link-add-item").click();
  await expect(page).toHaveURL(/\/settings\/findmy$/);
  await expect(page.getByTestId("findmy-settings")).toContainText("Objets (réseau Localiser)");
  await expect(page.getByTestId("findmy-section").locator('input[type="password"]')).toBeVisible();
  await expect(page.getByTestId("tab-me")).toHaveClass(/active/);
  await expect(page.getByTestId("tab-items")).not.toHaveClass(/active/);

  // Back in Settings: one row for Find My (iCloud is off), with the account state.
  await page.getByTestId("back").click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByTestId("link-icloud")).toHaveCount(0);
  await expect(page.getByTestId("findmy-state")).toHaveText("Non connecté");
  await page.getByTestId("link-findmy").click();
  await expect(page.getByTestId("findmy-settings")).toBeVisible();
  await ctx.close();
});

test("connected: adding items in Settings; signed out by Apple: a warning in Items", async ({ browser }) => {
  const ctx = await openContext(browser);
  await signIn(ctx, newAccount("Ivan"), "register");
  await withFindMy(ctx, "logged_in");
  const page = await ctx.newPage();

  await page.goto("/settings");
  await expect(page.getByTestId("findmy-state")).toHaveText("Connected as w***@example.com");
  await page.getByTestId("link-findmy").click();
  await expect(page.getByTestId("findmy-account")).toContainText("Connected as w***@example.com");
  const add = page.getByTestId("add-item");
  await expect(add.getByRole("button", { name: "Generate a DIY tag key" })).toBeVisible();
  await expect(add.getByRole("button", { name: "Import a private key (OpenHaystack)" })).toBeVisible();
  await expect(add.getByRole("button", { name: "Import an AirTag (.plist)" })).toBeVisible();

  await ctx.unroute("**/api/providers/findmy/account");
  await withFindMy(ctx, "reauth_required");
  await page.goto("/items");
  await expect(page.getByTestId("findmy-warning")).toContainText("Apple asks to sign in to the Find My network again");
  await page.getByTestId("findmy-warning").getByRole("link").click();
  await expect(page).toHaveURL(/\/settings\/findmy$/);
  await ctx.close();
});

test("an item opens from Items and goes back there, with Items highlighted", async ({ browser }) => {
  const ctx = await openContext(browser);
  await signIn(ctx, newAccount("Ines"), "register");
  await withFindMy(ctx, "logged_in");
  // A Find My network item needs the provider: add one to the list the page gets.
  await ctx.route("**/api/devices", async (route) => {
    const response = await route.fetch();
    const tag = {
      id: "tag-1",
      name: "Keys",
      kind: "findmy",
      icon: "key",
      online: false,
      capabilities: [],
      is_primary: false,
      location: null,
      last_seen_at: null,
      battery: null,
      lost_mode: { enabled: false, message: null, phone: null, since: null, owner_name: null },
      created_at: new Date().toISOString(),
      provider_info: {},
    };
    await route.fulfill({ response, json: [...(await response.json()), tag] });
  });
  const page = await ctx.newPage();

  await page.goto("/items");
  await page.getByTestId("device-item-tag-1").click();
  await expect(page).toHaveURL(/\/devices\/tag-1$/);
  await expect(page.getByTestId("device-detail")).toContainText("Keys");
  await expect(page.getByTestId("tab-items")).toHaveClass(/active/);
  await expect(page.getByTestId("tab-devices")).not.toHaveClass(/active/);
  await page.getByTestId("back").click();
  await expect(page).toHaveURL(/\/items$/);
  await ctx.close();
});
