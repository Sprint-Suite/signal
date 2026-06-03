"use strict";

// The hub-backed sessions seeded by tests/e2e/seed.js. The specs authenticate
// by injecting `signal_session=<sessionId>` as a cookie (see _auth.js) — there
// is no in-app login any more; sign-in is delegated to the central hub.
//
// Three sessions are seeded:
//   default — the general-purpose facilitator used by the existing specs. It
//             carries a company so company-scoped routes (POST /api/teams, …)
//             admit it.
//   companyA / companyB — two distinct companies, used by company-scoping.spec.js
//                         to prove cross-company isolation.
module.exports = {
  // Default facilitator session (existing specs).
  sessionId: "e2e0000000000000000000000000session",
  userId: "e2e-hub-user",
  centralSessionId: "e2e-central-session",
  company: { id: "co-e2e", name: "E2E Co" },

  // Company A.
  companyA: {
    sessionId: "e2e00000000000000000000000sessionA",
    userId: "e2e-hub-user-a",
    centralSessionId: "e2e-central-session-a",
    company: { id: "co-a", name: "A" }
  },

  // Company B.
  companyB: {
    sessionId: "e2e00000000000000000000000sessionB",
    userId: "e2e-hub-user-b",
    centralSessionId: "e2e-central-session-b",
    company: { id: "co-b", name: "B" }
  }
};
