"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { checkResponseQuality } = require("../lib/quality");

// Build a realistic answer set: 3 axes, each with 3 normal + 1 reverse item.
// `pattern` maps an axis index to { normal: rawScore, reverse: rawScore }.
function buildAnswers(pattern) {
  const answers = [];
  pattern.forEach((axis, axisIndex) => {
    const axisId = `axis-${axisIndex}`;
    for (let i = 0; i < 3; i += 1) {
      answers.push({
        questionId: `q-${axisIndex}-${i}`,
        axisId,
        rawScore: axis.normal,
        isReverseScored: false
      });
    }
    answers.push({
      questionId: `q-${axisIndex}-rev`,
      axisId,
      rawScore: axis.reverse,
      isReverseScored: true
    });
  });
  return answers;
}

test("a thoughtful, consistent response is not flagged", () => {
  // Healthy team: agrees with normal items (raw 5), disagrees with the
  // reverse item (raw 1). Took a sensible amount of time.
  const answers = buildAnswers([
    { normal: 5, reverse: 1 },
    { normal: 4, reverse: 2 },
    { normal: 5, reverse: 1 }
  ]);
  const result = checkResponseQuality({ durationSeconds: 240, answers });
  assert.equal(result.flagged, false);
  assert.deepEqual(result.reasons, []);
});

test("an implausibly fast response flags speed", () => {
  const answers = buildAnswers([
    { normal: 5, reverse: 1 },
    { normal: 4, reverse: 2 },
    { normal: 5, reverse: 1 }
  ]);
  // 12 questions completed in 20s -> well under 2.5s/question.
  const result = checkResponseQuality({ durationSeconds: 20, answers });
  assert.equal(result.flagged, true);
  assert.ok(result.reasons.includes("speed"));
});

test("a straight-lined response (identical raw answers) flags straight-lining", () => {
  // Raw 5 to every question, including reverse items.
  const answers = buildAnswers([
    { normal: 5, reverse: 5 },
    { normal: 5, reverse: 5 },
    { normal: 5, reverse: 5 }
  ]);
  const result = checkResponseQuality({ durationSeconds: 240, answers });
  assert.equal(result.flagged, true);
  assert.ok(result.reasons.includes("straight-lining"));
});

test("answering everything neutral (all raw 3) flags straight-lining", () => {
  const answers = buildAnswers([
    { normal: 3, reverse: 3 },
    { normal: 3, reverse: 3 },
    { normal: 3, reverse: 3 }
  ]);
  const result = checkResponseQuality({ durationSeconds: 240, answers });
  assert.equal(result.flagged, true);
  assert.ok(result.reasons.includes("straight-lining"));
});

test("a single contradicting axis flags reverse-inconsistency, not straight-lining", () => {
  // Two axes consistent; one axis has a reverse item that contradicts.
  const answers = buildAnswers([
    { normal: 5, reverse: 1 }, // consistent
    { normal: 4, reverse: 2 }, // consistent
    { normal: 5, reverse: 5 } // reverse contradicts the normal items
  ]);
  const result = checkResponseQuality({ durationSeconds: 240, answers });
  assert.equal(result.flagged, true);
  assert.ok(result.reasons.includes("reverse-inconsistency"));
  assert.equal(result.reasons.includes("straight-lining"), false);
});

test("duration is not assessed when it is missing", () => {
  const answers = buildAnswers([
    { normal: 5, reverse: 1 },
    { normal: 4, reverse: 2 },
    { normal: 5, reverse: 1 }
  ]);
  const result = checkResponseQuality({ durationSeconds: null, answers });
  assert.equal(result.checks.speed, false);
  assert.equal(result.flagged, false);
});

test("a response can trip more than one check at once", () => {
  // Identical raw answers AND completed implausibly fast.
  const answers = buildAnswers([
    { normal: 5, reverse: 5 },
    { normal: 5, reverse: 5 },
    { normal: 5, reverse: 5 }
  ]);
  const result = checkResponseQuality({ durationSeconds: 5, answers });
  assert.equal(result.flagged, true);
  assert.ok(result.reasons.includes("speed"));
  assert.ok(result.reasons.includes("straight-lining"));
});
