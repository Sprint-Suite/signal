"use strict";

const { test, expect } = require("@playwright/test");
const { authenticate } = require("./_auth");

test("health endpoint reports ok", async ({ request }) => {
  const res = await request.get("/health");
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.status).toBe("ok");
  expect(body.schemaVersion).toBe(2);
});

test("an authenticated session reaches the dashboard", async ({ page, context }) => {
  await authenticate(context);
  await page.goto("/dashboard");
  await expect(page.locator("h1")).toHaveText("Surveys");
});

test("the respondent form for an unknown code shows a closed message", async ({
  page
}) => {
  await page.goto("/s/NOSUCHCODE99");
  await expect(page.locator("#respond-closed")).toBeVisible();
});
