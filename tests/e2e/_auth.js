"use strict";

// Shared e2e sign-in: inject a hub-backed session cookie seeded by seed.js.
// Replaces the old in-app email/password login (now delegated to the hub).
//
// `authenticate(context)` injects the default facilitator session.
// `authenticate(context, sessionId)` injects a specific seeded session (e.g.
// credentials.companyA.sessionId) so specs can act as different companies.
const credentials = require("./credentials");

async function authenticate(context, sessionId = credentials.sessionId) {
  await context.addCookies([
    {
      name: "signal_session",
      value: sessionId,
      domain: "localhost",
      path: "/"
    }
  ]);
}

module.exports = { authenticate };
