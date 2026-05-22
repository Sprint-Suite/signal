"use strict";

/**
 * lib/authRoutes.js — admin authentication HTTP routes.
 *
 * Mounted at /api/auth. Covers the full account lifecycle: login, logout,
 * session check, password reset, email verification, and admin invites.
 * Auth *logic* lives in lib/auth.js; this module is the HTTP seam around it.
 *
 * (The spec's lib/ list names the survey/response/report route modules but
 * not an auth route module — these routes are their own cohesive concern, so
 * they get their own file rather than bloating httpApp.js.)
 */

const express = require("express");
const crypto = require("crypto");
const auth = require("./auth");
const db = require("./db");
const { safeLogActivity } = require("./adminActivity");

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    emailVerified: Boolean(user.email_verified),
    createdAt: user.created_at,
    lastLoginAt: user.last_login_at
  };
}

function createAuthRoutes({
  conn,
  sessions,
  rateLimiter,
  mailer,
  appBaseUrl,
  activityFile,
  requireAdmin
}) {
  const router = express.Router();

  async function sendMailQuietly(message) {
    try {
      await mailer.sendMail(message);
    } catch (err) {
      // Never let a delivery failure leak through a generic-response flow.
      console.error("Mail send failed:", err.message);
    }
  }

  // --- Login ---------------------------------------------------------------
  router.post("/login", async (req, res) => {
    const ip = req.ip || "unknown";
    if (rateLimiter.isBlocked(ip)) {
      return res
        .status(429)
        .json({ error: "Too many attempts. Please wait and try again." });
    }

    const email = String(req.body?.email || "");
    const password = String(req.body?.password || "");

    const result = await auth.authenticate(conn, { email, password });
    if (!result.ok) {
      rateLimiter.recordFailure(ip);
      return res.status(401).json({ error: result.message });
    }

    rateLimiter.recordSuccess(ip);
    sessions.start(res, result.user.id);
    safeLogActivity(activityFile, {
      action: "admin.login",
      actor: result.user.email
    });
    return res.status(200).json({ ok: true, user: publicUser(result.user) });
  });

  // --- Logout --------------------------------------------------------------
  router.post("/logout", (req, res) => {
    sessions.end(req, res);
    res.status(200).json({ ok: true });
  });

  // --- Current session -----------------------------------------------------
  router.get("/me", (req, res) => {
    if (!req.session) {
      return res.status(401).json({ error: "Not signed in." });
    }
    const user = db.getUserById(conn, req.session.userId);
    if (!user || !user.is_active) {
      sessions.end(req, res);
      return res.status(401).json({ error: "Not signed in." });
    }
    res.status(200).json({ user: publicUser(user) });
  });

  // --- Forgot password (always a generic response) -------------------------
  router.post("/forgot", async (req, res) => {
    const email = String(req.body?.email || "");
    const result = auth.beginPasswordReset(conn, email);
    if (result.userExists) {
      await sendMailQuietly({
        to: result.email,
        subject: "Reset your Signal password",
        body:
          "A password reset was requested for your Signal admin account.\n\n" +
          `Open this link to choose a new password:\n\n  ${auth.resetLink(
            appBaseUrl,
            result.token
          )}\n\n` +
          `This link expires in ${auth.RESET_TOKEN_TTL_HOURS} hour. ` +
          "If you did not request this, you can ignore this email."
      });
    }
    // Identical response whether or not the account exists — no enumeration.
    res.status(200).json({
      ok: true,
      message:
        "If an account exists for that email, a reset link has been sent."
    });
  });

  // --- Reset password ------------------------------------------------------
  router.post("/reset", async (req, res) => {
    const token = String(req.body?.token || "");
    const password = String(req.body?.password || "");
    const result = await auth.resetPasswordWithToken(conn, token, password);
    if (!result.ok) {
      const status = result.reason === "weak_password" ? 400 : 410;
      return res.status(status).json({
        error:
          result.message ||
          "This reset link is invalid or has expired. Request a new one."
      });
    }
    res.status(200).json({ ok: true });
  });

  // --- Verify email --------------------------------------------------------
  router.post("/verify", (req, res) => {
    const token = String(req.body?.token || "");
    const result = auth.verifyEmailToken(conn, token);
    if (!result.ok) {
      return res.status(410).json({
        error:
          "This verification link is invalid or has expired. " +
          "Sign in and request a new one."
      });
    }
    res.status(200).json({ ok: true });
  });

  // --- Resend verification (for the signed-in, still-unverified admin) -----
  router.post("/resend-verification", async (req, res) => {
    if (!req.session) {
      return res.status(401).json({ error: "Not signed in." });
    }
    const user = db.getUserById(conn, req.session.userId);
    if (!user || !user.is_active) {
      return res.status(401).json({ error: "Not signed in." });
    }
    if (user.email_verified) {
      return res
        .status(400)
        .json({ error: "This account is already verified." });
    }
    await sendMailQuietly({
      to: user.email,
      subject: "Verify your Signal admin account",
      body:
        "Open this link to verify your Signal admin account:\n\n" +
        `  ${auth.verificationLink(
          appBaseUrl,
          auth.issueVerificationToken(conn, user.id)
        )}\n\n` +
        `This link expires in ${auth.VERIFY_TOKEN_TTL_HOURS} hours.`
    });
    res.status(200).json({ ok: true, message: "Verification email sent." });
  });

  // --- Change own password (signed-in user) --------------------------------
  router.post("/change-password", async (req, res) => {
    if (!req.session) {
      return res.status(401).json({ error: "Not signed in." });
    }
    const result = await auth.changePassword(
      conn,
      req.session.userId,
      String(req.body?.currentPassword || ""),
      String(req.body?.newPassword || "")
    );
    if (!result.ok) {
      const status = result.reason === "bad_current" ? 403 : 400;
      return res
        .status(status)
        .json({ error: result.message || "Could not change the password." });
    }
    res.status(200).json({ ok: true });
  });

  // --- Change own login email (signed-in user) -----------------------------
  router.post("/change-email", async (req, res) => {
    if (!req.session) {
      return res.status(401).json({ error: "Not signed in." });
    }
    const result = await auth.changeEmail(
      conn,
      req.session.userId,
      String(req.body?.currentPassword || ""),
      String(req.body?.newEmail || "")
    );
    if (!result.ok) {
      const status =
        result.reason === "bad_current"
          ? 403
          : result.reason === "email_exists"
            ? 409
            : 400;
      return res
        .status(status)
        .json({ error: result.message || "Could not change the email." });
    }
    res.status(200).json({ ok: true, email: result.email });
  });

  // --- Invite a new admin (admin-only) -------------------------------------
  router.post("/invite", requireAdmin, async (req, res) => {
    const email = String(req.body?.email || "");
    if (!auth.isValidEmail(email)) {
      return res
        .status(400)
        .json({ error: "A valid email address is required." });
    }
    // The invited account is created verified — the existing admin is
    // vouching for it. A random password placeholder is set; the invitee
    // chooses their real password via the reset link below.
    let user;
    try {
      user = await auth.registerUser(conn, {
        email,
        password: crypto.randomBytes(24).toString("base64url"),
        emailVerified: true
      });
    } catch (err) {
      if (err.code === "EMAIL_EXISTS") {
        return res
          .status(409)
          .json({ error: "An account with that email already exists." });
      }
      throw err;
    }

    await sendMailQuietly({
      to: user.email,
      subject: "You have been invited to Signal",
      body:
        "An administrator has created a Signal admin account for you.\n\n" +
        `Set your password here:\n\n  ${auth.resetLink(
          appBaseUrl,
          auth.issueResetToken(conn, user.id)
        )}\n\n` +
        `This link expires in ${auth.RESET_TOKEN_TTL_HOURS} hour.`
    });

    safeLogActivity(activityFile, {
      action: "admin.invited",
      actor: req.user.email,
      subject: user.email
    });
    res.status(201).json({ ok: true, email: user.email });
  });

  return router;
}

module.exports = { createAuthRoutes };
