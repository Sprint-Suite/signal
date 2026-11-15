"use strict";

const { test, expect } = require("@playwright/test");
const { authenticate } = require("./_auth");

// Inject the hub-backed session cookie (sign-in is delegated to the hub).
async function signIn(page) {
  await authenticate(page.context());
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
  await page.fill("#invite-count", "3");
  await page.click("#create-btn");
  await expect(page.locator("#builder-result")).toBeVisible();

  const links = await page.locator("#result-links .key-box").allTextContents();
  expect(links).toHaveLength(3);
  const codes = links.map((link) => link.trim().split("/s/")[1]);

  // --- One respondent walks the whole form by hand ----------------------
  await page.goto(`/s/${codes[0]}`);
  await expect(page.locator("#respond-question")).toBeVisible();
  for (let i = 0; i < 24; i += 1) {
    await page.locator('.scale-option:has(input[value="4"])').click();
    await page.click("#next-btn");
  }
  await expect(page.locator("#respond-thanks")).toBeVisible();

  // --- A spent link shows the used message ------------------------------
  await page.goto(`/s/${codes[0]}`);
  await expect(page.locator("#respond-used")).toBeVisible();

  // --- Two more responses via the API to clear the 3-response floor -----
  const form = await (await request.get(`/api/respond/${codes[1]}`)).json();
  for (let r = 1; r < 3; r += 1) {
    const answers = form.questions.map((q, i) => ({
      questionId: q.id,
      score: 3 + ((i + r) % 3)
    }));
    const res = await request.post(`/api/respond/${codes[r]}`, {
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
  await expect(page.locator("#invite-usage")).toHaveText("3 of 3 links used");
});
