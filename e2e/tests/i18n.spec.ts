import { expect, newAccount, openContext, signIn, test } from "../fixtures";

test("language switch on login page and persisted on the account", async ({ browser }) => {
  const ctx = await openContext(browser, { locale: "en-US" });
  const page = await ctx.newPage();
  await page.goto("/login");
  await expect(page.getByTestId("auth-submit")).toHaveText("Sign in");
  await page.getByTestId("lang-fr").click();
  await expect(page.getByTestId("auth-submit")).toHaveText("Se connecter");

  const acc = newAccount("Lea");
  await signIn(ctx, acc, "register", "fr");
  await page.goto("/me");
  await expect(page.getByTestId("tab-devices")).toContainText("Appareils");
  await page.getByTestId("lang-en").click();
  await expect(page.getByTestId("tab-devices")).toContainText("Devices");
  await page.reload();
  await expect(page.getByTestId("tab-devices")).toContainText("Devices");
  const me = await (await ctx.request.get("/api/auth/me")).json();
  expect(me.locale).toBe("en");
  await ctx.close();
});
