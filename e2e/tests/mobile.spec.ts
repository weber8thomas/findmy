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
