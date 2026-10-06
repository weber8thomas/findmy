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

test("history shows past positions", async ({ browser }) => {
  const acc = newAccount("Hist");
  const ctx = await openContext(browser);
  await signIn(ctx, acc, "register");
  const res = await ctx.request.post("/api/devices", { data: { name: "Bike", kind: "browser", icon: "tag" } });
  const { device, device_token } = await res.json();
  const now = Date.now();
  const fixes = Array.from({ length: 12 }, (_, i) => ({
    ts: new Date(now - (12 - i) * 5 * 60_000).toISOString(),
    lat: 48.85 + i * 0.001,
    lon: 2.35,
    accuracy: 8,
  }));
  const report = await ctx.request.post("/api/report/locations", {
    data: { fixes },
    headers: { Authorization: `Bearer ${device_token}` },
  });
  expect(report.status()).toBe(202);
  const page = await ctx.newPage();
  await page.goto(`/devices/${device.id}`);
  await page.getByTestId("btn-history").click();
  await expect(page.getByTestId("history-count")).toContainText("12 positions");
  await expect(page.locator("path.history-point")).toHaveCount(12);
  await ctx.close();
});
