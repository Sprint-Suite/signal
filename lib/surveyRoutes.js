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

// `requireAdmin` is applied by httpApp.js at the /api admin mount, so every
// handler here can rely on `req.user` already being set.
function createSurveyRoutes({ conn, appBaseUrl, activityFile }) {
  const router = express.Router();

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
  router.get("/teams", (_req, res) => {
    res.json({ teams: db.listTeams(conn).map(publicTeam) });
  });

  router.post("/teams", (req, res) => {
    const name = String(req.body?.name || "").trim();
    if (!name) {
      return res.status(400).json({ error: "A team name is required." });
    }
    const key = accessKeys.createTeamKey();
    let team;
    try {
      team = db.createTeam(conn, {
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
      actor: req.user.email,
      subject: team.name
    });
    // The plaintext key is shown exactly once, here.
    res.status(201).json({ team: publicTeam(team), accessKey: key.value });
  });

  router.post("/teams/:id/rotate-key", (req, res) => {
    const team = db.getTeamById(conn, req.params.id);
    if (!team) {
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
      actor: req.user.email,
      subject: team.name
    });
    res.json({ team: publicTeam(team), accessKey: key.value });
  });

  router.delete("/teams/:id", (req, res) => {
    const team = db.getTeamById(conn, req.params.id);
    if (!team) {
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
      actor: req.user.email,
      subject: team.name
    });
    res.json({ ok: true });
  });

  // --- Surveys -------------------------------------------------------------
  router.get("/surveys", (_req, res) => {
    res.json({
      surveys: db
        .listSurveysWithCounts(conn)
        .map((row) => surveySummary(row, appBaseUrl))
    });
  });

  router.get("/surveys/:id", (req, res) => {
    const survey = db.getSurveyById(conn, req.params.id);
    if (!survey) {
      return res.status(404).json({ error: "Survey not found." });
    }
    const team = db.getTeamById(conn, survey.team_id);
    const template = db.getTemplateById(conn, survey.template_id);
    res.json({
      survey: surveySummary(
        {
          ...survey,
          team_name: team ? team.name : null,
          template_name: template ? template.name : null,
          response_count: db.countResponses(conn, survey.id),
          flagged_count: db.countFlaggedResponses(conn, survey.id)
        },
        appBaseUrl
      )
    });
  });

  router.post("/surveys", (req, res) => {
    const parentSurveyId = req.body?.parentSurveyId || null;
    let teamId = req.body?.teamId || null;
    let templateId = req.body?.templateId || null;

    // A follow-up inherits its team and template from the baseline so the
    // two runs share axes and pair cleanly on the radar.
    if (parentSurveyId) {
      const parent = db.getSurveyById(conn, parentSurveyId);
      if (!parent) {
        return res
          .status(400)
          .json({ error: "The chosen baseline survey was not found." });
      }
      teamId = parent.team_id;
      templateId = parent.template_id;
    }

    if (!teamId || !db.getTeamById(conn, teamId)) {
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
    const team = db.getTeamById(conn, teamId);
    safeLogActivity(activityFile, {
      action: "survey.created",
      actor: req.user.email,
      subject: team.name,
      detail: parentSurveyId ? "follow-up" : "baseline"
    });
    res.status(201).json({
      survey: surveySummary(
        {
          ...survey,
          team_name: team.name,
          template_name: db.getTemplateById(conn, templateId).name,
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
    apply(survey.id);
    const team = db.getTeamById(conn, survey.team_id);
    safeLogActivity(activityFile, {
      action,
      actor: req.user.email,
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
