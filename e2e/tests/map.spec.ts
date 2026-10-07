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
