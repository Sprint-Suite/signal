#!/usr/bin/env node
"use strict";

/**
 * manageKeys.js — Signal admin CLI.
 *
 * Manages admin accounts (and, from milestone 3, team access keys). There is
 * no public registration: the first admin must be seeded here before anyone
 * can log in.
 *
 * Commands:
 *   node manageKeys.js create-admin --email you@example.com
 *   node manageKeys.js reset-admin  --email you@example.com
 *   node manageKeys.js list-admins
 *
 * Passwords are always prompted for, never passed as arguments — an argument
 * would leak into shell history.
 */

const fs = require("fs");
const path = require("path");
const readline = require("readline");

// Load .env (local dev). In production the systemd unit supplies the env.
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath) && typeof process.loadEnvFile === "function") {
  process.loadEnvFile(envPath);
}

const db = require("./lib/db");
const auth = require("./lib/auth");

const DB_PATH = path.resolve(__dirname, process.env.DB_PATH || "data/signal.db");
const BASE_URL = process.env.APP_BASE_URL || "http://localhost:3002";

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i += 1;
      } else {
        flags[key] = true;
      }
    }
  }
  return flags;
}

// ---------------------------------------------------------------------------
// Prompts
//
// One shared readline interface for the whole session: a fresh interface per
// prompt would drop input buffered past the first line (breaking piped input).
// `askHidden` suppresses the echo so passwords are not shown on screen.
// ---------------------------------------------------------------------------

function createPrompter() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  let muted = false;
  let closed = false;
  const waiters = []; // unfulfilled line requests
  const buffered = []; // lines that arrived before anyone asked

  // Echo every character except while muted (password entry).
  rl._writeToOutput = (chunk) => {
    if (!muted) rl.output.write(chunk);
  };
  // Queue lines ourselves so input buffered ahead (piped stdin) is not lost.
  rl.on("line", (line) => {
    if (waiters.length) waiters.shift().resolve(line);
    else buffered.push(line);
  });
  rl.on("close", () => {
    closed = true;
    while (waiters.length) {
      waiters.shift().reject(new Error("Input stream closed."));
    }
  });

  function nextLine() {
    if (buffered.length) return Promise.resolve(buffered.shift());
    if (closed) return Promise.reject(new Error("Input stream closed."));
    return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
  }

  async function ask(question) {
    process.stdout.write(question);
    return String(await nextLine()).trim();
  }

  async function askHidden(question) {
    process.stdout.write(question);
    muted = true;
    try {
      return String(await nextLine());
    } finally {
      muted = false;
      process.stdout.write("\n");
    }
  }

  return { ask, askHidden, close: () => rl.close() };
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function createAdmin(conn, flags, prompter) {
  const email = flags.email || (await prompter.ask("Admin email: "));
  if (!auth.isValidEmail(email)) {
    throw new Error(`"${email}" is not a valid email address.`);
  }

  const password = await prompter.askHidden(
    `Choose a password (min ${auth.MIN_PASSWORD_LENGTH} characters): `
  );
  const confirm = await prompter.askHidden("Confirm password: ");
  if (password !== confirm) {
    throw new Error("Passwords did not match.");
  }

  const user = await auth.registerUser(conn, { email, password });
  const link = auth.verificationLink(
    BASE_URL,
    auth.issueVerificationToken(conn, user.id)
  );

  console.log("");
  console.log(`Admin account created: ${user.email}`);
  console.log("");
  console.log("The account is not yet verified. Open this link to verify it");
  console.log("(email delivery is deferred in v1, so the link is shown here):");
  console.log("");
  console.log(`  ${link}`);
  console.log("");
  console.log("The Signal server must be running to complete verification.");
}

async function resetAdmin(conn, flags, prompter) {
  const email = flags.email || (await prompter.ask("Admin email: "));
  const result = auth.beginPasswordReset(conn, email);
  if (!result.userExists) {
    throw new Error(`No active admin account found for "${email}".`);
  }
  const link = auth.resetLink(BASE_URL, result.token);

  console.log("");
  console.log(`One-time password reset link for ${result.email}`);
  console.log(`(valid for ${auth.RESET_TOKEN_TTL_HOURS} hour):`);
  console.log("");
  console.log(`  ${link}`);
  console.log("");
}

function listAdmins(conn) {
  const users = db.listUsers(conn);
  if (users.length === 0) {
    console.log("No admin accounts yet. Create one with: create-admin --email <email>");
    return;
  }
  console.log(`Admin accounts (${users.length}):`);
  for (const u of users) {
    const tags = [
      u.email_verified ? "verified" : "unverified",
      u.is_active ? "active" : "disabled"
    ];
    const lastLogin = u.last_login_at || "never";
    console.log(`  ${u.email}  [${tags.join(", ")}]  last login: ${lastLogin}`);
  }
}

function usage() {
  console.log("Signal admin CLI");
  console.log("");
  console.log("Usage:");
  console.log("  node manageKeys.js create-admin --email you@example.com");
  console.log("  node manageKeys.js reset-admin  --email you@example.com");
  console.log("  node manageKeys.js list-admins");
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  const [, , command, ...rest] = process.argv;
  const flags = parseFlags(rest);

  if (!command || command === "help" || command === "--help") {
    usage();
    process.exit(command ? 0 : 1);
  }

  const conn = db.initDb(DB_PATH);
  const prompter = createPrompter();
  try {
    switch (command) {
      case "create-admin":
        await createAdmin(conn, flags, prompter);
        break;
      case "reset-admin":
        await resetAdmin(conn, flags, prompter);
        break;
      case "list-admins":
        listAdmins(conn);
        break;
      default:
        console.error(`Unknown command: ${command}`);
        console.error("");
        usage();
        process.exitCode = 1;
    }
  } finally {
    prompter.close();
    conn.close();
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message || err}`);
  process.exit(1);
});
