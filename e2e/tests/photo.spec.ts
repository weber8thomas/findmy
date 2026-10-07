import type { Page } from "@playwright/test";
import { expect, newAccount, openContext, signIn, test } from "../fixtures";

/** A 640×480 PNG drawn by the browser, as a phone photo would be picked. */
async function picture(page: Page): Promise<Buffer> {
  const bytes = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 640;
    c.height = 480;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#e0602a";
    ctx.fillRect(0, 0, 640, 480);
    const blob = await new Promise<Blob>((resolve) => c.toBlob((b) => resolve(b!), "image/png"));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  return Buffer.from(bytes);
}

const loadedSize = (page: Page, selector: string) =>
  page.locator(selector).evaluate((img: HTMLImageElement) => (img.complete ? [img.naturalWidth, img.naturalHeight] : [0, 0]));

test("profile photo: added in Me › Edit, seen by a person you share with, removed", async ({ browser }) => {
  const alice = newAccount("Alice");
  const bob = newAccount("Bob");
  const aliceCtx = await openContext(browser);
  await signIn(aliceCtx, alice, "register");
  const a = await aliceCtx.newPage();
  await a.goto("/me");
  // Me only shows the profile: changing it takes Edit.
  await expect(a.getByTestId("profile")).toContainText("Alice");
  await expect(a.getByTestId("photo-input")).toHaveCount(0);
  await a.getByTestId("btn-edit-profile").click();
  await expect(a).toHaveURL(/\/me\/profile$/);

  const section = a.getByTestId("profile-photo");
  await expect(section.getByTestId("avatar")).toHaveText("A");
  await section.getByTestId("photo-input").setInputFiles({ name: "me.png", mimeType: "image/png", buffer: await picture(a) });

  // Cropped and scaled in the browser: a 256 px square JPEG.
  const img = '[data-testid="profile-photo"] img.avatar-img';
  await expect.poll(() => loadedSize(a, img)).toEqual([256, 256]);
  const src = await a.locator(img).getAttribute("src");
  expect(src).toMatch(/^\/api\/users\/\w+\/avatar\?v=\d+$/);
  const served = await aliceCtx.request.get(src!);
  expect(served.headers()["content-type"]).toBe("image/jpeg");
  await expect(section.getByTestId("btn-photo-pick")).toHaveText("Change");

  // Not for strangers.
  const bobCtx = await openContext(browser);
  await signIn(bobCtx, bob, "register");
  expect((await bobCtx.request.get(src!)).status()).toBe(404);

  // Alice shares with Bob: her photo is in his People list.
  const share = await aliceCtx.request.post("/api/shares", { data: { recipient_email: bob.email } });
  expect(share.ok()).toBe(true);
  expect((await bobCtx.request.post(`/api/shares/${(await share.json()).id}/accept`)).ok()).toBe(true);
  const b = await bobCtx.newPage();
  await b.goto("/people");
  const row = b.locator('[data-testid^="person-item-"]', { hasText: "Alice" });
  await expect(row.locator("img.avatar-img")).toHaveAttribute("src", src!);
  await expect.poll(() => loadedSize(b, '[data-testid^="person-item-"] img.avatar-img')).toEqual([256, 256]);

  // Removing asks again; cancelled, the photo stays.
  await section.getByTestId("btn-photo-remove").click();
  await section.getByRole("button", { name: "Cancel" }).click();
  await expect(section.locator("img.avatar-img")).toHaveCount(1);
  // Removed: back to the initials.
  await section.getByTestId("btn-photo-remove").click();
  await section.getByTestId("btn-photo-remove-confirm").click();
  await expect(section.getByTestId("avatar")).toHaveText("A");
  await expect(section.locator("img")).toHaveCount(0);

  await aliceCtx.close();
  await bobCtx.close();
});

test("the name only changes with Save, on its own page", async ({ browser }) => {
  const ctx = await openContext(browser);
  await signIn(ctx, newAccount("Alice"), "register");
  const page = await ctx.newPage();
  await page.goto("/me/profile");
  const name = page.getByTestId("display-name");
  const save = page.getByTestId("btn-save-name");
  await expect(save).toBeDisabled();
  await name.fill("   ");
  await expect(save).toBeDisabled();
  // Cancel leaves it as it was.
  await name.fill("Alicia");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page).toHaveURL(/\/me$/);
  await expect(page.getByTestId("profile")).toContainText("Alice");
  await expect(page.getByTestId("profile")).not.toContainText("Alicia");
  // Saved: back on Me with the new name.
  await page.getByTestId("btn-edit-profile").click();
  await page.getByTestId("display-name").fill("Alicia");
  await page.getByTestId("btn-save-name").click();
  await expect(page).toHaveURL(/\/me$/);
  await expect(page.getByTestId("profile")).toContainText("Alicia");
  await ctx.close();
});
