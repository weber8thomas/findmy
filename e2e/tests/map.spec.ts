import { apiDevice, expect, newAccount, openContext, reportAt, setPhoto, shareWith, signIn, stubTiles, test } from "../fixtures";

const HOME = { latitude: 48.8584, longitude: 2.2945 };
const WORK = { latitude: 48.8606, longitude: 2.3376 };

test("the map shows what the tab is about: faces on People, devices on Devices", async ({ page, context, browser }) => {
  await stubTiles(context);
  const marco = newAccount("Marco");
  await signIn(context, marco, "register");
  const laptop = await apiDevice(context, "Laptop", { icon: "laptop" });
  await reportAt(context, laptop, HOME.latitude, HOME.longitude);

  // Claire shares her location with Marco.
  const claireCtx = await openContext(browser);
  const claire = newAccount("Claire");
  await signIn(claireCtx, claire, "register");
  const claireId = (await (await claireCtx.request.get("/api/auth/me")).json()).id;
  await reportAt(claireCtx, await apiDevice(claireCtx, "Claire phone"), WORK.latitude, WORK.longitude);
  await shareWith(claireCtx, context, marco.email);

  await page.goto("/people");
  await setPhoto(page, "#e0602a");
  await page.reload();
  const me = page.getByTestId("marker-me");
  await expect(me).toBeVisible();
  await expect(me.locator(".pin-photo")).toHaveCount(1);
  await expect(page.getByTestId(`marker-person-${claireId}`)).toBeVisible();
  await expect(page.locator('[data-testid^="marker-device-"]')).toHaveCount(0);

  await page.getByTestId("tab-devices").click();
  await expect(page.getByTestId(`marker-device-${laptop.id}`)).toBeVisible();
  await expect(page.getByTestId("marker-me")).toHaveCount(0);
  await expect(page.locator('[data-testid^="marker-person-"]')).toHaveCount(0);

  // No item here: an empty map, not someone else's markers.
  await page.getByTestId("tab-items").click();
  await expect(page.getByTestId("items-panel")).toBeVisible();
  await expect(page.locator('[data-testid^="marker-"]')).toHaveCount(0);

  // Me, Settings: only me.
  await page.getByTestId("tab-me").click();
  await expect(page.getByTestId("marker-me")).toBeVisible();
  await expect(page.locator('[data-testid^="marker-device-"], [data-testid^="marker-person-"]')).toHaveCount(0);

  // Faces open their page: for me, where my location comes from; someone else's, theirs.
  await page.getByTestId("marker-me").click();
  await expect(page).toHaveURL(/\/me\/location$/);
  await expect(page.getByTestId("my-location")).toContainText("via Laptop");
  // Back on People, the map frames both faces again.
  await page.getByTestId("tab-people").click();
  await page.getByTestId(`marker-person-${claireId}`).click();
  await expect(page).toHaveURL(new RegExp(`/people/${claireId}$`));
  await expect(page.getByTestId("person-detail")).toContainText("Claire");
  await expect(page.locator('[data-testid^="marker-device-"]')).toHaveCount(0);

  await claireCtx.close();
});

test("my places show on every tab, and the map credits fold into an ⓘ", async ({ page, context }) => {
  await stubTiles(context);
  await signIn(context, newAccount("Marco"), "register");
  await reportAt(context, await apiDevice(context, "Laptop", { icon: "laptop" }), HOME.latitude, HOME.longitude);
  const zone = await context.request.post("/api/zones", { data: { name: "Maison", lat: HOME.latitude, lon: HOME.longitude, radius_m: 150 } });
  expect(zone.ok()).toBeTruthy();

  await page.goto("/people");
  const place = page.locator(".zone-label", { hasText: "Maison" });
  await expect(place).toBeVisible();
  await page.getByTestId("tab-devices").click();
  await expect(place).toBeVisible();

  // In full at first, as OpenStreetMap asks; folded once the map is touched; back on a tap.
  const credits = page.getByTestId("map-credits");
  const text = credits.getByText("OpenStreetMap");
  await expect(text).toBeVisible();
  const size = page.viewportSize()!;
  await page.mouse.click(size.width - 60, 160);
  await expect(text).toBeHidden();
  await credits.getByRole("button").click();
  await expect(text).toBeVisible();
  await credits.getByRole("button").click();
  await expect(text).toBeHidden();
});
