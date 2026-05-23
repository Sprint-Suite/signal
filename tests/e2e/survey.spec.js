"use strict";

const { test, expect } = require("@playwright/test");
const credentials = require("./credentials");

async function signIn(page) {
  await page.goto("/");
  await page.fill("#email", credentials.email);
  await page.fill("#password", credentials.password);
  await page.click("#login-btn");
  await page.waitForURL("**/dashboard");
}

test("full run: create a team and survey, answer it, view the report", async ({
  page,
  request
}) => {
  await signIn(page);

  // --- Create a team ----------------------------------------------------
  await page.goto("/admin");
  const teamName = `E2E Team ${Date.now()}`;
  await page.fill("#team-name", teamName);
  await page.click("#create-team-btn");
  await expect(page.locator("#key-reveal")).toBeVisible();

  // --- Create a survey --------------------------------------------------
  await page.goto("/survey");
  await expect(page.locator("#builder-form")).toBeVisible();
  await page.selectOption("#team-select", { label: teamName });
  await page.click("#create-btn");
  await expect(page.locator("#builder-result")).toBeVisible();

  const link = (await page.locator("#result-link").textContent()).trim();
  const code = link.split("/s/")[1];
  expect(code).toBeTruthy();

  // --- One respondent walks the whole form by hand ----------------------
  await page.goto(`/s/${code}`);
  await expect(page.locator("#respond-question")).toBeVisible();
  for (let i = 0; i < 24; i += 1) {
    await page.locator('.scale-option:has(input[value="4"])').click();
    await page.click("#next-btn");
  }
  await expect(page.locator("#respond-thanks")).toBeVisible();

  // --- Two more responses via the API to clear the 3-response floor -----
  const form = await (await request.get(`/api/respond/${code}`)).json();
  for (let r = 0; r < 2; r += 1) {
    const answers = form.questions.map((q, i) => ({
      questionId: q.id,
      score: 3 + ((i + r) % 3)
    }));
    const res = await request.post(`/api/respond/${code}`, {
      data: { answers, durationSeconds: 160 }
    });
    expect(res.status()).toBe(201);
  }

  // --- View the report --------------------------------------------------
  await page.goto("/dashboard");
  await page.click(".postcard-tile");
  await expect(page.locator("#report-body")).toBeVisible();
  await expect(page.locator("#radar svg")).toBeVisible();
  await expect(page.locator("#axes .axis-card")).toHaveCount(6);
});
