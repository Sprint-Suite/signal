"use strict";

const { test, expect } = require("@playwright/test");
const { authenticate } = require("./_auth");

for (const p of ["/license", "/licence"]) {
  test(`${p} permanently redirects to the Hub licence`, async ({ request }) => {
    const res = await request.get(p, { maxRedirects: 0 });
    expect(res.status()).toBe(301);
    expect(res.headers()["location"]).toBe("https://sprintsuite.uk/license");
  });
}

test("the dashboard opens the licence in a popup and Esc closes it", async ({ page }) => {
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  await authenticate(page.context());
  await page.goto("/dashboard");

  await page.locator("a[data-licence-modal]").click();
  const dialog = page.locator("dialog.licence-modal");
  await expect(dialog).toHaveAttribute("open", "");
  await expect(page.locator("#licence-modal-title")).toBeFocused();
  await expect(dialog).toContainText("1. Grant of licence.");
  expect(new URL(page.url()).pathname).toBe("/dashboard");

  await page.keyboard.press("Escape");
  await expect(dialog).not.toHaveAttribute("open", "");
  expect(errs).toEqual([]);
});
