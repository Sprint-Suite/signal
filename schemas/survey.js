"use strict";

// schemas/survey.js — admin API bodies for team and survey creation.
//
// POST /api/teams   { name }
// POST /api/surveys { teamId?, templateId?, parentSurveyId? }
//
// Survey creation has complex cross-field DB logic (parentSurveyId inherits
// team+template from parent; company-scoping checks) that zod cannot express.
// We validate basic shape/types here; the route handler keeps its own bespoke
// DB-checking error bodies (existing tests assert status codes, not bodies).
const { z } = require("zod");

const trim = (v) => (typeof v === "string" ? v.trim() : v);

// POST /api/teams
const teamSchema = z.object({
  name: z.preprocess(trim, z.string().min(1))
});

// POST /api/surveys — all three fields are optional at the schema level;
// the route handler enforces the cross-field rules with bespoke DB checks.
const surveySchema = z.object({
  teamId: z
    .preprocess(
      (v) => (v == null || v === "" ? null : String(v)),
      z.string().min(1).nullable()
    )
    .optional()
    .default(null),
  templateId: z
    .preprocess(
      (v) => (v == null || v === "" ? null : String(v)),
      z.string().min(1).nullable()
    )
    .optional()
    .default(null),
  parentSurveyId: z
    .preprocess(
      (v) => (v == null || v === "" ? null : String(v)),
      z.string().min(1).nullable()
    )
    .optional()
    .default(null)
});

module.exports = { teamSchema, surveySchema };
