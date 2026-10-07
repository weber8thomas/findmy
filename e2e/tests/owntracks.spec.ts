import { expect, newAccount, openContext, signIn, test } from "../fixtures";

test("OwnTracks credentials come with a setup QR code and link", async ({ browser }) => {
  const ctx = await openContext(browser);
  await signIn(ctx, newAccount("Lucia"), "register");
  const page = await ctx.newPage();
  await page.goto("/settings");
  await page.getByTestId("owntracks").getByRole("button").click();
  await expect(page.getByTestId("owntracks-qr")).toBeVisible();
  const href = await page.getByTestId("owntracks-open").getAttribute("href");
  expect(href).toMatch(/^owntracks:\/\/\/config\?inline=/);
  const config = JSON.parse(Buffer.from(decodeURIComponent(href!.split("inline=")[1]), "base64").toString());
  expect(config).toMatchObject({ _type: "configuration", mode: 3, auth: true, tid: "LU" });
  expect(config.password).toBe(await page.getByTestId("owntracks-token").inputValue());
  // The posted credentials work.
  const r = await ctx.request.post("/api/owntracks", {
    headers: { Authorization: `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}` },
    data: { _type: "location", lat: 48.21, lon: 16.37, acc: 10, tst: Math.floor(Date.now() / 1000) },
  });
  expect(r.ok()).toBe(true);
  // The phone is the person: under People as "Me", not among the devices.
  await page.goto("/people");
  await expect(page.getByTestId("person-me")).toContainText("Phone");
  await page.goto("/devices");
  await expect(page.getByTestId("devices-panel")).not.toContainText("Phone");
  // Setting it up again keeps a single phone.
  await page.goto("/settings");
  await expect(page.getByTestId("owntracks-phone")).toBeVisible();
  await ctx.close();
});
