"use strict";

const NOT_ENTITLED_MESSAGE =
  "Signal is not enabled for your account. Ask your company admin to turn it on.";

/**
 * Express middleware, mounted after auth.requireAuth: lets entitled users
 * through. API callers get a 403 JSON error; page requests are sent to the
 * hub dashboard.
 */
function makeRequireEntitled({ hubBaseUrl }) {
  return function requireEntitled(req, res, next) {
    if (req.user && req.user.entitled) return next();
    if (req.originalUrl.startsWith("/api/")) {
      return res.status(403).json({ error: NOT_ENTITLED_MESSAGE });
    }
    return res.redirect(302, `${hubBaseUrl}/dashboard`);
  };
}

module.exports = { makeRequireEntitled };
