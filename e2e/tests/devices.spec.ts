import type { Locator } from "@playwright/test";
import { deviceIdFromList, expect, newAccount, openContext, registerThisDevice, signIn, test } from "../fixtures";

const EIFFEL = { latitude: 48.8584, longitude: 2.2945 };
const LOUVRE = { latitude: 48.8606, longitude: 2.3376 };

test("register through the UI and land on an empty device list", async ({ browser }) => {
  const ctx = await openContext(browser);
  const page = await ctx.newPage();
  const acc = newAccount("Ui");
  await page.goto("/register");
  await page.locator('input[name="display_name"]').fill(acc.name);
  await page.locator('input[name="email"]').fill(acc.email);
  await page.locator('input[name="password"]').fill(acc.password);
  await page.getByTestId("auth-submit").click();
  await expect(page.getByTestId("devices-panel")).toBeVisible();
  await expect(page.getByText(/No devices yet/)).toBeVisible();
  await ctx.close();
});

test("live location, play sound and lost mode between two browsers", async ({ browser }) => {
  const acc = newAccount("Alice");
  // Browser 1: the phone being tracked.
  const trackerCtx = await openContext(browser, { geolocation: EIFFEL });
  await signIn(trackerCtx, acc, "register");
  const tracker = await trackerCtx.newPage();
  await registerThisDevice(tracker, "Alice phone");
  await expect(tracker.getByTestId("sharing-indicator")).toBeVisible();

  // Browser 2: the same user looking for the phone from a laptop.
  const viewerCtx = await openContext(browser);
  await signIn(viewerCtx, acc, "login");
  const viewer = await viewerCtx.newPage();
  const deviceId = await deviceIdFromList(viewer, "Alice phone");
  await expect(viewer.getByTestId(`marker-device-${deviceId}`)).toBeVisible();
  await viewer.getByTestId(`device-item-${deviceId}`).click();
  await expect(viewer.getByTestId("device-coords")).toContainText("48.858");
  await expect(viewer.getByTestId("device-detail")).toContainText("Online");

  // The phone moves: the viewer sees it without reloading.
  await trackerCtx.setGeolocation({ ...LOUVRE, accuracy: 10 });
  await expect(viewer.getByTestId("device-coords")).toContainText("48.860", { timeout: 15_000 });

  // Play a sound.
  await viewer.getByTestId("btn-play-sound").click();
  await expect(tracker.getByTestId("sound-overlay")).toBeVisible();
  await expect.poll(() => tracker.evaluate(() => (window as any).__locusSound.plays)).toBeGreaterThan(0);
  await expect(viewer.getByTestId("command-status")).toHaveAttribute("data-status", "acked");
  await tracker.getByTestId("sound-stop").click();
  await expect(tracker.getByTestId("sound-overlay")).toBeHidden();

  // Lost mode.
  await viewer.getByTestId("btn-lost-mode").click();
  await viewer.locator('textarea[name="lost-message"]').fill("Please call me, reward!");
  await viewer.locator('input[name="lost-phone"]').fill("+33 6 12 34 56 78");
  await viewer.getByTestId("lost-enable").click();
  await expect(tracker.getByTestId("lost-overlay")).toContainText("Please call me, reward!");
  await expect(tracker.getByTestId("lost-call")).toHaveAttribute("href", "tel:+33612345678");
  await tracker.reload();
  await expect(tracker.getByTestId("lost-overlay")).toBeVisible();
  await expect(viewer.getByTestId("lost-banner")).toBeVisible();
  await viewer.getByTestId("btn-lost-mode").click();
  await viewer.getByTestId("lost-disable").click();
  await expect(tracker.getByTestId("lost-overlay")).toBeHidden();

  // Closing the tracker makes the device go offline for the viewer.
  await tracker.close();
  await expect(viewer.getByTestId("device-detail")).toContainText("Seen", { timeout: 15_000 });

  await trackerCtx.close();
  await viewerCtx.close();
});

test("history tells the stops and moves, and where the device was at a picked moment", async ({ browser }) => {
  const acc = newAccount("Hist");
  const ctx = await openContext(browser);
  await signIn(ctx, acc, "register");
  const res = await ctx.request.post("/api/devices", { data: { name: "Bike", kind: "browser", icon: "tag" } });
  const { device, device_token } = await res.json();
  const zone = await ctx.request.post("/api/zones", { data: { name: "Home", lat: 48.85, lon: 2.35, radius_m: 100 } });
  expect(zone.ok(), await zone.text()).toBeTruthy();
  // Home for half an hour, 1.1 km north in 25 minutes, there since.
  const now = Date.now();
  const fix = (minutesAgo: number, lat: number) => ({ ts: new Date(now - minutesAgo * 60_000).toISOString(), lat, lon: 2.35, accuracy: 8 });
  const fixes = [
    ...[95, 85, 75, 65].map((m) => fix(m, 48.85)),
    ...[60, 55, 50, 45].map((m, k) => fix(m, 48.85 + (k + 1) * 0.002)),
    ...[40, 30, 20, 10].map((m) => fix(m, 48.86)),
  ];
  const report = await ctx.request.post("/api/report/locations", {
    data: { fixes },
    headers: { Authorization: `Bearer ${device_token}` },
  });
  expect(report.status()).toBe(202);
  const page = await ctx.newPage();
  await page.goto(`/devices/${device.id}`);
  await page.getByTestId("btn-history").click();
  await expect(page.getByTestId("history-count")).toContainText("12 positions");
  await expect(page.getByTestId("history-summary")).toContainText("1.1 km");
  await expect(page.getByTestId("history-summary")).toContainText("2 stops");
  await expect(page.locator("path.history-point")).toHaveCount(12);

  // The journey: numbered stops, named after the place they are at, and the move between them.
  await expect(page.getByTestId("journey-stop-1")).toContainText("Home");
  await expect(page.getByTestId("journey-stop-1")).toContainText("30 min");
  await expect(page.getByTestId("journey-move")).toContainText("Move · 1.1 km · 25 min");
  await expect(page.getByTestId("journey-stop-2")).toContainText(/Stop\s*since\s.*\s·\s40\smin/);
  await expect(page.getByTestId("history-stop-1")).toBeVisible();
  await expect(page.getByTestId("history-stop-2")).toBeVisible();
  await expect(page.locator(".history-arrow").first()).toBeAttached();

  // Pick a moment: the panel and a ring on the map show where the device was then.
  const slider = page.getByTestId("history-slider");
  const label = page.getByTestId("history-label");
  const timeOf = (i: number) =>
    page.evaluate((ts) => new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(ts)), fixes[i].ts);
  await expect(page.getByTestId("history-picked")).toContainText("Slide to see");
  await expect(page.getByTestId("history-pick")).toHaveCount(0);
  await page.getByTestId("history-older").click();
  await expect(slider).toHaveValue("11");
  await expect(label).toContainText(await timeOf(11));
  await expect(label).toContainText("±8 m");

  await slider.focus();
  await page.keyboard.press("Home");
  await expect(slider).toHaveValue("0");
  await expect(page.getByTestId("history-picked")).toContainText(await timeOf(0));
  await expect.poll(() => distance(page.getByTestId("history-pick"), page.locator("path.history-point").first())).toBeLessThan(3);

  // Clicking a point of the trace on the map picks it.
  await page.locator("path.history-point").nth(4).click();
  await expect(slider).toHaveValue("4");
  await expect(label).toContainText(await timeOf(4));
  await expect(page.getByTestId("history-picked")).toContainText(await timeOf(4));

  // So does a time in the list of all positions (folded, newest first).
  await page.getByTestId("history-all").locator("summary").click();
  await page.locator(".timeline button").nth(2).click();
  await expect(slider).toHaveValue("9");

  // A click away from the trace clears it.
  await page.mouse.click(1150, 400);
  await expect(page.getByTestId("history-pick")).toHaveCount(0);
  await expect(page.getByTestId("history-picked")).toContainText("Slide to see");

  // A stop's number on the map, or its row, picks when it began.
  await page.getByTestId("history-stop-1").click();
  await expect(slider).toHaveValue("0");
  await expect(page.getByTestId("journey-stop-1").getByRole("button")).toHaveAttribute("aria-current", "true");
  await page.getByTestId("journey-stop-2").click();
  await expect(slider).toHaveValue("8");
  await expect(label).toContainText(await timeOf(8));
  await expect(page.getByTestId("journey-stop-2").getByRole("button")).toHaveAttribute("aria-current", "true");
  await ctx.close();
});

async function distance(a: Locator, b: Locator): Promise<number> {
  const [ba, bb] = [await a.boundingBox(), await b.boundingBox()];
  if (!ba || !bb) return Infinity;
  return Math.hypot(ba.x + ba.width / 2 - (bb.x + bb.width / 2), ba.y + ba.height / 2 - (bb.y + bb.height / 2));
}
