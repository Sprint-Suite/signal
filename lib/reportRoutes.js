"use strict";

/**
 * lib/reportRoutes.js — aggregated, admin-only reporting.
 *
 * Mounted at /api, behind `requireAdmin`:
 *   GET /api/surveys/:id/report      radar data + prioritised insights
 *   GET /api/surveys/:id/breakdown   per-question detail
 *   GET /api/surveys/:id/export.csv  CSV of the per-question breakdown
 *
 * Every derived value is recomputed here from immutable raw answers — nothing
 * aggregated is ever stored. Reports stay locked until a survey has at least
 * MIN_RESPONSES responses: an anonymity floor and a data-quality floor.
 */

const express = require("express");
const db = require("./db");
const {
  scoreSurvey,
  normaliseScore,
  axisSpread,
  isDivided,
  round1
} = require("./scoring");
const { getInsights } = require("./insights");
const { teamCompanyAllowed } = require("./companyAccess");

// Below this, a report reveals too much about too few people.
const MIN_RESPONSES = 3;

function surveyInfo(conn, survey) {
  const team = db.getTeamById(conn, survey.team_id);
  const template = db.getTemplateById(conn, survey.template_id);
  return {
    id: survey.id,
    status: survey.status,
    teamName: team ? team.name : null,
    templateName: template ? template.name : null,
    openedAt: survey.opened_at,
    closedAt: survey.closed_at,
    parentSurveyId: survey.parent_survey_id
  };
}

/** Mean normalised score for one survey, as a Map axisId -> mean. */
function axisMeansFor(conn, surveyId, axisMeta) {
  const scored = scoreSurvey(
    db.getScoringInputForSurvey(conn, surveyId),
    axisMeta
  );
  return new Map(scored.map((a) => [a.axisId, a]));
}

function csvField(value) {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function createReportRoutes({ conn }) {
  const router = express.Router();

  /** Resolve the survey within the session company, or send 404. */
  function loadSurvey(req, res) {
    const survey = db.getSurveyById(conn, req.params.id);
    if (!survey) {
      res.status(404).json({ error: "Survey not found." });
      return null;
    }
    const team = db.getTeamById(conn, survey.team_id);
    if (!teamCompanyAllowed(team, req.user && req.user.company)) {
      res.status(404).json({ error: "Survey not found." });
      return null;
    }
    return survey;
  }

  // --- Radar + insights ----------------------------------------------------
  router.get("/surveys/:id/report", (req, res) => {
    const survey = loadSurvey(req, res);
    if (!survey) return undefined;

    const responseCount = db.countResponses(conn, survey.id);
    if (responseCount < MIN_RESPONSES) {
      return res.status(200).json({
        locked: true,
        responseCount,
        minimumResponses: MIN_RESPONSES,
        survey: surveyInfo(conn, survey)
      });
    }

    const axisMeta = db.getAxisMetaMap(conn, survey.template_id);
    const axisList = db.getAxesForTemplate(conn, survey.template_id);
    const current = axisMeansFor(conn, survey.id, axisMeta);

    // Overlay the baseline only when it too clears the anonymity floor.
    let baseline = null;
    let baselineInfo = null;
    if (survey.parent_survey_id) {
      const parent = db.getSurveyById(conn, survey.parent_survey_id);
      if (parent && db.countResponses(conn, parent.id) >= MIN_RESPONSES) {
        baseline = axisMeansFor(conn, parent.id, axisMeta);
        baselineInfo = {
          id: parent.id,
          responseCount: db.countResponses(conn, parent.id)
        };
      }
    }

    const scoredAxes = axisList
      .map((axis) => {
        const cur = current.get(axis.id);
        if (!cur) return null;
        const base = baseline ? baseline.get(axis.id) : null;
        return {
          axisId: axis.id,
          name: axis.name,
          order: axis.display_order,
          description: axis.description,
          mean: cur.mean,
          count: cur.count,
          spread: cur.spread,
          divided: cur.divided,
          baselineMean: base ? base.mean : null
        };
      })
      .filter(Boolean);

    const insights = getInsights(scoredAxes);
    // Merge axis order/count/description back onto the insight axes.
    const byId = new Map(scoredAxes.map((a) => [a.axisId, a]));
    const decorate = (a) => ({
      ...a,
      order: byId.get(a.axisId).order,
      count: byId.get(a.axisId).count,
      description: byId.get(a.axisId).description
    });

    res.status(200).json({
      locked: false,
      survey: surveyInfo(conn, survey),
      responseCount,
      flaggedCount: db.countFlaggedResponses(conn, survey.id),
      hasBaseline: Boolean(baseline),
      baseline: baselineInfo,
      axes: insights.axes.map(decorate),
      focusAreas: insights.focusAreas.map(decorate),
      guidanceNote: insights.guidanceNote
    });
  });

  /** Shared per-question aggregation for the breakdown view and CSV. */
  function buildBreakdown(conn, survey) {
    const rows = db.getAnswersWithQuestionForSurvey(conn, survey.id);
    const byQuestion = new Map();
    for (const row of rows) {
      if (!byQuestion.has(row.question_id)) {
        byQuestion.set(row.question_id, {
          questionId: row.question_id,
          text: row.question_text,
          axisId: row.axis_id,
          order: row.display_order,
          isReverse: Boolean(row.is_reverse_scored),
          values: []
        });
      }
      byQuestion
        .get(row.question_id)
        .values.push(normaliseScore(row.score, Boolean(row.is_reverse_scored)));
    }

    const axisMeta = db.getAxisMetaMap(conn, survey.template_id);
    return [...byQuestion.values()]
      .map((q) => {
        const axis = axisMeta.get(q.axisId);
        const mean =
          q.values.reduce((s, v) => s + v, 0) / q.values.length;
        return {
          questionId: q.questionId,
          text: q.text,
          axisId: q.axisId,
          axisName: axis ? axis.name : "",
          order: q.order,
          count: q.values.length,
          mean: round1(mean),
          spread: axisSpread(q.values),
          divided: isDivided(q.values)
        };
      })
      // Ranked low-to-high: weakest questions first.
      .sort((a, b) => a.mean - b.mean);
  }

  // --- Per-question breakdown ---------------------------------------------
  router.get("/surveys/:id/breakdown", (req, res) => {
    const survey = loadSurvey(req, res);
    if (!survey) return undefined;

    const responseCount = db.countResponses(conn, survey.id);
    if (responseCount < MIN_RESPONSES) {
      return res.status(200).json({
        locked: true,
        responseCount,
        minimumResponses: MIN_RESPONSES,
        survey: surveyInfo(conn, survey)
      });
    }
    res.status(200).json({
      locked: false,
      survey: surveyInfo(conn, survey),
      responseCount,
      questions: buildBreakdown(conn, survey)
    });
  });

  // --- CSV export ----------------------------------------------------------
  router.get("/surveys/:id/export.csv", (req, res) => {
    const survey = loadSurvey(req, res);
    if (!survey) return undefined;

    const responseCount = db.countResponses(conn, survey.id);
    if (responseCount < MIN_RESPONSES) {
      return res.status(409).json({
        error: `A report needs at least ${MIN_RESPONSES} responses.`
      });
    }

    const header = [
      "Axis",
      "Question Order",
      "Question",
      "Responses",
      "Mean (1-5, higher is healthier)",
      "Spread",
      "Divided"
    ];
    const lines = [header.map(csvField).join(",")];
    for (const q of buildBreakdown(conn, survey)) {
      lines.push(
        [
          q.axisName,
          q.order + 1,
          q.text,
          q.count,
          q.mean,
          q.spread,
          q.divided ? "yes" : "no"
        ]
          .map(csvField)
          .join(",")
      );
    }

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="signal-survey-${survey.id}.csv"`
    );
    res.status(200).send(`${lines.join("\n")}\n`);
  });

  return router;
}

module.exports = { MIN_RESPONSES, createReportRoutes };
