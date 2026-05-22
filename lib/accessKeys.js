"use strict";

/**
 * lib/accessKeys.js — salted SHA-256 team access keys.
 *
 * Adapted from the suite house pattern. Team keys are high-entropy random
 * tokens, so a fast hash with a per-key salt is sufficient — a slow KDF is
 * unnecessary here. This is deliberately NOT used for admin passwords: those
 * are human-chosen and need argon2id (see lib/auth.js).
 *
 * Storage of the hash/salt lives in lib/db.js (the `teams` table); this module
 * is pure crypto.
 */

const crypto = require("crypto");

const ACCESS_KEY_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const DEFAULT_ACCESS_KEY_LENGTH = 12;
const MIN_ACCESS_KEY_LENGTH = 12;
const SALT_BYTES = 16;

/** A random alphanumeric key, free of modulo bias. */
function generateAccessKey(length = DEFAULT_ACCESS_KEY_LENGTH) {
  let key = "";
  while (key.length < length) {
    for (const byte of crypto.randomBytes(length)) {
      // 248 = 256 - (256 % 62); bytes at/above it would bias the distribution.
      if (byte >= 248) continue;
      key += ACCESS_KEY_CHARS[byte % ACCESS_KEY_CHARS.length];
      if (key.length === length) break;
    }
  }
  return key;
}

function generateSalt() {
  return crypto.randomBytes(SALT_BYTES).toString("hex");
}

function hashAccessKey(value, salt) {
  return crypto
    .createHash("sha256")
    .update(`${salt}:${value}`)
    .digest("hex");
}

function isWeakAccessKey(value) {
  return typeof value !== "string" || value.length < MIN_ACCESS_KEY_LENGTH;
}

/** Constant-time verification of a key against a stored hash + salt. */
function verifyAccessKey(value, hash, salt) {
  if (
    typeof value !== "string" ||
    typeof hash !== "string" ||
    typeof salt !== "string"
  ) {
    return false;
  }
  const expected = Buffer.from(hash, "hex");
  const actual = Buffer.from(hashAccessKey(value, salt), "hex");
  return (
    expected.length > 0 &&
    expected.length === actual.length &&
    crypto.timingSafeEqual(expected, actual)
  );
}

/**
 * Mint a fresh team key: returns the plaintext `value` (show it to the admin
 * exactly once) plus the `keyHash` / `keySalt` / `weak` fields for db.createTeam.
 */
function createTeamKey() {
  const value = generateAccessKey();
  const keySalt = generateSalt();
  return {
    value,
    keyHash: hashAccessKey(value, keySalt),
    keySalt,
    weak: isWeakAccessKey(value)
  };
}

module.exports = {
  ACCESS_KEY_CHARS,
  MIN_ACCESS_KEY_LENGTH,
  generateAccessKey,
  generateSalt,
  hashAccessKey,
  isWeakAccessKey,
  verifyAccessKey,
  createTeamKey
};
