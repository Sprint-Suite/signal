"use strict";

/**
 * lib/invites.js — single-use respondent links.
 *
 * Only a SHA-256 of each code is stored; the plaintext is returned once, at
 * creation. Nothing here records which invite produced which response.
 */

const crypto = require("crypto");
const db = require("./db");
const { generateAccessKey } = require("./accessKeys");

function hashCode(code) {
  return crypto.createHash("sha256").update(code).digest("hex");
}

/** Mint `count` invites for a survey; returns the plaintext codes. */
function createInvites(conn, surveyId, count) {
  const insert = conn.prepare(
    "INSERT INTO invites (id, survey_id, code_hash) VALUES (?, ?, ?)"
  );
  const codes = [];
  conn.transaction(() => {
    for (let i = 0; i < count; i += 1) {
      const code = generateAccessKey();
      insert.run(crypto.randomUUID(), surveyId, hashCode(code));
      codes.push(code);
    }
  })();
  return codes;
}

function findInvite(conn, code) {
  const row = conn
    .prepare("SELECT id, survey_id, used FROM invites WHERE code_hash = ?")
    .get(hashCode(String(code)));
  return row ? { id: row.id, surveyId: row.survey_id, used: Boolean(row.used) } : null;
}

/** Spend the invite and store the response atomically: "ok" or "used". */
function submitWithInvite(conn, inviteId, payload) {
  return conn.transaction(() => {
    const spent = conn
      .prepare("UPDATE invites SET used = 1 WHERE id = ? AND used = 0")
      .run(inviteId);
    if (spent.changes === 0) return "used";
    db.submitResponse(conn, payload);
    return "ok";
  })();
}

function countInvites(conn, surveyId) {
  const row = conn
    .prepare(
      "SELECT COUNT(*) AS total, COALESCE(SUM(used), 0) AS used FROM invites WHERE survey_id = ?"
    )
    .get(surveyId);
  return { total: row.total, used: row.used };
}

module.exports = { createInvites, findInvite, submitWithInvite, countInvites };
