"use strict";

/**
 * lib/scoring.js — the scoring engine.
 *
 * Pure, deterministic functions: the same input always yields the same output.
 * Data flow: normalise -> group by axis -> average -> measure spread.
 *
 * Critical rules (spec section 6):
 *  - Raw scores (1..5) are stored verbatim. Inversion happens ONLY here,
 *    at read time, exactly once. Double-inversion is the classic bug.
 *  - `isReverseScored` is driven from the database, never a hardcoded list.
 */

const SCALE_MIN = 1;
const SCALE_MAX = 5;

// Std-dev cut-off (on the 1..5 scale) above which an axis is "divided".
// A starting value — calibrate once real data exists.
const DIVIDED_THRESHOLD = 1.2;

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * Normalise a raw score so higher always means healthier.
 * Reverse-scored items flip: 1<->5, 2<->4, 3 stays.
 */
function normaliseScore(rawScore, isReverseScored) {
  if (!isReverseScored) return rawScore;
  return SCALE_MIN + SCALE_MAX - rawScore; // 6 - rawScore on a 1..5 scale
}

/**
 * Group normalised answers by axis and average each.
 * @param {Array<{axisId: string, rawScore: number, isReverseScored: boolean}>} answers
 * @returns {Map<string, {mean: number, count: number, values: number[]}>}
 */
function scoreByAxis(answers) {
  const byAxis = new Map();
  for (const a of answers) {
    const value = normaliseScore(a.rawScore, a.isReverseScored);
    if (!byAxis.has(a.axisId)) byAxis.set(a.axisId, []);
    byAxis.get(a.axisId).push(value);
  }
  const result = new Map();
  for (const [axisId, values] of byAxis) {
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    result.set(axisId, { mean: round1(mean), count: values.length, values });
  }
  return result;
}

/** Population standard deviation of a set of values (drives the divided flag). */
function axisSpread(values) {
  const n = values.length;
  if (n === 0) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  return round1(Math.sqrt(variance));
}

/** True when an axis's spread reaches the "divided" threshold. */
function isDivided(values) {
  return axisSpread(values) >= DIVIDED_THRESHOLD;
}

/**
 * Public entry point. Score one survey run.
 *
 * @param {Array<{axisId, rawScore, isReverseScored}>} answers
 *        Every answer across every respondent and question (pooled per axis).
 * @param {Map<string, {name: string}>} axisMeta — axis id -> metadata
 * @returns {Array<{axisId, name, mean, count, spread, divided}>}
 *
 * Baseline vs follow-up: call scoreSurvey twice (once per run) and pair the
 * results by axisId. No special comparison logic is needed.
 */
function scoreSurvey(answers, axisMeta) {
  const scored = scoreByAxis(answers);
  return [...scored.entries()].map(([axisId, data]) => {
    const meta = axisMeta && axisMeta.get ? axisMeta.get(axisId) : null;
    return {
      axisId,
      name: meta ? meta.name : axisId,
      mean: data.mean, // radar radius, 1..5
      count: data.count,
      spread: axisSpread(data.values),
      divided: isDivided(data.values)
    };
  });
}

module.exports = {
  SCALE_MIN,
  SCALE_MAX,
  DIVIDED_THRESHOLD,
  round1,
  normaliseScore,
  scoreByAxis,
  axisSpread,
  isDivided,
  scoreSurvey
};
