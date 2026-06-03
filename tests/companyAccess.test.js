"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { teamCompanyAllowed } = require("../lib/companyAccess");

test("teamCompanyAllowed: true only when team.company_id matches company.id", () => {
  assert.equal(teamCompanyAllowed({ company_id: "co-a" }, { id: "co-a", name: "A" }), true);
});

test("teamCompanyAllowed: false on company mismatch", () => {
  assert.equal(teamCompanyAllowed({ company_id: "co-a" }, { id: "co-b", name: "B" }), false);
});

test("teamCompanyAllowed: false when company is null/undefined", () => {
  assert.equal(teamCompanyAllowed({ company_id: "co-a" }, null), false);
  assert.equal(teamCompanyAllowed({ company_id: "co-a" }, undefined), false);
});

test("teamCompanyAllowed: false when company has no id", () => {
  assert.equal(teamCompanyAllowed({ company_id: "co-a" }, { name: "A" }), false);
});

test("teamCompanyAllowed: false when team is null/has no company_id", () => {
  assert.equal(teamCompanyAllowed(null, { id: "co-a" }), false);
  assert.equal(teamCompanyAllowed({}, { id: "co-a" }), false);
});
