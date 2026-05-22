"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const db = require("../lib/db");
const auth = require("../lib/auth");

function freshDb() {
  return db.initDb(":memory:");
}

const GOOD_PASSWORD = "correct horse battery staple";

test("a correct password verifies; a wrong password does not", async () => {
  const hash = await auth.hashPassword(GOOD_PASSWORD);
  assert.equal(await auth.verifyPassword(hash, GOOD_PASSWORD), true);
  assert.equal(await auth.verifyPassword(hash, "wrong password entirely"), false);
});

test("password hashes are argon2id, not the raw password", async () => {
  const hash = await auth.hashPassword(GOOD_PASSWORD);
  assert.ok(hash.startsWith("$argon2id$"));
  assert.ok(!hash.includes(GOOD_PASSWORD));
});

test("registerUser creates an account and rejects weak input", async () => {
  const conn = freshDb();
  const user = await auth.registerUser(conn, {
    email: "admin@example.com",
    password: GOOD_PASSWORD
  });
  assert.ok(user.id);
  assert.equal(user.email_verified, 0); // new accounts start unverified

  await assert.rejects(
    () => auth.registerUser(conn, { email: "bad", password: GOOD_PASSWORD }),
    /valid email/
  );
  await assert.rejects(
    () => auth.registerUser(conn, { email: "short@example.com", password: "tiny" }),
    /at least/
  );
  await assert.rejects(
    () =>
      auth.registerUser(conn, {
        email: "admin@example.com",
        password: GOOD_PASSWORD
      }),
    /already exists/
  );
  conn.close();
});

test("authenticate succeeds with the right password and resets failure state", async () => {
  const conn = freshDb();
  const user = await auth.registerUser(conn, {
    email: "a@example.com",
    password: GOOD_PASSWORD
  });
  // A prior failed attempt on record...
  db.recordFailedLogin(conn, user.id);

  const result = await auth.authenticate(conn, {
    email: "a@example.com",
    password: GOOD_PASSWORD
  });
  assert.equal(result.ok, true);
  assert.equal(result.user.email, "a@example.com");

  const after = db.getUserById(conn, user.id);
  assert.equal(after.failed_attempts, 0); // ...cleared on success
  assert.ok(after.last_login_at);
  conn.close();
});

test("a wrong password fails generically and increments the attempt count", async () => {
  const conn = freshDb();
  const user = await auth.registerUser(conn, {
    email: "a@example.com",
    password: GOOD_PASSWORD
  });

  const result = await auth.authenticate(conn, {
    email: "a@example.com",
    password: "not the password"
  });
  assert.equal(result.ok, false);
  assert.equal(result.message, auth.GENERIC_LOGIN_ERROR);
  assert.equal(db.getUserById(conn, user.id).failed_attempts, 1);
  conn.close();
});

test("unknown email and wrong password return the identical generic error", async () => {
  const conn = freshDb();
  await auth.registerUser(conn, {
    email: "a@example.com",
    password: GOOD_PASSWORD
  });

  const unknown = await auth.authenticate(conn, {
    email: "nobody@example.com",
    password: "whatever123456"
  });
  const wrong = await auth.authenticate(conn, {
    email: "a@example.com",
    password: "wrong password here"
  });
  assert.equal(unknown.ok, false);
  assert.equal(wrong.ok, false);
  assert.equal(unknown.message, wrong.message);
  assert.equal(unknown.message, auth.GENERIC_LOGIN_ERROR);
  conn.close();
});

test("lockout trips after the threshold and blocks even a correct password", async () => {
  const conn = freshDb();
  await auth.registerUser(conn, {
    email: "a@example.com",
    password: GOOD_PASSWORD
  });
  const lockout = { threshold: 3, minutes: 15 };

  for (let i = 0; i < 3; i += 1) {
    const r = await auth.authenticate(
      conn,
      { email: "a@example.com", password: "wrong guess number" },
      lockout
    );
    assert.equal(r.ok, false);
  }

  // The correct password is now rejected — the account is locked.
  const locked = await auth.authenticate(
    conn,
    { email: "a@example.com", password: GOOD_PASSWORD },
    lockout
  );
  assert.equal(locked.ok, false);
  assert.equal(locked.reason, "locked");
  assert.equal(locked.message, auth.GENERIC_LOGIN_ERROR);
  conn.close();
});

test("a verification token marks the account verified and is single-use", () => {
  const conn = freshDb();
  const user = db.createUser(conn, {
    email: "v@example.com",
    passwordHash: "x"
  });

  const rawToken = auth.issueVerificationToken(conn, user.id);
  const first = auth.verifyEmailToken(conn, rawToken);
  assert.equal(first.ok, true);
  assert.equal(db.getUserById(conn, user.id).email_verified, 1);

  // A second use of the same token is rejected.
  const second = auth.verifyEmailToken(conn, rawToken);
  assert.equal(second.ok, false);
  assert.equal(second.reason, "used");
  conn.close();
});

test("an expired token is rejected", () => {
  const conn = freshDb();
  const user = db.createUser(conn, {
    email: "e@example.com",
    passwordHash: "x"
  });
  // Create a token that expired an hour ago.
  const rawToken = "expired-raw-token-value";
  db.createAuthToken(conn, {
    userId: user.id,
    kind: "verify",
    tokenHash: auth.hashToken(rawToken),
    expiresAt: new Date(Date.now() - 3600000).toISOString()
  });

  const result = auth.verifyEmailToken(conn, rawToken);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "expired");
  conn.close();
});

test("tokens are stored hashed — the raw token never appears in the DB", () => {
  const conn = freshDb();
  const user = db.createUser(conn, {
    email: "h@example.com",
    passwordHash: "x"
  });
  const rawToken = auth.issueVerificationToken(conn, user.id);

  const stored = conn.prepare("SELECT token_hash FROM auth_tokens").all();
  assert.equal(stored.length, 1);
  assert.notEqual(stored[0].token_hash, rawToken);
  assert.equal(stored[0].token_hash, auth.hashToken(rawToken));
  // The hash is what lookups use.
  assert.ok(db.getAuthTokenByHash(conn, auth.hashToken(rawToken)));
  conn.close();
});

test("a reset token sets a new password, clears lockout, and is single-use", async () => {
  const conn = freshDb();
  const user = await auth.registerUser(conn, {
    email: "r@example.com",
    password: GOOD_PASSWORD
  });
  // Put the account into a locked state first.
  db.lockUser(conn, user.id, new Date(Date.now() + 600000).toISOString());

  const begin = auth.beginPasswordReset(conn, "r@example.com");
  assert.equal(begin.userExists, true);

  const NEW_PASSWORD = "a brand new strong passphrase";
  const reset = await auth.resetPasswordWithToken(conn, begin.token, NEW_PASSWORD);
  assert.equal(reset.ok, true);

  // Old password no longer works; new one does; lockout is cleared.
  const oldHash = db.getUserById(conn, user.id).password_hash;
  assert.equal(await auth.verifyPassword(oldHash, NEW_PASSWORD), true);
  assert.equal(await auth.verifyPassword(oldHash, GOOD_PASSWORD), false);
  assert.equal(db.getUserById(conn, user.id).locked_until, null);

  // The token cannot be reused.
  const reuse = await auth.resetPasswordWithToken(
    conn,
    begin.token,
    "yet another strong password"
  );
  assert.equal(reuse.ok, false);
  conn.close();
});

test("beginPasswordReset hides whether the account exists", () => {
  const conn = freshDb();
  const result = auth.beginPasswordReset(conn, "nobody@example.com");
  assert.equal(result.userExists, false);
  assert.equal(result.token, undefined);
  conn.close();
});

test("resetPasswordWithToken rejects a weak new password", async () => {
  const conn = freshDb();
  const user = await auth.registerUser(conn, {
    email: "w@example.com",
    password: GOOD_PASSWORD
  });
  const token = auth.issueResetToken(conn, user.id);
  const result = await auth.resetPasswordWithToken(conn, token, "tiny");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "weak_password");
  conn.close();
});
