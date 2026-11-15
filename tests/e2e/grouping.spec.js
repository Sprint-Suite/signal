"use strict";

const { test, expect } = require("@playwright/test");
const { authenticate } = require("./_auth");

// Inject the hub-backed session cookie (sign-in is delegated to the hub).
async function signIn(page) {
  await authenticate(page.context());
}

test("dashboard groups surveys by team and template; builder optgroups baselines", async ({
  page
}) => {
  await signIn(page);

  // Create a team
  await page.goto("/admin");
  const teamName = `Grouping Team ${Date.now()}`;
  await page.fill("#team-name", teamName);
  await page.click("#create-team-btn");
  await expect(page.locator("#key-reveal")).toBeVisible();

  // Create a survey under the first template (default-selected)
  await page.goto("/survey");
  await expect(page.locator("#builder-form")).toBeVisible();
  await page.selectOption("#team-select", { label: teamName });
  const firstTemplateLabel = (
    await page.locator("#template-select option:checked").textContent()
  ).trim();
  await page.fill("#invite-count", "3");
  await page.click("#create-btn");
  await expect(page.locator("#builder-result")).toBeVisible();

  // Create a survey under the OTHER template
  await page.goto("/survey");
  await page.selectOption("#team-select", { label: teamName });
  const optionTexts = await page.locator("#template-select option").allTextContents();
  const otherLabel = optionTexts.map((s) => s.trim()).find((s) => s !== firstTemplateLabel);
  expect(otherLabel).toBeTruthy();
  await page.selectOption("#template-select", { label: otherLabel });
  await page.fill("#invite-count", "3");
  await page.click("#create-btn");
  await expect(page.locator("#builder-result")).toBeVisible();

  // --- Dashboard: should show team header + two template subheaders ---
  await page.goto("/dashboard");
  await expect(page.locator(".series-team-name", { hasText: teamName })).toHaveCount(1);
  await expect(
    page.locator(".series-template-name", { hasText: firstTemplateLabel })
  ).toHaveCount(1);
  await expect(
    page.locator(".series-template-name", { hasText: otherLabel })
  ).toHaveCount(1);

  // --- Builder follow-up dropdown: should have two optgroups ---
  await page.goto("/survey");
  await page.selectOption("#team-select", { label: teamName });
  await page.click("#run-followup");
  await expect(page.locator("#baseline-field")).toBeVisible();
  const optgroups = page.locator("#baseline-select optgroup");
  await expect(optgroups).toHaveCount(2);
});
