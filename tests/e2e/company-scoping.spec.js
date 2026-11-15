"use strict";

// End-to-end proof of Signal's company-scoping contract. The heavy isolation
// matrix lives in the unit/integration suite (tests/server.test.js); the value
// these e2e specs add is proving the contract holds across a real HTTP server
// AND — most importantly (spec 3) — that the anonymous respondent path is
// untouched by company-scoping.
//
// Each company authenticates by sending its own seeded session cookie (see
// tests/e2e/seed.js + credentials.js). API calls use Playwright's `request`
// fixture with an explicit Cookie header so each call acts as a chosen company.
const { test, expect } = require("@playwright/test");
const credentials = require("./credentials");

const cookieFor = (cred) => `signal_session=${cred.sessionId}`;

// Create a team for the given company; returns the created team object.
async function createTeam(request, cred, name) {
  const res = await request.post("/api/teams", {
    headers: { Cookie: cookieFor(cred) },
    data: { name }
  });
  expect(res.status(), "POST /api/teams should succeed").toBe(201);
  return (await res.json()).team;
}

// Pick any template id (templates are global).
async function anyTemplateId(request, cred) {
  const res = await request.get("/api/templates", {
    headers: { Cookie: cookieFor(cred) }
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).templates[0].id;
}

// Open a survey for the given company; returns the survey summary plus its invite codes.
async function createSurvey(request, cred, teamId, templateId) {
  const res = await request.post("/api/surveys", {
    headers: { Cookie: cookieFor(cred) },
    data: { teamId, templateId, inviteCount: 3 }
  });
  expect(res.status(), "POST /api/surveys should succeed").toBe(201);
  const body = await res.json();
  return { ...body.survey, codes: body.inviteLinks.map((link) => link.split("/").pop()) };
}

test("a facilitator sees only their own company's teams", async ({ request }) => {
  const stamp = Date.now();
  const teamA = await createTeam(request, credentials.companyA, `A team ${stamp}`);
  const teamB = await createTeam(request, credentials.companyB, `B team ${stamp}`);

  const res = await request.get("/api/teams", {
    headers: { Cookie: cookieFor(credentials.companyB) }
  });
  expect(res.ok()).toBeTruthy();
  const ids = (await res.json()).teams.map((t) => t.id);

  expect(ids, "B sees its own team").toContain(teamB.id);
  expect(ids, "B does NOT see A's team").not.toContain(teamA.id);
});

test("a company cannot read another company's survey (404)", async ({ request }) => {
  const stamp = Date.now();
  const teamA = await createTeam(request, credentials.companyA, `A svc ${stamp}`);
  const templateId = await anyTemplateId(request, credentials.companyA);
  const surveyA = await createSurvey(request, credentials.companyA, teamA.id, templateId);

  // A can read its own survey.
  const own = await request.get(`/api/surveys/${surveyA.id}`, {
    headers: { Cookie: cookieFor(credentials.companyA) }
  });
  expect(own.status()).toBe(200);

  // B cannot — the cross-company guard returns a 404 (not a 403, to avoid
  // leaking the existence of another company's survey).
  const cross = await request.get(`/api/surveys/${surveyA.id}`, {
    headers: { Cookie: cookieFor(credentials.companyB) }
  });
  expect(cross.status()).toBe(404);
});

test("the anonymous respondent flow still submits end-to-end", async ({
  page,
  request
}) => {
  // Company A opens a survey via the API and captures an invite code.
  const stamp = Date.now();
  const teamA = await createTeam(request, credentials.companyA, `A resp ${stamp}`);
  const templateId = await anyTemplateId(request, credentials.companyA);
  const surveyA = await createSurvey(request, credentials.companyA, teamA.id, templateId);
  const code = surveyA.codes[0];
  expect(code).toBeTruthy();

  // A REAL anonymous respondent — no auth cookie on this browser context —
  // walks the whole form by hand. These steps/selectors are copied verbatim
  // from tests/e2e/survey.spec.js to prove the public path is unchanged.
  await page.goto(`/s/${code}`);
  await expect(page.locator("#respond-question")).toBeVisible();
  for (let i = 0; i < 24; i += 1) {
    await page.locator('.scale-option:has(input[value="4"])').click();
    await page.click("#next-btn");
  }
  await expect(page.locator("#respond-thanks")).toBeVisible();
});
