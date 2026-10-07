import { expect, newAccount, openContext, signIn, test } from "../fixtures";

test("sign-in page in the browser's language, then the account's, set in Settings", async ({ browser }) => {
  const ctx = await openContext(browser, { locale: "en-US" });
  const page = await ctx.newPage();
  await page.goto("/login");
  await expect(page.getByTestId("auth-submit")).toHaveText("Sign in");
  await expect(page.getByTestId("lang-fr")).toHaveCount(0);

  const acc = newAccount("Lea");
  await signIn(ctx, acc, "register", "fr");
  await page.goto("/settings");
  await expect(page.getByTestId("tab-devices")).toContainText("Appareils");
  await page.getByTestId("lang-en").click();
  await expect(page.getByTestId("tab-devices")).toContainText("Devices");
  await page.reload();
  await expect(page.getByTestId("tab-devices")).toContainText("Devices");
  const me = await (await ctx.request.get("/api/auth/me")).json();
  expect(me.locale).toBe("en");
  await ctx.close();
});

test("items tab explains that Apple providers are disabled by default", async ({ browser }) => {
  const ctx = await openContext(browser);
  await signIn(ctx, newAccount("Items"), "register");
  const page = await ctx.newPage();
  await page.goto("/items");
  await expect(page.getByTestId("items-panel")).toContainText("disabled on this server");
  await ctx.close();
});
