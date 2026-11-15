"use strict";

/**
 * lib/responseRoutes.js — the public, anonymous respondent flow.
 *
 * No authentication and no identity: a respondent reaches a survey only via
 * a single-use invite code. Nothing here writes or reads anything that could
 * tie a response back to a person or to the invite it came from.
 *
 * Mounted at /api/respond:
 *   GET  /api/respond/:code   the survey's questions, if open and unused
 *   POST /api/respond/:code   submit a complete set of answers, once
 */

const express = require("express");
const db = require("./db");
const invites = require("./invites");
const { checkResponseQuality } = require("./quality");
const { SCALE_MIN, SCALE_MAX } = require("./scoring");
const { validate } = require("./validate");
const { respondSchema } = require("../schemas/respond");

const CLOSED_ERROR = "This survey is closed and no longer accepting responses.";
const USED_ERROR = "This link has already been used.";

function teamOf(conn, survey) {
  const team = db.getTeamById(conn, survey.team_id);
  return team ? { name: team.name } : null;
}

/** The invite and its survey for a code, or null when the code is unknown. */
function resolveInvite(conn, code) {
  const invite = invites.findInvite(conn, code);
  const survey = invite ? db.getSurveyById(conn, invite.surveyId) : null;
  return survey ? { invite, survey } : null;
}

function publicQuestions(conn, templateId) {
  // is_reverse_scored is not exposed: reverse handling is server-side.
  return db.getQuestionsForTemplate(conn, templateId).map((q) => ({
    id: q.id,
    text: q.text,
    axisId: q.axis_id,
    axisName: q.axis_name,
    order: q.display_order
  }));
}

/**
 * Check that a submission answers every template question exactly once.
 * Returns { answers } with the cleaned entries, or { error }.
 */
function matchAnswers(questionById, submitted) {
  const seen = new Set();
  const answers = [];
  for (const { questionId, score } of submitted) {
    if (!questionById.has(questionId)) {
      return { error: "An answer refers to an unknown question." };
    }
    if (seen.has(questionId)) {
      return { error: "A question was answered more than once." };
    }
    seen.add(questionId);
    answers.push({ questionId, score });
  }
  if (answers.length !== questionById.size) {
    return { error: "Every question must be answered." };
  }
  return { answers };
}

function isFlagged(questionById, answers, durationSeconds) {
  return checkResponseQuality({
    durationSeconds,
    answers: answers.map((a) => {
      const q = questionById.get(a.questionId);
      return {
        questionId: a.questionId,
        axisId: q.axis_id,
        rawScore: a.score,
        isReverseScored: Boolean(q.is_reverse_scored)
      };
    })
  }).flagged;
}

function createResponseRoutes({ conn }) {
  const router = express.Router();

  router.get("/:code", (req, res) => {
    const found = resolveInvite(conn, req.params.code);
    if (!found) return res.status(404).json({ error: "Survey not found." });
    const { invite, survey } = found;
    const team = teamOf(conn, survey);
    if (invite.used) return res.status(200).json({ open: false, used: true, team });
    if (survey.status !== "open") return res.status(200).json({ open: false, team });
    res.status(200).json({
      open: true,
      team,
      scale: { min: SCALE_MIN, max: SCALE_MAX },
      questions: publicQuestions(conn, survey.template_id)
    });
  });

  // validate() has already checked the outer shape (answers array of
  // {questionId, score in range}, optional durationSeconds); this checks the
  // answers against the template and spends the invite.
  router.post("/:code", validate(respondSchema), (req, res) => {
    const found = resolveInvite(conn, req.params.code);
    if (!found) return res.status(404).json({ error: "Survey not found." });
    const { invite, survey } = found;
    if (survey.status !== "open") return res.status(409).json({ error: CLOSED_ERROR });

    const questions = db.getQuestionsForTemplate(conn, survey.template_id);
    const questionById = new Map(questions.map((q) => [q.id, q]));
    const matched = matchAnswers(questionById, req.body.answers);
    if (matched.error) return res.status(400).json({ error: matched.error });

    const durationSeconds = req.body.durationSeconds ?? null;
    const outcome = invites.submitWithInvite(conn, invite.id, {
      surveyId: survey.id,
      durationSeconds,
      flaggedQuality: isFlagged(questionById, matched.answers, durationSeconds),
      answers: matched.answers
    });
    if (outcome === "used") return res.status(409).json({ error: USED_ERROR });
    // The respondent is never told their response was flagged.
    res.status(201).json({ ok: true });
  });

  return router;
}

module.exports = { createResponseRoutes };
