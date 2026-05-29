"use strict";

// The hub-backed session seeded by tests/e2e/seed.js. The specs authenticate
// by injecting `signal_session=<sessionId>` as a cookie (see _auth.js) — there
// is no in-app login any more; sign-in is delegated to the central hub.
module.exports = {
  sessionId: "e2e0000000000000000000000000session",
  userId: "e2e-hub-user",
  centralSessionId: "e2e-central-session"
};
