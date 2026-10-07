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

test("profile photo: added in Me, seen by a person you share with, removed", async ({ browser }) => {
  const alice = newAccount("Alice");
  const bob = newAccount("Bob");
  const aliceCtx = await openContext(browser);
  await signIn(aliceCtx, alice, "register");
  const a = await aliceCtx.newPage();
  await a.goto("/me");

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

  // Removed: back to the initials.
  await section.getByTestId("btn-photo-remove").click();
  await expect(section.getByTestId("avatar")).toHaveText("A");
  await expect(section.locator("img")).toHaveCount(0);

  await aliceCtx.close();
  await bobCtx.close();
});
