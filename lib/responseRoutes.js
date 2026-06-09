"use strict";

/**
 * lib/responseRoutes.js — the public, anonymous respondent flow.
 *
 * Mounted at /api. No authentication and no identity: a respondent reaches a
 * survey only via its access code. Nothing here writes or reads anything that
 * could tie a response back to a person.
 *
 * Mounted at /api/respond:
 *   GET  /api/respond/:code   the survey's questions, if it is open
 *   POST /api/respond/:code   submit a complete set of answers
 */

const express = require("express");
const db = require("./db");
const { checkResponseQuality } = require("./quality");
const { SCALE_MIN, SCALE_MAX } = require("./scoring");
const { validate } = require("./validate");
const { respondSchema } = require("../schemas/respond");

function createResponseRoutes({ conn }) {
  const router = express.Router();

  // --- Fetch the survey to answer -----------------------------------------
  router.get("/:code", (req, res) => {
    const survey = db.getSurveyByAccessCode(conn, req.params.code);
    if (!survey) {
      return res.status(404).json({ error: "Survey not found." });
    }
    const team = db.getTeamById(conn, survey.team_id);

    if (survey.status !== "open") {
      return res.status(200).json({
        open: false,
        team: team ? { name: team.name } : null
      });
    }

    const questions = db
      .getQuestionsForTemplate(conn, survey.template_id)
      .map((q) => ({
        id: q.id,
        text: q.text,
        axisId: q.axis_id,
        axisName: q.axis_name,
        order: q.display_order
        // is_reverse_scored is deliberately NOT exposed — the client only
        // renders the question; reverse handling is server-side.
      }));

    res.status(200).json({
      open: true,
      team: team ? { name: team.name } : null,
      scale: { min: SCALE_MIN, max: SCALE_MAX },
      questions
    });
  });

  // --- Submit a response ---------------------------------------------------
  // validate() coerces and strips the outer shape: answers array (each entry
  // must have a non-empty questionId string and an integer score in [1,5]) and
  // an optional durationSeconds (finite non-negative number or null). Unknown
  // keys are stripped. Shape failures → 400 via the central error handler.
  router.post("/:code", validate(respondSchema), (req, res) => {
    const survey = db.getSurveyByAccessCode(conn, req.params.code);
    if (!survey) {
      return res.status(404).json({ error: "Survey not found." });
    }
    if (survey.status !== "open") {
      return res
        .status(409)
        .json({ error: "This survey is closed and no longer accepting responses." });
    }

    // req.body is now the zod-parsed body: answers is a non-empty array with
    // validated {questionId, score} entries; durationSeconds is a number or null.
    const submitted = req.body.answers;
    const durationSeconds = req.body.durationSeconds ?? null;

    // The submission must answer every template question exactly once.
    const questions = db.getQuestionsForTemplate(conn, survey.template_id);
    const questionById = new Map(questions.map((q) => [q.id, q]));
    const seen = new Set();
    const cleaned = [];

    for (const answer of submitted) {
      const { questionId, score } = answer;
      if (!questionById.has(questionId)) {
        return res
          .status(400)
          .json({ error: "An answer refers to an unknown question." });
      }
      if (seen.has(questionId)) {
        return res
          .status(400)
          .json({ error: "A question was answered more than once." });
      }
      seen.add(questionId);
      cleaned.push({ questionId, score });
    }

    if (cleaned.length !== questions.length) {
      return res
        .status(400)
        .json({ error: "Every question must be answered." });
    }
    const quality = checkResponseQuality({
      durationSeconds,
      answers: cleaned.map((a) => {
        const q = questionById.get(a.questionId);
        return {
          questionId: a.questionId,
          axisId: q.axis_id,
          rawScore: a.score,
          isReverseScored: Boolean(q.is_reverse_scored)
        };
      })
    });

    db.submitResponse(conn, {
      surveyId: survey.id,
      durationSeconds,
      flaggedQuality: quality.flagged,
      answers: cleaned
    });

    // The respondent is never told their response was flagged.
    res.status(201).json({ ok: true });
  });

  return router;
}

module.exports = { createResponseRoutes };
