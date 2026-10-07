import { test as base, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

// 1×1 transparent PNG: map tiles are stubbed so tests never hit the network.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

export const baseURL = `http://localhost:${process.env.E2E_PORT ?? 8766}`;

let seq = 0;

export type Account = { email: string; password: string; name: string };

export function newAccount(name: string): Account {
  return { email: `${name.toLowerCase()}.${Date.now()}.${++seq}@example.com`, password: "correct horse battery", name };
}

export type Geo = { latitude: number; longitude: number; accuracy?: number };

export async function openContext(
  browser: Browser,
  opts: { geolocation?: Geo; locale?: string; viewport?: { width: number; height: number } } = {},
): Promise<BrowserContext> {
  const context = await browser.newContext({
    baseURL,
    locale: opts.locale ?? "en-US",
    permissions: opts.geolocation ? ["geolocation"] : [],
    geolocation: opts.geolocation ? { accuracy: 10, ...opts.geolocation } : undefined,
    viewport: opts.viewport ?? { width: 1280, height: 800 },
  });
  await stubTiles(context);
  return context;
}

/** Map tiles answered locally, for contexts made by Playwright (a project's `page`). */
export async function stubTiles(context: BrowserContext) {
  await context.route(/tile\.openstreetmap\.org/, (route) => route.fulfill({ status: 200, contentType: "image/png", body: PNG }));
}

/** Register (or log in) through the API; the session cookie lands in the context. */
export async function signIn(context: BrowserContext, account: Account, mode: "register" | "login", locale = "en") {
  const body =
    mode === "register"
      ? { email: account.email, password: account.password, display_name: account.name, locale }
      : { email: account.email, password: account.password };
  const res = await context.request.post(`/api/auth/${mode}`, { data: body });
  expect(res.ok(), await res.text()).toBeTruthy();
}

/** Turn this browser into a reporting device from Settings ("Me" › gear). */
export async function registerThisDevice(page: Page, name = "Test phone") {
  await page.goto("/settings");
  await page.getByTestId("this-device").locator('input[name="device-name"]').fill(name);
  await page.getByTestId("btn-register-device").click();
  await expect(page.getByTestId("reporter-status")).toHaveAttribute("data-state", "active");
}

export async function deviceIdFromList(page: Page, name: string): Promise<string> {
  await page.goto("/devices");
  const item = page.locator('[data-testid^="device-item-"]', { hasText: name });
  await expect(item).toBeVisible();
  const testId = await item.getAttribute("data-testid");
  return testId!.replace("device-item-", "");
}

/** A device added through the API, reporting with its own token (no browser geolocation needed). */
export async function apiDevice(
  context: BrowserContext,
  name: string,
  opts: { kind?: "browser" | "owntracks"; icon?: string } = {},
): Promise<{ id: string; token: string }> {
  const res = await context.request.post("/api/devices", { data: { name, kind: opts.kind ?? "browser", icon: opts.icon ?? "phone" } });
  expect(res.ok(), await res.text()).toBeTruthy();
  const { device, device_token } = await res.json();
  return { id: device.id, token: device_token };
}

export async function reportAt(context: BrowserContext, device: { token: string }, latitude: number, longitude: number) {
  const res = await context.request.post("/api/report/locations", {
    data: { fixes: [{ ts: new Date().toISOString(), lat: latitude, lon: longitude, accuracy: 12 }] },
    headers: { Authorization: `Bearer ${device.token}` },
  });
  expect(res.status()).toBe(202);
}

/** `owner` shares their location with `recipient`, who accepts. */
export async function shareWith(owner: BrowserContext, recipient: BrowserContext, recipientEmail: string) {
  const share = await owner.request.post("/api/shares", { data: { recipient_email: recipientEmail } });
  expect(share.ok(), await share.text()).toBeTruthy();
  expect((await recipient.request.post(`/api/shares/${(await share.json()).id}/accept`)).ok()).toBeTruthy();
}

/** A square profile photo of one colour, drawn by the browser and uploaded. */
export async function setPhoto(page: Page, colour: string) {
  const bytes = await page.evaluate(async (fill) => {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = "rgb(255 255 255 / 0.85)";
    ctx.beginPath();
    ctx.arc(128, 100, 52, 0, Math.PI * 2);
    ctx.arc(128, 300, 110, 0, Math.PI * 2);
    ctx.fill();
    const blob = await new Promise<Blob>((resolve) => c.toBlob((b) => resolve(b!), "image/png"));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  }, colour);
  const res = await page.context().request.put("/api/me/avatar", {
    multipart: { file: { name: "me.png", mimeType: "image/png", buffer: Buffer.from(bytes) } },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}

export const test = base;
export { expect };
