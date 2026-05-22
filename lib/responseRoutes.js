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
  router.post("/:code", (req, res) => {
    const survey = db.getSurveyByAccessCode(conn, req.params.code);
    if (!survey) {
      return res.status(404).json({ error: "Survey not found." });
    }
    if (survey.status !== "open") {
      return res
        .status(409)
        .json({ error: "This survey is closed and no longer accepting responses." });
    }

    const submitted = Array.isArray(req.body?.answers)
      ? req.body.answers
      : null;
    if (!submitted) {
      return res.status(400).json({ error: "Answers are required." });
    }

    // The submission must answer every template question exactly once.
    const questions = db.getQuestionsForTemplate(conn, survey.template_id);
    const questionById = new Map(questions.map((q) => [q.id, q]));
    const seen = new Set();
    const cleaned = [];

    for (const answer of submitted) {
      const questionId = answer && answer.questionId;
      const score = Number(answer && answer.score);
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
      if (
        !Number.isInteger(score) ||
        score < SCALE_MIN ||
        score > SCALE_MAX
      ) {
        return res.status(400).json({
          error: `Each answer must be a whole number from ${SCALE_MIN} to ${SCALE_MAX}.`
        });
      }
      seen.add(questionId);
      cleaned.push({ questionId, score });
    }

    if (cleaned.length !== questions.length) {
      return res
        .status(400)
        .json({ error: "Every question must be answered." });
    }

    // Quality checks run invisibly on submit.
    const durationRaw = Number(req.body?.durationSeconds);
    const durationSeconds = Number.isFinite(durationRaw) && durationRaw >= 0
      ? durationRaw
      : null;
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
