"use strict";

const { test, expect } = require("@playwright/test");
const { authenticate } = require("./_auth");

const PUBLIC_PAGES = [
  { path: "/license", title: "Signal Free Use License" }
];

const AUTH_PAGES = [
  { path: "/dashboard", title: "Surveys" },
  { path: "/admin", title: "Teams & admins" },
  // survey has two .band elements; first() targets the builder one
  { path: "/survey", title: "New survey" }
];

async function signIn(page) {
  await authenticate(page.context());
}

function attachErrorListeners(page) {
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  return errs;
}

async function assertOscilloscope(band) {
  // oscilloscope.js mounts an <svg> trace into the empty .waves container.
  await expect.poll(async () => band.locator(".waves svg").count()).toBeGreaterThan(0);
}

test.describe("Instrument oscilloscope band", () => {
  test("renders on the public license page", async ({ page }) => {
    const errs = attachErrorListeners(page);
    for (const { path, title } of PUBLIC_PAGES) {
      await page.goto(path);
      const band = page.locator(".band").first();
      await expect(band).toBeVisible();
      await expect(band.locator("h1")).toContainText(title);
      await assertOscilloscope(band);
    }
    expect(errs).toEqual([]);
  });

  test("renders on auth-gated pages", async ({ page }) => {
    const errs = attachErrorListeners(page);
    await signIn(page);
    for (const { path, title } of AUTH_PAGES) {
      await page.goto(path);
      const band = page.locator(".band").first();
      await expect(band).toBeVisible();
      await expect(band.locator("h1").first()).toContainText(title);
      await assertOscilloscope(band);
    }
    expect(errs).toEqual([]);
  });
});
