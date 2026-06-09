"use strict";

// schemas/respond.js — anonymous survey-submit body (the primary un-authed surface).
// POST /api/respond/:code  { answers: [{questionId, score},...], durationSeconds?: number }
const { z } = require("zod");
const { SCALE_MIN, SCALE_MAX } = require("../lib/scoring");

// A single answer: questionId must be a non-empty string; score must coerce to
// an integer within the survey scale. Unknown keys are stripped by default.
const answerSchema = z.object({
  questionId: z.string().min(1),
  score: z.preprocess(
    (v) => (v == null ? v : Number(v)),
    z
      .number()
      .int()
      .min(SCALE_MIN, { message: `Score must be at least ${SCALE_MIN}` })
      .max(SCALE_MAX, { message: `Score must be at most ${SCALE_MAX}` })
  )
});

// The full submission body.
// answers must be a non-empty array; durationSeconds is optional, coerced to a
// finite non-negative number (null when absent or invalid — quality check only).
const respondSchema = z.object({
  answers: z.array(answerSchema).min(1),
  durationSeconds: z
    .preprocess(
      (v) => {
        if (v == null) return null;
        const n = Number(v);
        return Number.isFinite(n) && n >= 0 ? n : null;
      },
      z.number().finite().nonnegative().nullable()
    )
    .optional()
    .default(null)
});

module.exports = { respondSchema, answerSchema };
