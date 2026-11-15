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
const invites = require("./invites");
const { safeLogActivity } = require("./adminActivity");
const { teamCompanyAllowed } = require("./companyAccess");
const { validate } = require("./validate");
const { teamSchema, surveySchema, inviteBatchSchema } = require("../schemas/survey");

function surveyLink(appBaseUrl, code) {
  return `${String(appBaseUrl || "").replace(/\/+$/, "")}/s/${code}`;
}

function publicTeam(team) {
  return {
    id: team.id,
    name: team.name,
    weak: Boolean(team.weak),
    createdAt: team.created_at
  };
}

function surveySummary(row, inviteCounts) {
  return {
    id: row.id,
    teamId: row.team_id,
    teamName: row.team_name,
    templateId: row.template_id,
    templateName: row.template_name,
    templateVersion: row.template_version,
    parentSurveyId: row.parent_survey_id,
    status: row.status,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
    responseCount: row.response_count,
    flaggedCount: row.flagged_count,
    invitesTotal: inviteCounts.total,
    invitesUsed: inviteCounts.used
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
  const inviteLinks = (codes) => codes.map((code) => surveyLink(appBaseUrl, code));
  const summarise = (row) => surveySummary(row, invites.countInvites(conn, row.id));

  /** The survey and its team when the session company owns it, else null. */
  function loadOwnedSurvey(req) {
    const survey = db.getSurveyById(conn, req.params.id);
    const team = survey ? db.getTeamById(conn, survey.team_id) : null;
    if (!survey || !teamCompanyAllowed(team, companyOf(req))) return null;
    return { survey, team };
  }

  /**
   * Resolve the team and template a new survey runs against. A follow-up
   * inherits both from its baseline so the two runs pair on the radar.
   * Returns { team, template } or { error }.
   */
  function resolveSurveyTarget(company, body) {
    let { teamId, templateId } = body;
    if (body.parentSurveyId) {
      const parent = db.getSurveyById(conn, body.parentSurveyId);
      const parentTeam = parent ? db.getTeamById(conn, parent.team_id) : null;
      if (!parent || !teamCompanyAllowed(parentTeam, company)) {
        return { error: "The chosen baseline survey was not found." };
      }
      teamId = parent.team_id;
      templateId = parent.template_id;
    }
    const team = teamId ? db.getTeamById(conn, teamId) : null;
    if (!team || !teamCompanyAllowed(team, company)) {
      return { error: "A valid team is required." };
    }
    const template = templateId ? db.getTemplateById(conn, templateId) : null;
    if (!template) return { error: "A valid template is required." };
    return { team, template };
  }

  function createSurveyWithInvites({ team, template }, body) {
    return conn.transaction(() => {
      const survey = db.createSurvey(conn, {
        teamId: team.id,
        templateId: template.id,
        parentSurveyId: body.parentSurveyId,
        accessCode: generateUniqueAccessCode()
      });
      return { survey, codes: invites.createInvites(conn, survey.id, body.inviteCount) };
    })();
  }

  router.get("/surveys", (req, res) => {
    const company = companyOf(req);
    const rows = company ? db.listSurveysWithCountsForCompany(conn, company.id) : [];
    res.json({ surveys: rows.map(summarise) });
  });

  router.get("/surveys/:id", (req, res) => {
    const owned = loadOwnedSurvey(req);
    if (!owned) return res.status(404).json({ error: "Survey not found." });
    const { survey, team } = owned;
    const template = db.getTemplateById(conn, survey.template_id);
    res.json({
      survey: summarise({
        ...survey,
        team_name: team.name,
        template_name: template ? template.name : null,
        template_version: template ? template.version : null,
        response_count: db.countResponses(conn, survey.id),
        flagged_count: db.countFlaggedResponses(conn, survey.id)
      })
    });
  });

  router.post("/surveys", validate(surveySchema), (req, res) => {
    const company = companyOf(req);
    if (!company) {
      return res.status(403).json({ error: "No company is associated with your session. Please sign in again." });
    }
    const target = resolveSurveyTarget(company, req.body);
    if (target.error) return res.status(400).json({ error: target.error });

    const { survey, codes } = createSurveyWithInvites(target, req.body);
    safeLogActivity(activityFile, {
      action: "survey.created",
      actor: req.user.id,
      subject: target.team.name,
      detail: req.body.parentSurveyId ? "follow-up" : "baseline"
    });
    res.status(201).json({
      survey: summarise({
        ...survey,
        team_name: target.team.name,
        template_name: target.template.name,
        template_version: target.template.version,
        response_count: 0,
        flagged_count: 0
      }),
      inviteLinks: inviteLinks(codes)
    });
  });

  router.post("/surveys/:id/invites", validate(inviteBatchSchema), (req, res) => {
    const owned = loadOwnedSurvey(req);
    if (!owned) return res.status(404).json({ error: "Survey not found." });
    if (owned.survey.status !== "open") {
      return res.status(409).json({ error: "This survey is closed." });
    }
    const codes = invites.createInvites(conn, owned.survey.id, req.body.count);
    safeLogActivity(activityFile, {
      action: "survey.invites_added",
      actor: req.user.id,
      subject: owned.team.name,
      detail: String(req.body.count)
    });
    res.status(201).json({ inviteLinks: inviteLinks(codes) });
  });

  function transition(req, res, action, apply) {
    const owned = loadOwnedSurvey(req);
    if (!owned) return res.status(404).json({ error: "Survey not found." });
    apply(owned.survey.id);
    safeLogActivity(activityFile, {
      action,
      actor: req.user.id,
      subject: owned.team.name
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
