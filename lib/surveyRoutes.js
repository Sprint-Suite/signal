"use strict";

/**
 * lib/surveyRoutes.js — admin REST for surveys, teams, and templates.
 *
 * Mounted at /api, every route behind `requireAdmin`. Covers survey
 * create/list/configure plus the team and template lookups the builder and
 * the admin/team-management screen need.
 */

const express = require("express");
const db = require("./db");
const accessKeys = require("./accessKeys");
const { safeLogActivity } = require("./adminActivity");
const { teamCompanyAllowed } = require("./companyAccess");
const { validate } = require("./validate");
const { teamSchema, surveySchema } = require("../schemas/survey");

function surveyLink(appBaseUrl, accessCode) {
  return `${String(appBaseUrl || "").replace(/\/+$/, "")}/s/${accessCode}`;
}

function publicTeam(team) {
  return {
    id: team.id,
    name: team.name,
    weak: Boolean(team.weak),
    createdAt: team.created_at
  };
}

function surveySummary(row, appBaseUrl) {
  return {
    id: row.id,
    teamId: row.team_id,
    teamName: row.team_name,
    templateId: row.template_id,
    templateName: row.template_name,
    templateVersion: row.template_version,
    parentSurveyId: row.parent_survey_id,
    accessCode: row.access_code,
    link: surveyLink(appBaseUrl, row.access_code),
    status: row.status,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
    responseCount: row.response_count,
    flaggedCount: row.flagged_count
  };
}

// `auth.requireAuth` is applied by httpApp.js at the /api admin mount, so every
// handler here can rely on `req.user` (= { id }) already being set.
function createSurveyRoutes({ conn, appBaseUrl, activityFile }) {
  const router = express.Router();

  // `req.user.company` is `{ id, name }` or null (set by auth.requireAuth).
  const companyOf = (req) => (req.user && req.user.company) || null;

  function generateUniqueAccessCode() {
    for (let i = 0; i < 6; i += 1) {
      const code = accessKeys.generateAccessKey();
      if (!db.getSurveyByAccessCode(conn, code)) return code;
    }
    throw new Error("Could not allocate a unique survey access code.");
  }

  // --- Templates -----------------------------------------------------------
  router.get("/templates", (_req, res) => {
    res.json({
      templates: db.listTemplates(conn).map((t) => ({
        id: t.id,
        name: t.name,
        version: t.version,
        isActive: Boolean(t.is_active)
      }))
    });
  });

  // --- Teams ---------------------------------------------------------------
  router.get("/teams", (req, res) => {
    const company = companyOf(req);
    const teams = company ? db.listTeamsForCompany(conn, company.id) : [];
    res.json({ teams: teams.map(publicTeam) });
  });

  router.post("/teams", validate(teamSchema), (req, res) => {
    const company = companyOf(req);
    if (!company) {
      return res.status(403).json({ error: "No company is associated with your session. Please sign in again." });
    }
    const name = req.body.name;
    const key = accessKeys.createTeamKey();
    let team;
    try {
      team = db.createTeam(conn, {
        companyId: company.id,
        name,
        keyHash: key.keyHash,
        keySalt: key.keySalt,
        weak: key.weak
      });
    } catch (err) {
      if (err.code === "TEAM_EXISTS") {
        return res.status(409).json({ error: err.message });
      }
      throw err;
    }
    safeLogActivity(activityFile, {
      action: "team.created",
      actor: req.user.id,
      subject: team.name
    });
    // The plaintext key is shown exactly once, here.
    res.status(201).json({ team: publicTeam(team), accessKey: key.value });
  });

  router.post("/teams/:id/rotate-key", (req, res) => {
    const team = db.getTeamById(conn, req.params.id);
    if (!team || !teamCompanyAllowed(team, companyOf(req))) {
      return res.status(404).json({ error: "Team not found." });
    }
    const key = accessKeys.createTeamKey();
    db.updateTeamKey(conn, team.id, {
      keyHash: key.keyHash,
      keySalt: key.keySalt,
      weak: key.weak
    });
    safeLogActivity(activityFile, {
      action: "team.key_rotated",
      actor: req.user.id,
      subject: team.name
    });
    res.json({ team: publicTeam(team), accessKey: key.value });
  });

  router.delete("/teams/:id", (req, res) => {
    const team = db.getTeamById(conn, req.params.id);
    if (!team || !teamCompanyAllowed(team, companyOf(req))) {
      return res.status(404).json({ error: "Team not found." });
    }
    try {
      db.deleteTeam(conn, team.id);
    } catch (err) {
      if (err.code === "SQLITE_CONSTRAINT_FOREIGNKEY") {
        return res.status(409).json({
          error:
            "This team still has surveys. Delete its surveys first."
        });
      }
      throw err;
    }
    safeLogActivity(activityFile, {
      action: "team.deleted",
      actor: req.user.id,
      subject: team.name
    });
    res.json({ ok: true });
  });

  // --- Surveys -------------------------------------------------------------
  router.get("/surveys", (req, res) => {
    const company = companyOf(req);
    const rows = company ? db.listSurveysWithCountsForCompany(conn, company.id) : [];
    res.json({ surveys: rows.map((row) => surveySummary(row, appBaseUrl)) });
  });

  router.get("/surveys/:id", (req, res) => {
    const survey = db.getSurveyById(conn, req.params.id);
    if (!survey) {
      return res.status(404).json({ error: "Survey not found." });
    }
    const team = db.getTeamById(conn, survey.team_id);
    if (!teamCompanyAllowed(team, companyOf(req))) {
      return res.status(404).json({ error: "Survey not found." });
    }
    const template = db.getTemplateById(conn, survey.template_id);
    res.json({
      survey: surveySummary(
        {
          ...survey,
          team_name: team ? team.name : null,
          template_name: template ? template.name : null,
          template_version: template ? template.version : null,
          response_count: db.countResponses(conn, survey.id),
          flagged_count: db.countFlaggedResponses(conn, survey.id)
        },
        appBaseUrl
      )
    });
  });

  router.post("/surveys", (req, res) => {
    // Inline safeParse: coerce and strip unknown keys; fall back to raw body on
    // parse failure (the route's own DB checks produce the bespoke 400 bodies
    // asserted by existing tests — we preserve those rather than overriding them).
    const parsed = surveySchema.safeParse(req.body ?? {});
    const bodyData = parsed.success ? parsed.data : (req.body ?? {});
    const parentSurveyId = bodyData.parentSurveyId || null;
    let teamId = bodyData.teamId || null;
    let templateId = bodyData.templateId || null;

    const company = companyOf(req);
    if (!company) {
      return res.status(403).json({ error: "No company is associated with your session. Please sign in again." });
    }

    // A follow-up inherits its team and template from the baseline so the
    // two runs share axes and pair cleanly on the radar.
    if (parentSurveyId) {
      const parent = db.getSurveyById(conn, parentSurveyId);
      const parentTeam = parent ? db.getTeamById(conn, parent.team_id) : null;
      if (!parent || !teamCompanyAllowed(parentTeam, company)) {
        return res
          .status(400)
          .json({ error: "The chosen baseline survey was not found." });
      }
      teamId = parent.team_id;
      templateId = parent.template_id;
    }

    const team = teamId ? db.getTeamById(conn, teamId) : null;
    if (!team || !teamCompanyAllowed(team, company)) {
      return res.status(400).json({ error: "A valid team is required." });
    }
    if (!templateId || !db.getTemplateById(conn, templateId)) {
      return res.status(400).json({ error: "A valid template is required." });
    }

    const survey = db.createSurvey(conn, {
      teamId,
      templateId,
      parentSurveyId,
      accessCode: generateUniqueAccessCode()
    });
    const template = db.getTemplateById(conn, templateId);
    safeLogActivity(activityFile, {
      action: "survey.created",
      actor: req.user.id,
      subject: team.name,
      detail: parentSurveyId ? "follow-up" : "baseline"
    });
    res.status(201).json({
      survey: surveySummary(
        {
          ...survey,
          team_name: team.name,
          template_name: template.name,
          template_version: template.version,
          response_count: 0,
          flagged_count: 0
        },
        appBaseUrl
      )
    });
  });

  function transition(req, res, action, apply) {
    const survey = db.getSurveyById(conn, req.params.id);
    if (!survey) {
      return res.status(404).json({ error: "Survey not found." });
    }
    const team = db.getTeamById(conn, survey.team_id);
    if (!teamCompanyAllowed(team, companyOf(req))) {
      return res.status(404).json({ error: "Survey not found." });
    }
    apply(survey.id);
    safeLogActivity(activityFile, {
      action,
      actor: req.user.id,
      subject: team ? team.name : survey.id
    });
    return res.json({ ok: true });
  }

  router.post("/surveys/:id/close", (req, res) =>
    transition(req, res, "survey.closed", (id) => db.closeSurvey(conn, id))
  );

  router.post("/surveys/:id/reopen", (req, res) =>
    transition(req, res, "survey.reopened", (id) => db.reopenSurvey(conn, id))
  );

  router.delete("/surveys/:id", (req, res) =>
    transition(req, res, "survey.deleted", (id) => db.deleteSurvey(conn, id))
  );

  return router;
}

module.exports = { createSurveyRoutes };
