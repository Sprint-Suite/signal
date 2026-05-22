"use strict";

/**
 * lib/quality.js — response quality checks.
 *
 * Runs once, on submit, for a single anonymous response. When a response
 * looks untrustworthy it sets `responses.flagged_quality`. These checks exist
 * because completion can be mandated but honesty cannot — they catch
 * straight-lining without ever naming an individual.
 *
 * The admin only ever sees an aggregate count ("1 response flagged"), never
 * which response or who.
 *
 * Three checks (spec section 8):
 *  - speed                — implausibly fast completion.
 *  - straight-lining      — the same answer regardless of question wording.
 *  - reverse-inconsistency — a reverse item contradicting its axis's normal items.
 */

const { normaliseScore } = require("./scoring");

// A 24-question survey under ~60s is implausible -> 2.5s per question.
const MIN_SECONDS_PER_QUESTION = 2.5;

// Gap (in normalised 1..5 points) between a reverse item and its axis's
// normal-item mean that counts as a genuine contradiction.
const CONTRADICTION_THRESHOLD = 2.5;

const mean = (xs) => xs.reduce((s, v) => s + v, 0) / xs.length;

/**
 * Assess one response.
 *
 * @param {object} response
 * @param {number|null} response.durationSeconds — time on the form, or null.
 * @param {Array<{questionId, axisId, rawScore, isReverseScored}>} response.answers
 * @returns {{flagged: boolean, reasons: string[],
 *            checks: {speed: boolean, straightLining: boolean,
 *                     reverseInconsistency: boolean}}}
 */
function checkResponseQuality(response) {
  const answers = Array.isArray(response && response.answers)
    ? response.answers
    : [];
  const durationSeconds =
    response && Number.isFinite(response.durationSeconds)
      ? response.durationSeconds
      : null;
  const questionCount = answers.length;

  // --- Speed -----------------------------------------------------------
  const speed =
    durationSeconds !== null &&
    questionCount > 0 &&
    durationSeconds < questionCount * MIN_SECONDS_PER_QUESTION;

  // --- Per-axis reverse-item analysis ---------------------------------
  // For each axis that mixes normal and reverse wording, a thoughtful
  // respondent's reverse answer should normalise close to the normal items.
  const byAxis = new Map();
  for (const a of answers) {
    if (!byAxis.has(a.axisId)) byAxis.set(a.axisId, []);
    byAxis.get(a.axisId).push(a);
  }

  let checkableAxes = 0;
  let inconsistentAxes = 0;
  for (const axisAnswers of byAxis.values()) {
    const normal = axisAnswers.filter((a) => !a.isReverseScored);
    const reverse = axisAnswers.filter((a) => a.isReverseScored);
    if (normal.length === 0 || reverse.length === 0) continue;
    checkableAxes += 1;

    const normalMean = mean(normal.map((a) => normaliseScore(a.rawScore, false)));
    const contradicts = reverse.some((a) => {
      const revNorm = normaliseScore(a.rawScore, true);
      return Math.abs(revNorm - normalMean) >= CONTRADICTION_THRESHOLD;
    });
    if (contradicts) inconsistentAxes += 1;
  }

  // --- Straight-lining -------------------------------------------------
  // Two signals: an identical raw answer to every question, or a reverse
  // item contradicting the axis on *every* checkable axis (wording ignored
  // systematically across the whole survey).
  const distinctRawValues = new Set(answers.map((a) => a.rawScore)).size;
  const identicalAnswers = questionCount >= 2 && distinctRawValues <= 1;
  const allAxesInconsistent =
    checkableAxes > 0 && inconsistentAxes === checkableAxes;
  const straightLining = identicalAnswers || allAxesInconsistent;

  // --- Reverse-item inconsistency -------------------------------------
  // A localised contradiction (some axes, not all) — distinct from the
  // systematic straight-lining pattern above.
  const reverseInconsistency = inconsistentAxes > 0 && !allAxesInconsistent;

  const reasons = [];
  if (speed) reasons.push("speed");
  if (straightLining) reasons.push("straight-lining");
  if (reverseInconsistency) reasons.push("reverse-inconsistency");

  return {
    flagged: reasons.length > 0,
    reasons,
    checks: { speed, straightLining, reverseInconsistency }
  };
}

module.exports = {
  MIN_SECONDS_PER_QUESTION,
  CONTRADICTION_THRESHOLD,
  checkResponseQuality
};
