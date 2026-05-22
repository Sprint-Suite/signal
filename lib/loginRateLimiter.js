"use strict";

/**
 * lib/loginRateLimiter.js — in-memory sliding-window login throttle.
 *
 * Copied from the suite house pattern. Counts only *failed* logins per client
 * (keyed by IP), so a legitimate user mistyping a password is never penalised
 * once they succeed.
 *
 * This is layered ON TOP of per-account lockout (lib/auth.js). The two defend
 * different things: rate limiting slows distributed guessing across many
 * accounts; lockout protects a single targeted account. The limiter is
 * per-process and resets on restart — the same caveat as the other suite apps.
 */

const DEFAULT_MAX_FAILURES = 20;
const DEFAULT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

function createLoginRateLimiter({
  maxFailures = DEFAULT_MAX_FAILURES,
  windowMs = DEFAULT_WINDOW_MS
} = {}) {
  // Map<clientKey, failureTimestamps[]>
  const failuresByKey = new Map();

  function recentFailures(key, now) {
    const timestamps = (failuresByKey.get(key) || []).filter(
      (ts) => now - ts < windowMs
    );
    if (timestamps.length > 0) {
      failuresByKey.set(key, timestamps);
    } else {
      failuresByKey.delete(key);
    }
    return timestamps;
  }

  return {
    isBlocked(key, now = Date.now()) {
      return recentFailures(key, now).length >= maxFailures;
    },
    recordFailure(key, now = Date.now()) {
      const timestamps = recentFailures(key, now);
      timestamps.push(now);
      failuresByKey.set(key, timestamps);
    },
    recordSuccess(key) {
      failuresByKey.delete(key);
    },
    get size() {
      return failuresByKey.size;
    }
  };
}

module.exports = {
  DEFAULT_MAX_FAILURES,
  DEFAULT_WINDOW_MS,
  createLoginRateLimiter
};
