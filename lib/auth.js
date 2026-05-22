"use strict";

/**
 * lib/auth.js — admin authentication.
 *
 * Robust, account-based login: real email + password admins. This is the one
 * area where Signal deliberately exceeds the suite's casual access keys.
 * Respondents never authenticate — they use anonymous links.
 *
 * Password hashing is argon2id (memory-hard, purpose-built for human-chosen
 * passwords). It is intentionally NOT the salted SHA-256 used for team access
 * keys — SHA-256 is fast and unsuitable here.
 *
 * This module owns auth *logic* only: hashing, login + lockout, and the
 * single-use token lifecycle. It performs no email I/O — callers pair it with
 * lib/mailer.js. That keeps the logic pure and trivially testable.
 */

const crypto = require("crypto");
const argon2 = require("argon2");
const db = require("./db");

const MIN_PASSWORD_LENGTH = 12;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// One generic message for every login failure — never reveal whether the
// email was unknown, the password wrong, or the account locked/disabled.
const GENERIC_LOGIN_ERROR = "Invalid email or password.";

const DEFAULT_LOCKOUT = { threshold: 5, minutes: 15 };
const VERIFY_TOKEN_TTL_HOURS = 24;
const RESET_TOKEN_TTL_HOURS = 1;

// ---------------------------------------------------------------------------
// Passwords (argon2id)
// ---------------------------------------------------------------------------

function hashPassword(plain) {
  return argon2.hash(String(plain), { type: argon2.argon2id });
}

async function verifyPassword(hash, plain) {
  try {
    return await argon2.verify(hash, String(plain));
  } catch {
    return false; // malformed hash, etc.
  }
}

// A real argon2 hash used to equalise response timing when there is no user
// (or the account is locked) — so an attacker cannot enumerate accounts by
// measuring how long a login attempt takes. Computed once, lazily.
let dummyHashPromise = null;
function dummyHash() {
  if (!dummyHashPromise) {
    dummyHashPromise = argon2.hash("signal-timing-equaliser", {
      type: argon2.argon2id
    });
  }
  return dummyHashPromise;
}
async function burnTime(password) {
  try {
    await argon2.verify(await dummyHash(), String(password || ""));
  } catch {
    /* ignore — this call exists only to spend comparable time */
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const normaliseEmail = (email) => String(email || "").trim();

function isValidEmail(email) {
  return EMAIL_RE.test(normaliseEmail(email));
}

function validatePassword(password) {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Tokens — high-entropy random; only a SHA-256 hash is ever stored
// ---------------------------------------------------------------------------

function generateRawToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function hashToken(rawToken) {
  return crypto.createHash("sha256").update(String(rawToken)).digest("hex");
}

function buildLink(baseUrl, routePath, rawToken) {
  const base = String(baseUrl || "").replace(/\/+$/, "");
  return `${base}${routePath}?token=${encodeURIComponent(rawToken)}`;
}
const verificationLink = (baseUrl, rawToken) =>
  buildLink(baseUrl, "/verify", rawToken);
const resetLink = (baseUrl, rawToken) => buildLink(baseUrl, "/reset", rawToken);

// ---------------------------------------------------------------------------
// Account creation — invite / seed only (no public self-registration)
// ---------------------------------------------------------------------------

/**
 * Create an admin account. Used by the CLI (`create-admin`) and the
 * admin-only invite screen. New accounts start unverified unless told otherwise.
 */
async function registerUser(conn, { email, password, emailVerified = false }) {
  const safeEmail = normaliseEmail(email);
  if (!isValidEmail(safeEmail)) {
    const err = new Error("A valid email address is required.");
    err.code = "INVALID_EMAIL";
    throw err;
  }
  const pw = validatePassword(password);
  if (!pw.ok) {
    const err = new Error(pw.message);
    err.code = "WEAK_PASSWORD";
    throw err;
  }
  const passwordHash = await hashPassword(password);
  return db.createUser(conn, { email: safeEmail, passwordHash, emailVerified });
}

// ---------------------------------------------------------------------------
// Login + lockout
// ---------------------------------------------------------------------------

/** Lockout config from env, falling back to the documented defaults. */
function lockoutFromEnv() {
  const threshold = Number.parseInt(process.env.LOCKOUT_THRESHOLD, 10);
  const minutes = Number.parseInt(process.env.LOCKOUT_MINUTES, 10);
  return {
    threshold:
      Number.isFinite(threshold) && threshold > 0
        ? threshold
        : DEFAULT_LOCKOUT.threshold,
    minutes:
      Number.isFinite(minutes) && minutes > 0
        ? minutes
        : DEFAULT_LOCKOUT.minutes
  };
}

function isLocked(user) {
  if (!user || !user.locked_until) return false;
  return new Date(user.locked_until).getTime() > Date.now();
}

/**
 * Verify an email + password and apply per-account lockout.
 *
 * Always returns the SAME generic message for every failure. The `reason`
 * field is for server-side logging/tests only and must never reach the client.
 *
 * Per-account lockout (here) defends a single targeted account; it is layered
 * under the per-IP rate limiter (lib/loginRateLimiter.js) which slows
 * distributed guessing. The two defend different things.
 *
 * @returns {{ok: true, user: object}
 *           | {ok: false, reason: string, message: string,
 *              attempts?: number, lockedUntil?: string}}
 */
async function authenticate(conn, { email, password }, lockoutConfig) {
  const lockout = { ...lockoutFromEnv(), ...(lockoutConfig || {}) };
  const user = db.getUserByEmail(conn, email);

  if (!user) {
    await burnTime(password);
    return {
      ok: false,
      reason: "unknown_email",
      message: GENERIC_LOGIN_ERROR
    };
  }

  if (!user.is_active) {
    await burnTime(password);
    return { ok: false, reason: "inactive", message: GENERIC_LOGIN_ERROR };
  }

  if (isLocked(user)) {
    await burnTime(password);
    return {
      ok: false,
      reason: "locked",
      lockedUntil: user.locked_until,
      message: GENERIC_LOGIN_ERROR
    };
  }

  const passwordOk = await verifyPassword(user.password_hash, password);
  if (!passwordOk) {
    const attempts = db.recordFailedLogin(conn, user.id);
    let lockedUntil = null;
    if (attempts >= lockout.threshold) {
      lockedUntil = new Date(
        Date.now() + lockout.minutes * 60000
      ).toISOString();
      db.lockUser(conn, user.id, lockedUntil);
    }
    return {
      ok: false,
      reason: "bad_password",
      attempts,
      lockedUntil,
      message: GENERIC_LOGIN_ERROR
    };
  }

  db.recordSuccessfulLogin(conn, user.id);
  return { ok: true, user: db.getUserById(conn, user.id) };
}

// ---------------------------------------------------------------------------
// Verification & password-reset tokens (Option B — transport deferred)
// ---------------------------------------------------------------------------

function issueToken(conn, userId, kind, ttlHours) {
  const rawToken = generateRawToken();
  db.createAuthToken(conn, {
    userId,
    kind,
    tokenHash: hashToken(rawToken),
    expiresAt: new Date(Date.now() + ttlHours * 3600000).toISOString()
  });
  return rawToken;
}

/** Issue an email-verification token (24h). Returns the raw token. */
function issueVerificationToken(conn, userId) {
  return issueToken(conn, userId, "verify", VERIFY_TOKEN_TTL_HOURS);
}

/** Issue a password-reset token (1h). Returns the raw token. */
function issueResetToken(conn, userId) {
  return issueToken(conn, userId, "reset", RESET_TOKEN_TTL_HOURS);
}

/**
 * Look up a token by its hash and check it is the right kind, unused, and
 * unexpired. Does not consume it.
 */
function inspectToken(conn, rawToken, kind) {
  const token = db.getAuthTokenByHash(conn, hashToken(rawToken || ""));
  if (!token || token.kind !== kind) {
    return { ok: false, reason: "invalid" };
  }
  if (token.used_at) {
    return { ok: false, reason: "used" };
  }
  if (new Date(token.expires_at).getTime() <= Date.now()) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, token };
}

/** Consume a verification token: mark the account verified. Single-use. */
function verifyEmailToken(conn, rawToken) {
  const result = inspectToken(conn, rawToken, "verify");
  if (!result.ok) return result;
  conn.transaction(() => {
    db.setUserVerified(conn, result.token.user_id);
    db.consumeAuthToken(conn, result.token.id);
  })();
  return { ok: true, userId: result.token.user_id };
}

/**
 * Begin a password reset for an email. Returns the raw token when the account
 * exists and is active; otherwise reports `userExists: false`. Callers MUST
 * still respond with the same generic confirmation either way — no enumeration.
 */
function beginPasswordReset(conn, email) {
  const user = db.getUserByEmail(conn, email);
  if (!user || !user.is_active) {
    return { userExists: false };
  }
  return {
    userExists: true,
    userId: user.id,
    email: user.email,
    token: issueResetToken(conn, user.id)
  };
}

/**
 * Consume a reset token: set a new password, invalidate every other
 * outstanding reset token for the user, and clear any lockout. Single-use.
 */
async function resetPasswordWithToken(conn, rawToken, newPassword) {
  const pw = validatePassword(newPassword);
  if (!pw.ok) {
    return { ok: false, reason: "weak_password", message: pw.message };
  }
  const result = inspectToken(conn, rawToken, "reset");
  if (!result.ok) return result;

  const userId = result.token.user_id;
  const passwordHash = await hashPassword(newPassword);
  conn.transaction(() => {
    db.updateUserPassword(conn, userId, passwordHash);
    db.invalidateUserTokens(conn, userId, "reset");
    db.consumeAuthToken(conn, result.token.id);
    db.clearLockout(conn, userId);
  })();
  return { ok: true, userId };
}

// ---------------------------------------------------------------------------
// Self-service account changes (for a signed-in admin)
// ---------------------------------------------------------------------------

/**
 * Change the signed-in user's password. The current password must be supplied
 * and verified — a session alone is not enough to set a new password.
 */
async function changePassword(conn, userId, currentPassword, newPassword) {
  const user = db.getUserById(conn, userId);
  if (!user) return { ok: false, reason: "not_found" };

  if (!(await verifyPassword(user.password_hash, currentPassword))) {
    return {
      ok: false,
      reason: "bad_current",
      message: "Your current password is incorrect."
    };
  }
  const pw = validatePassword(newPassword);
  if (!pw.ok) {
    return { ok: false, reason: "weak_password", message: pw.message };
  }
  db.updateUserPassword(conn, userId, await hashPassword(newPassword));
  return { ok: true };
}

/**
 * Change the signed-in user's login email. The current password must be
 * supplied and verified.
 *
 * The account keeps its verified status: the user is already authenticated
 * and has just re-confirmed their password, and v1 email delivery is log-only
 * (resetting to unverified would lock them out of admin routes).
 */
async function changeEmail(conn, userId, currentPassword, newEmail) {
  const user = db.getUserById(conn, userId);
  if (!user) return { ok: false, reason: "not_found" };

  if (!(await verifyPassword(user.password_hash, currentPassword))) {
    return {
      ok: false,
      reason: "bad_current",
      message: "Your current password is incorrect."
    };
  }
  const safeEmail = normaliseEmail(newEmail);
  if (!isValidEmail(safeEmail)) {
    return {
      ok: false,
      reason: "invalid_email",
      message: "A valid email address is required."
    };
  }
  if (safeEmail.toLowerCase() === String(user.email).toLowerCase()) {
    return { ok: true, email: user.email, unchanged: true };
  }
  try {
    db.updateUserEmail(conn, userId, safeEmail);
  } catch (err) {
    if (err.code === "EMAIL_EXISTS") {
      return { ok: false, reason: "email_exists", message: err.message };
    }
    throw err;
  }
  return { ok: true, email: safeEmail };
}

module.exports = {
  MIN_PASSWORD_LENGTH,
  GENERIC_LOGIN_ERROR,
  DEFAULT_LOCKOUT,
  VERIFY_TOKEN_TTL_HOURS,
  RESET_TOKEN_TTL_HOURS,
  // passwords
  hashPassword,
  verifyPassword,
  // validation
  normaliseEmail,
  isValidEmail,
  validatePassword,
  // tokens / links
  generateRawToken,
  hashToken,
  verificationLink,
  resetLink,
  // accounts & login
  registerUser,
  lockoutFromEnv,
  isLocked,
  authenticate,
  // token lifecycle
  issueVerificationToken,
  issueResetToken,
  inspectToken,
  verifyEmailToken,
  beginPasswordReset,
  resetPasswordWithToken,
  // self-service account changes
  changePassword,
  changeEmail
};
