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
