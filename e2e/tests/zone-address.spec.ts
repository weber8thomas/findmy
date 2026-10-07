import { devices, type Page } from "@playwright/test";
import { baseURL, expect, newAccount, openContext, signIn, stubTiles, test } from "../fixtures";

// What the server relays from OpenStreetMap Nominatim; the e2e server has no internet.
const RESULTS = [
  {
    label: "1, Stephansplatz, Innere Stadt, Wien, 1010, Österreich",
    lat: 48.2084263,
    lon: 16.3731453,
  },
  {
    label: "Stephansplatz, Innere Stadt, Wien, 1010, Österreich",
    lat: 48.209,
    lon: 16.3727,
  },
  {
    label: "1, Stephansgasse, Mödling, Niederösterreich, 2340, Österreich",
    lat: 48.0856,
    lon: 16.2896,
  },
  {
    label: "Stephansdom, 3, Stephansplatz, Innere Stadt, Wien, 1010, Österreich",
    lat: 48.2085,
    lon: 16.373,
  },
  {
    label: "Stephanskirche, Kirchengasse, Baden, Niederösterreich, 2500, Österreich",
    lat: 48.0071,
    lon: 16.2344,
  },
];

const ADDRESS = "Stephansplatz 1, Wien";

/** Answers /api/geocode like the server would; returns the queries asked. */
async function mockGeocode(page: Page): Promise<string[]> {
  const asked: string[] = [];
  await page.route(/\/api\/geocode\?/, (route) => {
    const q = new URL(route.request().url()).searchParams.get("q") ?? "";
    asked.push(q);
    if (q === "Nulle part") return route.fulfill({ json: [] });
    if (q === "Panne") return route.fulfill({ status: 502, json: { detail: "address search unavailable" } });
    return route.fulfill({ json: RESULTS });
  });
  return asked;
}

/** The zone being drawn (orange circle), once the map has flown to it. */
async function draftCircleCentre(page: Page) {
  const circle = page.locator('path[stroke="#f59e0b"]');
  await expect(circle).toBeVisible();
  let previous = "";
  await expect
    .poll(async () => {
      const box = await circle.boundingBox();
      const now = JSON.stringify(box);
      const settled = now === previous;
      previous = now;
      return settled;
    })
    .toBe(true);
  const box = (await circle.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test("place a zone by its address (French UI)", async ({ browser }) => {
  const ctx = await openContext(browser, { locale: "fr-FR" });
  await signIn(ctx, newAccount("Léa"), "register", "fr");
  const page = await ctx.newPage();
  const asked = await mockGeocode(page);

  await page.goto("/me/zones/new");
  const input = page.getByTestId("zone-address-input");
  await expect(page.getByText("Adresse", { exact: true })).toBeVisible();
  // Nothing typed, nothing to search: never as one types either.
  await expect(page.getByTestId("zone-address-search")).toBeDisabled();
  await input.pressSequentially("Nulle", { delay: 20 });
  expect(asked).toEqual([]);

  // Enter searches and does not save the place.
  await input.fill("Nulle part");
  await input.press("Enter");
  await expect(page.getByTestId("zone-address-none")).toHaveText("Aucun résultat pour « Nulle part ». Ajoutez la ville ou le code postal.");
  await expect(page).toHaveURL(/\/me\/zones\/new$/);

  await input.fill("Panne");
  await page.getByTestId("zone-address-search").click();
  await expect(page.getByTestId("zone-address-error")).toHaveText("La recherche d’adresse ne répond pas. Réessayez dans un instant.");

  await input.fill(ADDRESS);
  await input.press("Enter");
  const results = page.getByTestId("zone-address-result");
  await expect(results).toHaveCount(5);
  await expect(page.getByTestId("zone-address-error")).toHaveCount(0);
  await expect(results.first()).toContainText("1 Stephansplatz");
  await expect(results.first()).toContainText("Innere Stadt, Wien");
  await expect(page.getByRole("link", { name: "Adresses © les contributeurs d’OpenStreetMap" })).toBeVisible();
  expect(asked).toEqual(["Nulle part", "Panne", ADDRESS]);

  // Picking one places the zone there, names it, and brings it into view beside the panel.
  await results.first().click();
  await expect(results).toHaveCount(0);
  await expect(input).toHaveValue(ADDRESS);
  await expect(page.locator('input[name="zone-name"]')).toHaveValue("1 Stephansplatz");
  await expect(page.getByTestId("zone-place")).toHaveText("1 Stephansplatz, Innere Stadt, Wien, 1010, Österreich");
  await expect(page.getByTestId("zone-place").locator("strong")).toHaveText("1 Stephansplatz");
  await expect(page.getByTestId("zone-center")).toContainText("48.20843, 16.37315");
  const panel = (await page.locator(".panel").boundingBox())!;
  const centre = await draftCircleCentre(page);
  expect(centre.x).toBeGreaterThan(panel.x + panel.width);
  expect(centre.y).toBeGreaterThan(0);
  expect(centre.y).toBeLessThan(800);

  await page.getByTestId("zone-save").click();
  const item = page.locator('[data-testid^="zone-item-"]');
  await expect(item).toContainText("1 Stephansplatz");
  let zones = await (await ctx.request.get("/api/zones")).json();
  expect(zones).toHaveLength(1);
  expect(zones[0]).toMatchObject({ name: "1 Stephansplatz", lat: 48.2084263, lon: 16.3731453 });

  // Moved by address later: a name already given is kept.
  await item.click();
  await page.locator('input[name="zone-name"]').fill("Bureau");
  await page.getByTestId("zone-address-input").fill("stephansdom wien");
  await page.getByTestId("zone-address-search").click();
  await results.nth(3).click();
  await expect(page.locator('input[name="zone-name"]')).toHaveValue("Bureau");
  await expect(page.getByTestId("zone-center")).toContainText("48.20850, 16.37300");
  await expect(page.getByTestId("zone-place")).toContainText("Stephansdom, 3, Stephansplatz");
  // Placed on the map instead, the zone has no address any more.
  const map = page.locator(".map");
  const mapBox = (await map.boundingBox())!;
  await map.click({ position: { x: mapBox.width - 200, y: 200 } });
  await expect(page.getByTestId("zone-place")).toHaveCount(0);
  await page.getByTestId("zone-address-search").click();
  await results.nth(3).click();
  await page.getByTestId("zone-save").click();
  await expect(item).toContainText("Bureau");
  zones = await (await ctx.request.get("/api/zones")).json();
  expect(zones[0]).toMatchObject({ name: "Bureau", lat: 48.2085, lon: 16.373 });
  await ctx.close();
});

// The editor on a phone (bottom sheet) and on a tablet both ways (side panel), touch screens.
const SIZES = [
  { name: "mobile", viewport: { width: 390, height: 844 }, userAgent: devices["iPhone 13"].userAgent },
  { name: "tablet-portrait", viewport: { width: 820, height: 1180 }, userAgent: devices["iPad (gen 7)"].userAgent },
  { name: "tablet-landscape", viewport: { width: 1180, height: 820 }, userAgent: devices["iPad (gen 7)"].userAgent },
];

for (const size of SIZES) {
  test(`address search fits a ${size.name} touch screen`, async ({ browser }) => {
    const ctx = await browser.newContext({
      baseURL,
      viewport: size.viewport,
      userAgent: size.userAgent,
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      locale: "fr-FR",
    });
    await stubTiles(ctx);
    await signIn(ctx, newAccount("Tactile"), "register", "fr");
    const page = await ctx.newPage();
    await mockGeocode(page);
    const shot = (step: string) => page.screenshot({ path: `screenshots/zone-address/${size.name}-${step}.png` });

    await page.goto("/me/zones/new");
    const input = page.getByTestId("zone-address-input");
    const button = page.getByTestId("zone-address-search");
    await expect(input).toBeInViewport();
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
    await shot("1-empty");

    await input.fill(ADDRESS);
    await input.press("Enter");
    const results = page.getByTestId("zone-address-result");
    await expect(results).toHaveCount(5);
    // The keyboard is put away, and the results scroll into the visible part of the sheet or panel.
    await expect(input).not.toBeFocused();
    await expect(results.first()).toBeInViewport({ ratio: 1 });
    const header = (await page.locator(".panel-header").boundingBox())!;
    const first = (await results.first().boundingBox())!;
    expect(first.y).toBeGreaterThanOrEqual(header.y + header.height - 1);
    await shot("2-results");

    // Nothing wider than the screen, nothing too small to tap.
    const overflow = await page.evaluate(() =>
      [document.documentElement, ...document.querySelectorAll<HTMLElement>(".panel-scroll, .address-search, .address-results .list")]
        .filter((el) => el.scrollWidth > el.clientWidth + 1)
        .map((el) => el.className || el.tagName),
    );
    expect(overflow).toEqual([]);
    const search = (await page.locator(".address-search").boundingBox())!;
    const scroller = (await page.locator(".panel-scroll").boundingBox())!;
    expect(search.x + search.width).toBeLessThanOrEqual(scroller.x + scroller.width);
    for (const target of [input, button, ...(await results.all()), page.locator(".address-credit a")]) {
      const box = (await target.boundingBox())!;
      expect(box.height, await target.evaluate((el) => el.outerHTML.slice(0, 80))).toBeGreaterThanOrEqual(40);
    }
    // Titles fit; long details are cut with an ellipsis, not clipped mid-letter.
    for (const title of await page.locator(".address-results .row-title").all()) {
      expect(await title.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    }

    await results.first().tap();
    await expect(results).toHaveCount(0);
    await expect(page.locator('input[name="zone-name"]')).toHaveValue("1 Stephansplatz");
    await expect(page.getByTestId("zone-center")).toContainText("48.20843, 16.37315");
    const centre = await draftCircleCentre(page);
    // The circle lands in the part of the map left visible by the panel or the sheet.
    const cover = (await page.locator(size.name === "mobile" ? ".sheet" : ".panel").boundingBox())!;
    if (size.name === "mobile") expect(centre.y).toBeLessThan(cover.y);
    else expect(centre.x).toBeGreaterThan(cover.x + cover.width);
    await shot("3-picked");
    await ctx.close();
  });
}
