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
  await context.route(/tile\.openstreetmap\.org/, (route) => route.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  return context;
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

/** Turn this browser into a reporting device from the "Me" tab. */
export async function registerThisDevice(page: Page, name = "Test phone") {
  await page.goto("/me");
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

export const test = base;
export { expect };
