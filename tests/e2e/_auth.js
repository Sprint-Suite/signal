"use strict";

// Shared e2e sign-in: inject the hub-backed session cookie seeded by seed.js.
// Replaces the old in-app email/password login (now delegated to the hub).
const credentials = require("./credentials");

async function authenticate(context) {
  await context.addCookies([
    {
      name: "signal_session",
      value: credentials.sessionId,
      domain: "localhost",
      path: "/"
    }
  ]);
}

module.exports = { authenticate };
