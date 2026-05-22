#!/usr/bin/env node
"use strict";

/**
 * scripts/db-maintenance.js — database housekeeping.
 *
 *   node scripts/db-maintenance.js migrate              run pending migrations
 *   node scripts/db-maintenance.js retention [days]     drop old closed surveys
 *   node scripts/db-maintenance.js vacuum               reclaim disk space
 *
 * `retention` takes the day count from the argument or RETENTION_DAYS.
 */

const fs = require("fs");
const path = require("path");

const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath) && typeof process.loadEnvFile === "function") {
  process.loadEnvFile(envPath);
}

const db = require("../lib/db");

const command = process.argv[2] || "migrate";
const dbPath = path.resolve(
  __dirname,
  "..",
  process.env.DB_PATH || "data/signal.db"
);

function fail(message) {
  console.error(message);
  process.exit(1);
}

const conn = db.openDatabase(dbPath);
try {
  if (command === "migrate") {
    db.ensureSchema(conn);
    db.seedQuestionBank(conn);
    console.log(
      `Migrations complete — schema version ${db.getSchemaVersion(conn)}.`
    );
  } else if (command === "retention") {
    const days = Number.parseInt(
      process.argv[3] || process.env.RETENTION_DAYS,
      10
    );
    if (!Number.isFinite(days) || days <= 0) {
      fail("Provide a positive day count or set RETENTION_DAYS.");
    }
    db.ensureSchema(conn);
    const removed = db.applyRetention(conn, days);
    console.log(
      `Retention applied: removed ${removed} survey(s) closed more than ${days} day(s) ago.`
    );
  } else if (command === "vacuum") {
    conn.exec("VACUUM");
    console.log("Database vacuum complete.");
  } else {
    fail("Unknown command. Use: migrate, retention, or vacuum.");
  }
} catch (err) {
  fail(`Maintenance failed: ${err.message || err}`);
} finally {
  conn.close();
}
