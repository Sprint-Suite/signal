"use strict";

/**
 * lib/insights.js — the insights engine.
 *
 * Rules-based for v1. Reads three signals per axis (score, trend vs baseline,
 * spread) and classifies each into one of four scenarios, then selects a
 * curated tip. Exposed via a single `getInsights()` seam so a future AI
 * enricher can swap in without touching callers.
 *
 * Scenarios (spec section 10.1):
 *  - lowFlat    low score, little/no improvement -> stuck, needs intervention.
 *  - lowRising  low but improving -> encourage, name what worked.
 *  - highSlip   was high, has dipped -> early warning.
 *  - divided    wide spread regardless of score -> the disagreement is the signal.
 *  - healthy    no concern; produces no tip and no focus-area entry.
 */

// --- Classification thresholds (tune with real data) -----------------------
const LOW_SCORE_MAX = 3.0; // mean at or below this is "low"
const HIGH_SCORE_MIN = 3.5; // baseline at or above this counts as "was high"
const IMPROVEMENT_DELTA = 0.3; // rise vs baseline that counts as "improving"
const SLIP_DELTA = -0.3; // dip vs baseline that counts as "slipped"

// Psychological Safety is primary: low safety corrupts honesty everywhere,
// including this survey, so it is boosted in the focus-area ranking.
const PRIMARY_AXIS = "Psychological Safety";

// Higher weight = more attention needed. Drives focus-area ranking.
const SCENARIO_WEIGHT = {
  lowFlat: 100,
  divided: 80,
  highSlip: 60,
  lowRising: 40,
  healthy: 0
};

const PRIMARY_AXIS_BOOST = 50;
const MAX_FOCUS_AREAS = 3;

const GUIDANCE_NOTE =
  "These tips are guidance, not prescriptions. They are a starting point for a " +
  "team conversation, not a verdict.";

const round1 = (n) => Math.round(n * 10) / 10;

// --- Curated tip library (spec section 10.3) -------------------------------
// Keyed by axis name, then scenario. Each tip is short, anchored to a source,
// and ends with a concrete next move.
const TIP_LIBRARY = {
  Delivery: {
    lowFlat:
      "Delivery is your weakest area and hasn't shifted. The usual culprits are large batches, manual release steps, and cross-team dependencies. Pick the single biggest blocker to shipping and run a focused session on it. (DORA)",
    lowRising:
      "Delivery is still low but moving the right way. Name what changed in the next retro so the team keeps doing it. (DORA)",
    highSlip:
      "Delivery was strong and has dipped. Catch it early: check whether work-in-progress has crept up or a new dependency appeared. (DORA)",
    divided:
      "The team disagrees about delivery. Roles near release often feel the friction more. Ask the team where shipping actually slows down. (DORA)"
  },
  Quality: {
    lowFlat:
      'Quality concerns are persistent, usually a weak definition of done or pressure to cut corners. Tighten what "done" means and protect time for it. (DORA)',
    lowRising:
      "Quality is recovering. Reinforce the practices behind it (review, testing, done criteria) before it stalls. (DORA)",
    highSlip:
      "Quality has slipped from a good level. Look for recent shortcuts taken under deadline pressure. (DORA)",
    divided:
      "Views on quality are split. Part of the team may be absorbing rework the rest don't see. Surface where defects originate. (DORA)"
  },
  "Team Health": {
    lowFlat:
      "Team health is low and unchanged, a sign of sustained strain. Look at workload, interruptions, and skills gaps. Address the biggest drain first. (Spotify)",
    lowRising:
      "Getting better. Acknowledge it openly, recognition compounds. Keep protecting whatever reduced the strain. (Spotify)",
    highSlip:
      "A healthy team is dipping. Check for a recent change: new members, a tough delivery, rising interruptions. (Spotify)",
    divided:
      "Some feel good, some don't, which can mean uneven workload. A one-on-one check-in often reveals more than a group setting. (Spotify)"
  },
  "Psychological Safety": {
    lowFlat:
      "Prioritise this regardless of other scores, low safety suppresses honesty everywhere, including this survey. Focus on how mistakes and dissent are handled; leaders responding well to bad news is the strongest lever. (Edmondson)",
    lowRising:
      "Safety is rising, which lifts everything else. Keep responding to mistakes with curiosity rather than blame. (Edmondson)",
    highSlip:
      "Safety has dipped from a good level. A single bad reaction to a mistake can do this. Reflect on recent moments where someone took a risk. (Edmondson)",
    divided:
      "Safety is felt unevenly. Some voices may feel heard while others don't. Notice who speaks in meetings and who doesn't. (Edmondson)"
  },
  "Learning & Improvement": {
    lowFlat:
      "The team keeps hitting the same problems, usually because retro actions don't get done. Commit to fewer actions and actually finish them. (Spotify)",
    lowRising:
      "Improvement is taking hold. Make the wins visible so the team sees retros lead to real change. (Spotify)",
    highSlip:
      "Learning has slowed, often because delivery pressure crowded out improvement time. Protect a small, regular slot. (Spotify)",
    divided:
      "The team disagrees on whether things improve. Some may not see retro actions follow through. Make completed actions visible. (Spotify)"
  },
  "Value & Purpose": {
    lowFlat:
      "The team is unsure its work matters. Reconnect work to customer/business value and tighten the feedback loop on what you ship. (Spotify)",
    lowRising:
      "Sense of purpose is growing. Keep sharing outcomes, not just outputs. (Spotify)",
    highSlip:
      'Clarity of purpose has dipped, often a goal shifted without being clearly re-communicated. Restate the "why". (Spotify)',
    divided:
      "The team is split on whether work matters. Some may have line of sight to the goal while others don't. Make the shared objective explicit. (Spotify)"
  }
};

/**
 * Look up a curated tip. Returns null for the "healthy" scenario or an
 * unknown axis (e.g. a future template) — callers should tolerate null.
 */
function selectTip(axisKey, scenario) {
  const axisTips = TIP_LIBRARY[axisKey];
  if (!axisTips) return null;
  return axisTips[scenario] || null;
}

/**
 * Classify one axis into a scenario from its three signals.
 * `divided` takes precedence: when the team disagrees, that is the story
 * regardless of the average.
 */
function classifyAxis(axis) {
  const hasBaseline =
    axis.baselineMean !== null && axis.baselineMean !== undefined;
  const delta = hasBaseline ? axis.mean - axis.baselineMean : 0;

  if (axis.divided) return "divided";

  if (axis.mean <= LOW_SCORE_MAX) {
    if (hasBaseline && delta >= IMPROVEMENT_DELTA) return "lowRising";
    return "lowFlat";
  }

  if (
    hasBaseline &&
    axis.baselineMean >= HIGH_SCORE_MIN &&
    delta <= SLIP_DELTA
  ) {
    return "highSlip";
  }

  return "healthy";
}

/** Attention score for ranking focus areas — higher means more urgent. */
function priorityFor(axis, scenario) {
  let priority = SCENARIO_WEIGHT[scenario] || 0;
  // A lower score within the same scenario is more urgent.
  priority += (5 - axis.mean) * 5;
  // Psychological Safety is primary whenever it shows any concern.
  if (axis.name === PRIMARY_AXIS && scenario !== "healthy") {
    priority += PRIMARY_AXIS_BOOST;
  }
  return round1(priority);
}

/**
 * The v1 rules engine — and the single seam a v2 AI enricher swaps into.
 *
 * @param {Array<{axisId, name, mean, spread, divided, baselineMean?}>} scoredAxes
 *        One entry per axis. `baselineMean` is omitted/null for a baseline run.
 * @returns {{axes: Array, focusAreas: Array, guidanceNote: string}}
 *          `axes` carries every axis with its scenario and tip; `focusAreas`
 *          is the prioritised top-N (concerns only), ranked by where attention
 *          helps most — NOT simply the lowest scores.
 */
function getInsights(scoredAxes) {
  const axes = (scoredAxes || []).map((axis) => {
    const hasBaseline =
      axis.baselineMean !== null && axis.baselineMean !== undefined;
    const scenario = classifyAxis(axis);
    return {
      axisId: axis.axisId,
      name: axis.name,
      mean: axis.mean,
      baselineMean: hasBaseline ? axis.baselineMean : null,
      delta: hasBaseline ? round1(axis.mean - axis.baselineMean) : null,
      spread: axis.spread,
      divided: Boolean(axis.divided),
      scenario,
      tip: selectTip(axis.name, scenario),
      priority: priorityFor(axis, scenario)
    };
  });

  const focusAreas = axes
    .filter((a) => a.scenario !== "healthy")
    .sort((a, b) => b.priority - a.priority || a.mean - b.mean)
    .slice(0, MAX_FOCUS_AREAS);

  return { axes, focusAreas, guidanceNote: GUIDANCE_NOTE };
}

module.exports = {
  LOW_SCORE_MAX,
  HIGH_SCORE_MIN,
  IMPROVEMENT_DELTA,
  SLIP_DELTA,
  PRIMARY_AXIS,
  SCENARIO_WEIGHT,
  MAX_FOCUS_AREAS,
  GUIDANCE_NOTE,
  TIP_LIBRARY,
  selectTip,
  classifyAxis,
  getInsights
};
