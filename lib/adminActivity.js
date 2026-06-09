"use strict";

/**
 * lib/adminActivity.js — append-only JSONL admin audit log.
 *
 * Adapted from the suite house pattern. Records admin actions (survey
 * create/close/delete, team key management, account invites) one JSON object
 * per line. It records identifiers and names, never raw secrets — a team key
 * or survey access code must never reach this file. Callers pass a short
 * fingerprint instead (see `fingerprint`).
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { logger } = require("./logger.js");

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;

// The actions Signal records. Kept as documentation; unknown actions are still
// logged rather than dropped — an audit log should never silently lose events.
const KNOWN_ACTIONS = new Set([
  "survey.created",
  "survey.closed",
  "survey.reopened",
  "survey.deleted",
  "team.created",
  "team.key_rotated",
  "team.deleted",
  "admin.invited",
  "admin.login"
]);

function getActivityFilePath(baseDir, env = process.env) {
  return env.SIGNAL_ACTIVITY_FILE
    ? path.resolve(env.SIGNAL_ACTIVITY_FILE)
    : path.join(baseDir, "admin-activity.jsonl");
}

/** A short, non-reversible fingerprint of a secret — safe to store in the log. */
function fingerprint(value) {
  if (typeof value !== "string" || value.length === 0) return "";
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function normalizeLimit(limit) {
  const parsed = Number.parseInt(limit, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

/**
 * Append one audit entry. Failures are reported to the caller but should be
 * caught there — a logging failure must not break the admin action itself.
 *
 * @param {string} activityFile
 * @param {{action: string, actor?: string, subject?: string, detail?: string}} event
 */
function logActivity(activityFile, event, now = new Date()) {
  const action = String(event && event.action ? event.action : "").trim();
  if (!action) {
    throw new Error("Admin activity requires an action.");
  }
  const entry = {
    id: crypto.randomUUID(),
    at: now.toISOString(),
    action,
    actor: String((event && event.actor) || ""), // which admin
    subject: String((event && event.subject) || ""), // team / survey / email
    detail: String((event && event.detail) || "")
  };
  fs.mkdirSync(path.dirname(activityFile), { recursive: true });
  fs.appendFileSync(activityFile, `${JSON.stringify(entry)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  return entry;
}

/** Best-effort logging — never let an audit-log failure break the action. */
function safeLogActivity(activityFile, event) {
  try {
    return logActivity(activityFile, event);
  } catch (err) {
    logger.error({ err }, "failed to write admin activity log");
    return null;
  }
}

/** The most recent entries, newest first. */
function listActivity(activityFile, limit = DEFAULT_LIMIT) {
  let data;
  try {
    data = fs.readFileSync(activityFile, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  const entries = data
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((e) => e && typeof e.action === "string");
  return entries.slice(-normalizeLimit(limit)).reverse();
}

module.exports = {
  KNOWN_ACTIONS,
  getActivityFilePath,
  fingerprint,
  logActivity,
  safeLogActivity,
  listActivity
};
