import { apiDevice, expect, newAccount, openContext, reportAt, shareWith, signIn, stubTiles, test } from "../fixtures";

test("my location falls back to my second source, live for the people I share with", async ({ page, context, browser }) => {
  await stubTiles(context);
  const marco = newAccount("Marco");
  await signIn(context, marco, "register", "fr");
  // The OwnTracks phone comes first (it is the primary device) but has no position yet.
  const phone = await apiDevice(context, "Fairphone5", { kind: "owntracks" });
  const laptop = await apiDevice(context, "MacBook", { icon: "laptop" });
  await reportAt(context, laptop, 48.8606, 2.3376);

  const claireCtx = await openContext(browser, { locale: "fr-FR" });
  const claire = newAccount("Claire");
  await signIn(claireCtx, claire, "register", "fr");
  await shareWith(context, claireCtx, claire.email);
  const c = await claireCtx.newPage();
  await c.goto("/people");
  const marcoRow = c.locator('[data-testid^="person-item-"]', { hasText: "Marco" });
  await expect(marcoRow).toContainText("Pas encore de position");

  // Marco adds his laptop as a second source, in Me › My location.
  await page.goto("/me");
  await page.getByTestId("link-location").click();
  await expect(page).toHaveURL(/\/me\/location$/);
  await expect(page.getByTestId("sources")).toContainText("La première source à jour (moins de 30 min) est utilisée");
  const list = page.getByTestId("source-list").locator("li");
  await expect(list).toHaveCount(1);
  await page.locator('select[name="source-device"]').selectOption(laptop.id);
  await page.getByTestId("source-add").click();
  await expect(list).toHaveCount(2);
  await expect(list.nth(0)).toHaveAttribute("data-testid", `source-${phone.id}`);
  // The phone has nothing to say: the laptop is used.
  await expect(page.getByTestId(`source-${laptop.id}`)).toHaveAttribute("data-in-use", "true");
  await expect(page.getByTestId(`source-${laptop.id}`)).toContainText("Utilisée maintenant");
  await expect(page.getByTestId("my-location")).toContainText("via MacBook");
  await expect(marcoRow).toContainText("MacBook");

  // The phone reports: first and up to date, it takes over, live on both sides.
  const owntracks = await context.request.post("/api/owntracks", {
    headers: { Authorization: `Basic ${Buffer.from(`${marco.email}:${phone.token}`).toString("base64")}` },
    data: { _type: "location", lat: 48.8584, lon: 2.2945, acc: 10, tst: Math.floor(Date.now() / 1000) },
  });
  expect(owntracks.ok()).toBe(true);
  await expect(page.getByTestId(`source-${phone.id}`)).toHaveAttribute("data-in-use", "true");
  await expect(page.getByTestId(`source-${laptop.id}`)).toHaveAttribute("data-in-use", "false");
  await expect(marcoRow).toContainText("Fairphone5");

  // Moved up, the laptop comes first.
  await page.getByTestId(`source-${laptop.id}`).getByTestId("source-up").click();
  await expect(list.nth(0)).toHaveAttribute("data-testid", `source-${laptop.id}`);
  await expect(page.getByTestId(`source-${laptop.id}`)).toHaveAttribute("data-in-use", "true");
  await expect(marcoRow).toContainText("MacBook");

  // People › Me says the same.
  await page.getByTestId("tab-people").click();
  await expect(page.getByTestId("person-me")).toContainText("via MacBook");
  await claireCtx.close();
});
