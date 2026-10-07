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
