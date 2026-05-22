"use strict";

const { test, expect } = require("@playwright/test");
const credentials = require("./credentials");

test("health endpoint reports ok", async ({ request }) => {
  const res = await request.get("/health");
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.status).toBe("ok");
  expect(body.schemaVersion).toBe(1);
});

test("an admin can sign in and reach the dashboard", async ({ page }) => {
  await page.goto("/");
  await page.fill("#email", credentials.email);
  await page.fill("#password", credentials.password);
  await page.click("#login-btn");

  await page.waitForURL("**/dashboard");
  await expect(page.locator("h1")).toHaveText("Surveys");
});

test("a wrong password is rejected", async ({ page }) => {
  await page.goto("/");
  await page.fill("#email", credentials.email);
  await page.fill("#password", "definitely-not-the-password");
  await page.click("#login-btn");

  await expect(page.locator("#login-error")).toBeVisible();
});

test("the respondent form for an unknown code shows a closed message", async ({
  page
}) => {
  await page.goto("/s/NOSUCHCODE99");
  await expect(page.locator("#respond-closed")).toBeVisible();
});
