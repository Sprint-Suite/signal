"use strict";

/**
 * lib/httpApp.js — builds the Express app.
 *
 * Wires security headers, JSON parsing, sessions, the admin-route guard, the
 * API route modules, static page serving, and error handling. All survey
 * logic lives in the route modules; this file is composition.
 *
 * Route mounting is deliberately ordered so the guard never catches a public
 * path:
 *   /api/auth      authRoutes      (own per-route guarding)
 *   /api/respond   responseRoutes  (public, anonymous)
 *   /api           adminApi        (requireAdmin, then survey + report routes)
 */

const path = require("path");
const express = require("express");
const db = require("./db");
const { securityHeaders } = require("./securityHeaders");
const { createAuthRoutes } = require("./authRoutes");
const { createSurveyRoutes } = require("./surveyRoutes");
const { createResponseRoutes } = require("./responseRoutes");
const { createReportRoutes } = require("./reportRoutes");

function createHttpApp({
  conn,
  sessions,
  rateLimiter,
  mailer,
  buildInfo = {},
  publicDir,
  activityFile,
  appBaseUrl
}) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1); // behind Nginx in production
  app.set("etag", false);

  app.use(securityHeaders);
  app.use(express.json({ limit: "32kb" }));
  app.use(sessions.middleware);

  /**
   * Admin guard: a valid session AND a verified, active account. Holds the
   * loaded user on `req.user`. Session carries only a userId — the rest is
   * looked up fresh here every request.
   */
  function requireAdmin(req, res, next) {
    if (!req.session) {
      return res.status(401).json({ error: "Please sign in." });
    }
    const user = db.getUserById(conn, req.session.userId);
    if (!user || !user.is_active) {
      return res.status(401).json({ error: "Please sign in." });
    }
    if (!user.email_verified) {
      return res.status(403).json({
        error: "Verify your email address to continue.",
        needsVerification: true
      });
    }
    req.user = user;
    next();
  }

  // --- Health --------------------------------------------------------------
  app.get("/health", (_req, res) => {
    res.status(200).json({
      status: "ok",
      version: buildInfo.version || "unknown",
      commit: buildInfo.commit || "unknown",
      schemaVersion: db.getSchemaVersion(conn),
      uptime: Math.round(process.uptime())
    });
  });

  // --- API -----------------------------------------------------------------
  app.use(
    "/api/auth",
    createAuthRoutes({
      conn,
      sessions,
      rateLimiter,
      mailer,
      appBaseUrl,
      activityFile,
      requireAdmin
    })
  );
  app.use("/api/respond", createResponseRoutes({ conn }));

  const adminApi = express.Router();
  adminApi.use(requireAdmin);
  adminApi.use(createSurveyRoutes({ conn, appBaseUrl, activityFile }));
  adminApi.use(createReportRoutes({ conn }));
  app.use("/api", adminApi);

  // Any other /api path is a JSON 404, not the HTML fallthrough.
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found." });
  });

  // --- Static pages --------------------------------------------------------
  function sendPage(res, file) {
    res.sendFile(path.join(publicDir, file), (err) => {
      if (err && !res.headersSent) {
        res.status(err.statusCode === 404 || err.code === "ENOENT" ? 404 : 500);
        res.type("text/plain").send("Not found.");
      }
    });
  }

  app.get("/", (_req, res) => sendPage(res, "index.html"));
  app.get("/s/:code", (_req, res) => sendPage(res, "respond.html"));
  app.get("/verify", (_req, res) => sendPage(res, "verify.html"));
  app.get("/reset", (_req, res) => sendPage(res, "reset.html"));
  app.get("/forgot", (_req, res) => sendPage(res, "forgot.html"));
  app.get("/license", (_req, res) => sendPage(res, "license.html"));
  app.get("/licence", (_req, res) => sendPage(res, "license.html"));

  app.use(
    express.static(publicDir, {
      dotfiles: "ignore",
      index: false,
      extensions: ["html"],
      redirect: false,
      etag: false,
      lastModified: false,
      cacheControl: false,
      acceptRanges: false
    })
  );

  // --- Fallbacks -----------------------------------------------------------
  app.use((_req, res) => {
    res.status(404).type("text/plain").send("Not found.");
  });

  app.use((err, _req, res, next) => {
    if (res.headersSent) return next(err);
    if (err && (err.type === "entity.parse.failed" || err.status === 400)) {
      return res.status(400).json({ error: "Invalid request body." });
    }
    if (err && err.type === "entity.too.large") {
      return res.status(413).json({ error: "Request body too large." });
    }
    console.error("Unhandled error:", err);
    res.status(500).json({ error: "Something went wrong." });
  });

  return app;
}

module.exports = { createHttpApp };
