"use strict";

/**
 * lib/httpApp.js — builds the Express app.
 *
 * Wires security headers, JSON parsing, the auth-hub integration, the API
 * route modules, static asset serving, the (guarded) authenticated pages, and
 * error handling. All survey logic lives in the route modules; this file is
 * composition.
 *
 * Authentication is delegated to the central hub via @suite/auth-client:
 *   /auth/launch    one-time launch token -> local app session cookie
 *   /auth/logout    revoke central session, clear cookie, bounce to hub
 *   /auth/whoami    suite-session status as JSON, no redirect (public)
 *   /api/heartbeat  keep-alive / revocation check for the browser
 *   /auth-client/*  the browser heartbeat asset
 *
 * Route mounting is ordered so the guard never catches a public path:
 *   /api/respond   responseRoutes  (public, anonymous respondents)
 *   /api           adminApi        (auth.requireAuth, then survey + report routes)
 * Authenticated PAGES (/dashboard, /admin, /survey) are guarded with
 * auth.requireAuth and bounce to the hub login when no session is present.
 */

const path = require("path");
const express = require("express");
const db = require("./db");
const { logger } = require("./logger.js");
const { makeRequestLogger } = require("../middleware/requestLogger.js");
const { makeErrorHandler } = require("../middleware/errorHandler.js");
const { makeSecurityHeaders } = require("../middleware/securityHeaders.js");
const { createSurveyRoutes } = require("./surveyRoutes");
const { createResponseRoutes } = require("./responseRoutes");
const { createReportRoutes } = require("./reportRoutes");

function createHttpApp({
  conn,
  auth,
  buildInfo = {},
  publicDir,
  activityFile,
  appBaseUrl
}) {
  const app = express();
  app.use(makeRequestLogger(logger));
  app.disable("x-powered-by");
  app.set("trust proxy", 1); // behind the Apache reverse proxy in production
  app.set("etag", false);

  app.use(makeSecurityHeaders());
  app.use(express.json({ limit: "32kb" }));

  // --- Auth hub integration ------------------------------------------------
  app.use("/auth-client", auth.staticAssets);
  app.get("/auth/launch", auth.handleLaunch);
  app.get("/auth/logout", auth.handleLogout);
  app.get("/auth/whoami", auth.handleWhoami);
  app.post("/api/heartbeat", auth.handleHeartbeat);

  // --- Health (public) -----------------------------------------------------
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
  // The respondent flow is public and anonymous — mounted before the guard.
  app.use("/api/respond", createResponseRoutes({ conn }));

  // Everything else under /api is the facilitator admin surface, guarded by
  // the hub session. requireAuth attaches req.user = { id }.
  const adminApi = express.Router();
  adminApi.use(auth.requireAuth);
  adminApi.use(createSurveyRoutes({ conn, appBaseUrl, activityFile }));
  adminApi.use(createReportRoutes({ conn }));
  app.use("/api", adminApi);

  // Any other /api path is a JSON 404, not the HTML fallthrough.
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found." });
  });

  // --- Public static assets ------------------------------------------------
  const assetOpts = {
    dotfiles: "ignore",
    index: false,
    redirect: false,
    etag: false,
    lastModified: false,
    cacheControl: false,
    acceptRanges: false
  };
  app.use("/css", express.static(path.join(publicDir, "css"), assetOpts));
  app.use("/js", express.static(path.join(publicDir, "js"), assetOpts));
  app.use("/fonts", express.static(path.join(publicDir, "fonts"), assetOpts));
  app.use("/illos", express.static(path.join(publicDir, "illos"), assetOpts));

  // --- Pages ---------------------------------------------------------------
  function sendPage(res, file) {
    res.sendFile(path.join(publicDir, file), (err) => {
      if (err && !res.headersSent) {
        res.status(err.statusCode === 404 || err.code === "ENOENT" ? 404 : 500);
        res.type("text/plain").send("Not found.");
      }
    });
  }

  // Public pages.
  app.get("/", (_req, res) => res.redirect(302, "/dashboard"));
  app.get("/robots.txt", (_req, res) => sendPage(res, "robots.txt"));
  app.get("/s/:code", (_req, res) => sendPage(res, "respond.html"));
  app.get("/license", (_req, res) => sendPage(res, "license.html"));
  app.get("/licence", (_req, res) => sendPage(res, "license.html"));

  // Authenticated pages — guarded; an absent/expired session bounces to the hub.
  app.get("/dashboard", auth.requireAuth, (_req, res) =>
    sendPage(res, "dashboard.html")
  );
  app.get("/admin", auth.requireAuth, (_req, res) =>
    sendPage(res, "admin.html")
  );
  app.get("/survey", auth.requireAuth, (_req, res) =>
    sendPage(res, "survey.html")
  );

  // --- Fallbacks -----------------------------------------------------------
  app.use((_req, res) => {
    res.status(404).type("text/plain").send("Not found.");
  });

  // Handle body-parser-specific errors before the generic handler.
  app.use((err, _req, res, next) => {
    if (err && (err.type === "entity.parse.failed" || err.status === 400)) {
      return res.status(400).json({ error: "Invalid request body." });
    }
    if (err && err.type === "entity.too.large") {
      return res.status(413).json({ error: "Request body too large." });
    }
    return next(err);
  });

  app.use(makeErrorHandler({ logger, nodeEnv: process.env.NODE_ENV }));

  return app;
}

module.exports = { createHttpApp };
