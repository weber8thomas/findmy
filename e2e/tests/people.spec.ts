import { expect, newAccount, openContext, registerThisDevice, signIn, test } from "../fixtures";

const HOME = { latitude: 48.8584, longitude: 2.2945 };
const FAR = { latitude: 48.8700, longitude: 2.2945 };

test("share location with another person, see updates, stop sharing", async ({ browser }) => {
  const alice = newAccount("Alice");
  const bob = newAccount("Bob");

  const aliceCtx = await openContext(browser, { geolocation: HOME });
  await signIn(aliceCtx, alice, "register");
  const a = await aliceCtx.newPage();
  await registerThisDevice(a, "Alice phone");

  const bobCtx = await openContext(browser);
  await signIn(bobCtx, bob, "register");
  const b = await bobCtx.newPage();
  await b.goto("/people");
  await expect(b.getByText(/Nobody shares/)).toBeVisible();

  // Alice shares with Bob.
  await a.goto("/people");
  await a.getByTestId("btn-share-location").click();
  await a.locator('input[name="share-email"]').fill(bob.email);
  await a.getByTestId("share-submit").click();
  await expect(a.locator('[data-testid^="person-item-"]')).toContainText("Invitation sent");

  // Bob gets the invitation live, accepts, and sees Alice on the map.
  await expect(b.getByTestId("invitations")).toContainText("Alice");
  await b.getByTestId("invite-accept").click();
  const person = b.locator('[data-testid^="person-item-"]', { hasText: "Alice" });
  await expect(person).toBeVisible();
  const personId = (await person.getAttribute("data-testid"))!.replace("person-item-", "");
  await expect(b.getByTestId(`marker-person-${personId}`)).toBeVisible();
  await person.click();
  await expect(b.getByTestId("person-coords")).toContainText("48.858");

  // Alice's "visible to" indicator names Bob.
  await expect(a.getByTestId("sharing-indicator")).toContainText("Bob");

  // Alice moves: Bob's view follows.
  await aliceCtx.setGeolocation({ ...FAR, accuracy: 10 });
  await expect(b.getByTestId("person-coords")).toContainText("48.870", { timeout: 15_000 });

  // Alice stops sharing: Bob loses her location.
  await a.locator(`[data-testid^="person-item-"]`).click();
  await a.getByTestId("btn-stop-sharing").click();
  await b.goto("/people");
  await expect(b.getByText(/Nobody shares/)).toBeVisible();

  await aliceCtx.close();
  await bobCtx.close();
});

test("zone alerts on arrival and departure (French UI)", async ({ browser }) => {
  const acc = newAccount("Camille");
  const ctx = await openContext(browser, { geolocation: HOME, locale: "fr-FR" });
  await signIn(ctx, acc, "register", "fr");
  const page = await ctx.newPage();
  await registerThisDevice(page, "Téléphone");

  // Create "Maison" around the current position.
  await page.goto("/me/zones");
  await page.getByTestId("btn-add-zone").click();
  await page.locator('input[name="zone-name"]').fill("Maison");
  await page.getByTestId("zone-use-position").click();
  await page.getByTestId("zone-save").click();
  await expect(page.locator('[data-testid^="zone-item-"]')).toContainText("Maison");

  // Establish the baseline inside, then leave and come back.
  await page.getByTestId("tab-me").click();
  await page.getByTestId("btn-update-now").click();
  await page.waitForTimeout(500);
  await ctx.setGeolocation({ ...FAR, accuracy: 10 });
  await expect(page.getByTestId("toast").filter({ hasText: "Téléphone a quitté Maison" })).toBeVisible({ timeout: 15_000 });
  await ctx.setGeolocation({ ...HOME, accuracy: 10 });
  await expect(page.getByTestId("toast").filter({ hasText: "Téléphone est arrivé(e) à Maison" })).toBeVisible({ timeout: 15_000 });

  await page.goto("/me/zones");
  await expect(page.getByTestId("zone-event")).toHaveCount(2);
  await ctx.close();
});
