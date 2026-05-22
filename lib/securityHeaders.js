"use strict";

/**
 * lib/securityHeaders.js — strict CSP and edge security headers.
 *
 * Adapted from the suite house pattern (Scrum Poker's httpApp). The CSP forbids
 * inline scripts, `eval`, and CDNs — which is *why* the radar is hand-drawn SVG
 * in an external file. Note `connect-src 'self'` only: Signal has no
 * WebSockets, so no `ws:`/`wss:` is allowed.
 */

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self' data:",
  "img-src 'self' data:",
  "connect-src 'self'", // no ws: — Signal is request/response only
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests"
].join("; ");

const PERMISSIONS_POLICY = [
  "accelerometer=()",
  "camera=()",
  "geolocation=()",
  "gyroscope=()",
  "microphone=()",
  "payment=()",
  "usb=()"
].join(", ");

function applySecurityHeaders(res) {
  res.setHeader("Content-Security-Policy", CSP);
  res.setHeader(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains"
  );
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Origin-Agent-Cluster", "?1");
  res.setHeader("X-DNS-Prefetch-Control", "off");
  res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
  res.setHeader("Permissions-Policy", PERMISSIONS_POLICY);
  res.removeHeader("X-Powered-By");
  res.removeHeader("Server");
}

/** Survey data is sensitive and always fresh — never let a cache hold it. */
function setNoCacheHeaders(res) {
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0"
  );
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");
}

/** Express middleware applying both header sets to every response. */
function securityHeaders(req, res, next) {
  applySecurityHeaders(res);
  setNoCacheHeaders(res);
  next();
}

module.exports = {
  CSP,
  PERMISSIONS_POLICY,
  applySecurityHeaders,
  setNoCacheHeaders,
  securityHeaders
};
