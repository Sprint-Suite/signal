"use strict";

/**
 * lib/session.js — server-side admin sessions.
 *
 * The session cookie is signed (HMAC-SHA256), httpOnly, SameSite=Lax, and
 * Secure in production. It carries ONLY an opaque session id; the session
 * record holds only `userId` — everything else (verification state, etc.) is
 * looked up fresh on each request.
 *
 * The store is in-memory and per-process: sessions do not survive a restart
 * (admins simply log in again) and do not coordinate across instances. This is
 * deliberate — the spec's schema has no sessions table, and Signal runs as a
 * single process. Respondents never get a session.
 */

const crypto = require("crypto");

const COOKIE_NAME = "signal_session";
const DEFAULT_TTL_HOURS = 12;
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

function sign(value, secret) {
  const sig = crypto
    .createHmac("sha256", secret)
    .update(value)
    .digest("base64url");
  return `${value}.${sig}`;
}

function unsign(signed, secret) {
  if (typeof signed !== "string") return null;
  const dot = signed.lastIndexOf(".");
  if (dot <= 0) return null;
  const value = signed.slice(0, dot);
  const provided = Buffer.from(signed.slice(dot + 1));
  const expected = Buffer.from(
    crypto.createHmac("sha256", secret).update(value).digest("base64url")
  );
  if (
    provided.length !== expected.length ||
    !crypto.timingSafeEqual(provided, expected)
  ) {
    return null;
  }
  return value;
}

function parseCookies(header) {
  const out = {};
  if (typeof header !== "string") return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    if (key) out[key] = part.slice(eq + 1).trim();
  }
  return out;
}

/**
 * @param {object} options
 * @param {string} options.secret  — cookie signing secret (SESSION_SECRET).
 * @param {boolean} [options.secure] — set the Secure cookie flag (production).
 * @param {number} [options.ttlHours]
 */
function createSessionManager({
  secret,
  secure = false,
  ttlHours = DEFAULT_TTL_HOURS
} = {}) {
  if (!secret || String(secret).length < 16) {
    throw new Error(
      "A SESSION_SECRET of at least 16 characters is required."
    );
  }
  const ttlMs = ttlHours * 3600000;
  const store = new Map(); // sessionId -> { userId, expiresAt }

  function sweep(now = Date.now()) {
    for (const [id, rec] of store) {
      if (rec.expiresAt <= now) store.delete(id);
    }
  }

  function cookieAttributes(maxAgeSeconds) {
    const parts = [
      "HttpOnly",
      "SameSite=Lax",
      "Path=/",
      `Max-Age=${maxAgeSeconds}`
    ];
    if (secure) parts.push("Secure");
    return parts.join("; ");
  }

  /** Begin a session for a user and set the cookie. */
  function start(res, userId) {
    sweep();
    const id = crypto.randomBytes(32).toString("base64url");
    store.set(id, { userId, expiresAt: Date.now() + ttlMs });
    res.append(
      "Set-Cookie",
      `${COOKIE_NAME}=${sign(id, secret)}; ${cookieAttributes(
        Math.floor(ttlMs / 1000)
      )}`
    );
    return id;
  }

  /** Resolve the current session from the request, or null. */
  function read(req) {
    const signed = parseCookies(req.headers.cookie)[COOKIE_NAME];
    if (!signed) return null;
    const id = unsign(signed, secret);
    if (!id) return null;
    const rec = store.get(id);
    if (!rec) return null;
    if (rec.expiresAt <= Date.now()) {
      store.delete(id);
      return null;
    }
    return { id, userId: rec.userId };
  }

  /** End the current session and clear the cookie. */
  function end(req, res) {
    const signed = parseCookies(req.headers.cookie)[COOKIE_NAME];
    if (signed) {
      const id = unsign(signed, secret);
      if (id) store.delete(id);
    }
    res.append("Set-Cookie", `${COOKIE_NAME}=; ${cookieAttributes(0)}`);
  }

  /** Middleware: attach `req.session` ({ id, userId } | null). */
  function middleware(req, _res, next) {
    req.session = read(req);
    next();
  }

  const sweepTimer = setInterval(sweep, SWEEP_INTERVAL_MS);
  if (typeof sweepTimer.unref === "function") sweepTimer.unref();

  return {
    COOKIE_NAME,
    start,
    read,
    end,
    middleware,
    sweep,
    get size() {
      return store.size;
    }
  };
}

module.exports = {
  COOKIE_NAME,
  sign,
  unsign,
  parseCookies,
  createSessionManager
};
