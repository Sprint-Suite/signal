"use strict";

/**
 * middleware/securityHeaders.js — HTTP security headers middleware factory.
 *
 * Suite house pattern: makeSecurityHeaders({ contentSecurityPolicy }) returns
 * an Express middleware that stamps every response with a strict CSP and a
 * full set of security headers.
 *
 * Signal-specific CSP notes:
 *   - style-src 'self'  (no inline styles anywhere — stays strict)
 *   - connect-src 'self' only — Signal is request/response, no WebSockets
 *   - upgrade-insecure-requests — behind Apache TLS in production
 */

const DEFAULT_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self' data:",
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const DEFAULT_PERMISSIONS_POLICY = [
  "accelerometer=()",
  "camera=()",
  "geolocation=()",
  "gyroscope=()",
  "microphone=()",
  "payment=()",
  "usb=()",
].join(", ");

function makeSecurityHeaders({
  contentSecurityPolicy = DEFAULT_CSP,
  permissionsPolicy = DEFAULT_PERMISSIONS_POLICY,
} = {}) {
  return function securityHeaders(_req, res, next) {
    res.setHeader("Content-Security-Policy", contentSecurityPolicy);
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Permissions-Policy", permissionsPolicy);
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader("Origin-Agent-Cluster", "?1");
    res.setHeader("X-DNS-Prefetch-Control", "off");
    res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
    res.removeHeader("X-Powered-By");
    res.removeHeader("Server");
    // Survey data is sensitive and always fresh — never let a cache hold it.
    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0"
    );
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Surrogate-Control", "no-store");
    next();
  };
}

module.exports = { makeSecurityHeaders, DEFAULT_CSP, DEFAULT_PERMISSIONS_POLICY };
