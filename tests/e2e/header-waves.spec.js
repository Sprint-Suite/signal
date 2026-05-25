"use strict";

const { test, expect } = require("@playwright/test");
const credentials = require("./credentials");

const PUBLIC_PAGES = [
  { path: "/license", title: "Signal Free Use License" }
];

const AUTH_PAGES = [
  { path: "/dashboard", title: "Surveys" },
  { path: "/account", title: "Your account" },
  { path: "/admin", title: "Teams & admins" },
  // survey has two .header-band elements; first() targets the builder one
  { path: "/survey", title: "New survey" }
];

async function signIn(page) {
  await page.goto("/");
  await page.fill("#email", credentials.email);
  await page.fill("#password", credentials.password);
  await page.click("#login-btn");
  await page.waitForURL("**/dashboard");
}

function attachErrorListeners(page) {
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errs.push(m.text());
  });
  return errs;
}

async function assertSizedCanvas(band) {
  // Canvas.width is set by the component's resize() to host width × devicePixelRatio.
  // A non-zero value proves the component initialised and the host had real dimensions —
  // catches the "hidden section returns 0×0 from getBoundingClientRect" regression.
  await expect
    .poll(async () => band.locator("canvas").evaluate((c) => c.width))
    .toBeGreaterThan(0);
}

test.describe("breathing-waves header band", () => {
  test("renders on public license page with aria-hidden canvas", async ({ page }) => {
    const errs = attachErrorListeners(page);
    for (const { path, title } of PUBLIC_PAGES) {
      await page.goto(path);
      const band = page.locator(".header-band[data-breathing-waves]").first();
      await expect(band).toBeVisible();
      await expect(band.locator("canvas")).toHaveAttribute("aria-hidden", "true");
      await expect(band.locator(".header-title")).toContainText(title);
      await assertSizedCanvas(band);
    }
    expect(errs).toEqual([]);
  });

  test("renders on auth-gated pages with aria-hidden canvas", async ({ page }) => {
    const errs = attachErrorListeners(page);
    await signIn(page);
    for (const { path, title } of AUTH_PAGES) {
      await page.goto(path);
      const band = page.locator(".header-band[data-breathing-waves]").first();
      await expect(band).toBeVisible();
      await expect(band.locator("canvas")).toHaveAttribute("aria-hidden", "true");
      await expect(band.locator(".header-title").first()).toContainText(title);
      await assertSizedCanvas(band);
    }
    expect(errs).toEqual([]);
  });
});
