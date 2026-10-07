import { expect, newAccount, test } from "../fixtures";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

test("mobile layout: bottom sheet and tab bar", async ({ page, context }) => {
  await context.route(/tile\.openstreetmap\.org/, (r) => r.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  const acc = newAccount("Mobile");
  const res = await context.request.post("/api/auth/register", {
    data: { email: acc.email, password: acc.password, display_name: acc.name },
  });
  expect(res.ok()).toBeTruthy();
  await page.goto("/devices");
  const sheet = page.getByTestId("bottom-sheet");
  await expect(sheet).toBeVisible();
  await expect(page.getByTestId("devices-panel")).toBeVisible();
  await page.getByTestId("tab-people").click();
  await expect(page).toHaveURL(/\/people$/);
  await expect(page.getByTestId("people-panel")).toBeVisible();
  // Tapping the handle cycles the sheet height.
  const before = await sheet.getAttribute("data-snap");
  await sheet.locator(".sheet-handle").click();
  await expect(sheet).not.toHaveAttribute("data-snap", before!);
});

test("the sheet stays where it's let go, from its title to over the whole map", async ({ page, context }) => {
  await context.route(/tile\.openstreetmap\.org/, (r) => r.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  const acc = newAccount("Sheet");
  const res = await context.request.post("/api/auth/register", {
    data: { email: acc.email, password: acc.password, display_name: acc.name },
  });
  expect(res.ok()).toBeTruthy();
  await page.goto("/people");
  const sheet = page.getByTestId("bottom-sheet");
  await expect(page.getByTestId("people-panel")).toBeVisible();
  await expect(sheet).toHaveAttribute("data-snap", "half");
  const top = async () => (await sheet.boundingBox())!.y;
  const tabbar = (await page.locator(".tabbar").boundingBox())!;
  const x = (await sheet.boundingBox())!.width / 2;
  // A finger moved, then held still before letting go (`hold`), or flicked (no hold).
  const drag = async (from: number, to: number, hold = true) => {
    await page.mouse.move(x, from);
    await page.mouse.down();
    await page.mouse.move(x, to, { steps: hold ? 12 : 2 });
    if (hold) await page.waitForTimeout(200);
    await page.mouse.up();
  };
  const settled = async () => {
    await expect(sheet).not.toHaveClass(/is-dragging/);
    await page.waitForTimeout(400);
    return top();
  };

  // By the handle, anywhere: it stays there.
  let before = await top();
  await drag(before + 10, 300);
  await expect(sheet).toHaveAttribute("data-snap", "free");
  expect(Math.abs((await settled()) - (300 - 10))).toBeLessThan(3);

  // By the title bar, up to the top: the map is hidden.
  const header = (await sheet.locator(".panel-header").boundingBox())!;
  await drag(header.y + 20, 30);
  await expect(sheet).toHaveAttribute("data-snap", "full");
  await expect(sheet).toHaveClass(/is-top/);
  expect(await settled()).toBeLessThan(1);

  // A flick down goes to the next stop, half way.
  await drag(10, 200, false);
  await expect(sheet).toHaveAttribute("data-snap", "half");

  // The page itself pulled down from its top (a finger, not a mouse) lowers the sheet.
  before = await settled();
  const cdp = await context.newCDPSession(page);
  const finger = (type: string, y?: number) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: y == null ? [] : [{ x, y }] });
  const y0 = before + 140;
  await finger("touchStart", y0);
  for (let i = 1; i <= 10; i++) await finger("touchMove", y0 + i * 15);
  await page.waitForTimeout(200);
  await finger("touchEnd");
  await expect(sheet).toHaveAttribute("data-snap", "free");
  expect(Math.abs((await settled()) - (before + 150))).toBeLessThan(3);

  // Down near the tab bar it lands on its title, still showing; a tap on the handle raises it.
  await drag(before + 160, tabbar.y - 60);
  await expect(sheet).toHaveAttribute("data-snap", "peek");
  const peek = (await sheet.boundingBox())!;
  expect(Math.round(peek.height)).toBe(80);
  await expect(sheet.locator(".panel-header h2")).toBeInViewport({ ratio: 1 });
  await sheet.locator(".sheet-handle").click();
  await expect(sheet).toHaveAttribute("data-snap", "half");

  // Over the whole map, opening something to see on it brings the sheet down half way.
  const created = await context.request.post("/api/devices", { data: { name: "Bike", kind: "browser", icon: "laptop" } });
  const { device, device_token } = await created.json();
  const report = await context.request.post("/api/report/locations", {
    data: { fixes: [{ ts: new Date().toISOString(), lat: 48.85, lon: 2.35, accuracy: 15 }] },
    headers: { Authorization: `Bearer ${device_token}` },
  });
  expect(report.status()).toBe(202);
  await page.getByTestId("tab-devices").click();
  await drag((await settled()) + 10, 20);
  await expect(sheet).toHaveAttribute("data-snap", "full");
  await page.getByTestId(`device-item-${device.id}`).click();
  await expect(page).toHaveURL(new RegExp(`/devices/${device.id}$`));
  await expect(sheet).toHaveAttribute("data-snap", "half");
});

test("installed on an iPhone, nothing hides under the status bar or the home indicator", async ({ page, context }) => {
  await context.route(/tile\.openstreetmap\.org/, (r) => r.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  const acc = newAccount("Notch");
  const res = await context.request.post("/api/auth/register", {
    data: { email: acc.email, password: acc.password, display_name: acc.name },
  });
  expect(res.ok()).toBeTruthy();
  // An iPhone with a Dynamic Island, opened from the home screen.
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 59, bottom: 34 } });
  await page.goto("/people");
  await expect(page.getByTestId("people-panel")).toBeVisible();
  const vh = page.viewportSize()!.height;

  const buttons = (await page.locator(".map-buttons").boundingBox())!;
  expect(buttons.y).toBeGreaterThanOrEqual(59 + 12 - 0.5);
  const tabbar = (await page.locator(".tabbar").boundingBox())!;
  expect(Math.round(tabbar.y + tabbar.height)).toBe(vh);
  expect(Math.round(tabbar.height)).toBe(60 + 34);
  const sheet = page.getByTestId("bottom-sheet");
  const box = (await sheet.boundingBox())!;
  expect(Math.round(box.y + box.height)).toBe(Math.round(tabbar.y));

  // All the way up, the sheet stops under the status bar.
  await sheet.locator(".sheet-handle").click();
  await expect(sheet).toHaveAttribute("data-snap", "full");
  await expect(sheet).toHaveClass(/is-top/);
  await page.waitForTimeout(400);
  expect(Math.round((await sheet.boundingBox())!.y)).toBe(59);
});

test("mobile history: tap the trace to see when the device was there", async ({ page, context }) => {
  await context.route(/tile\.openstreetmap\.org/, (r) => r.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  const acc = newAccount("MobileHist");
  const res = await context.request.post("/api/auth/register", {
    data: { email: acc.email, password: acc.password, display_name: acc.name },
  });
  expect(res.ok()).toBeTruthy();
  const created = await context.request.post("/api/devices", { data: { name: "Bike", kind: "browser", icon: "tag" } });
  const { device, device_token } = await created.json();
  const now = Date.now();
  const fixes = Array.from({ length: 6 }, (_, i) => ({
    ts: new Date(now - (6 - i) * 10 * 60_000).toISOString(),
    lat: 48.85 + i * 0.002,
    lon: 2.35,
    accuracy: 15,
  }));
  const report = await context.request.post("/api/report/locations", {
    data: { fixes },
    headers: { Authorization: `Bearer ${device_token}` },
  });
  expect(report.status()).toBe(202);

  await page.goto(`/devices/${device.id}/history`);
  await expect(page.locator("path.history-point")).toHaveCount(6);
  await page.locator("path.history-point").nth(2).tap();
  await expect(page.getByTestId("history-label")).toContainText("±15 m");
  await expect(page.getByTestId("history-slider")).toHaveValue("2");
});
