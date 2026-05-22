"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normaliseScore,
  scoreByAxis,
  axisSpread,
  isDivided,
  scoreSurvey,
  DIVIDED_THRESHOLD
} = require("../lib/scoring");

test("reverse item inverts correctly: 5->1, 1->5, 3->3", () => {
  assert.equal(normaliseScore(5, true), 1);
  assert.equal(normaliseScore(1, true), 5);
  assert.equal(normaliseScore(3, true), 3);
  assert.equal(normaliseScore(2, true), 4);
  assert.equal(normaliseScore(4, true), 2);
});

test("normal item is not inverted", () => {
  for (const raw of [1, 2, 3, 4, 5]) {
    assert.equal(normaliseScore(raw, false), raw);
  }
});

test("a divided axis (wide spread) trips the flag", () => {
  // Extremes on a 1..5 scale: spread well above the threshold.
  const wide = [1, 1, 1, 5, 5, 5];
  assert.ok(axisSpread(wide) >= DIVIDED_THRESHOLD);
  assert.equal(isDivided(wide), true);
});

test("a tight axis does not trip the divided flag", () => {
  const tight = [4, 4, 4, 4, 3, 4];
  assert.ok(axisSpread(tight) < DIVIDED_THRESHOLD);
  assert.equal(isDivided(tight), false);
});

test("an all-neutral axis averages to exactly 3.0", () => {
  const answers = [
    { axisId: "ax", rawScore: 3, isReverseScored: false },
    { axisId: "ax", rawScore: 3, isReverseScored: false },
    // a reverse item answered neutral still normalises to 3
    { axisId: "ax", rawScore: 3, isReverseScored: true },
    { axisId: "ax", rawScore: 3, isReverseScored: true }
  ];
  const scored = scoreByAxis(answers);
  assert.equal(scored.get("ax").mean, 3.0);
  assert.equal(axisSpread(scored.get("ax").values), 0);
});

test("no double-inversion: scoring the same data twice is identical", () => {
  const answers = [
    { axisId: "a", rawScore: 4, isReverseScored: false },
    { axisId: "a", rawScore: 2, isReverseScored: true },
    { axisId: "b", rawScore: 5, isReverseScored: false },
    { axisId: "b", rawScore: 1, isReverseScored: true }
  ];
  const axisMeta = new Map([
    ["a", { name: "Axis A" }],
    ["b", { name: "Axis B" }]
  ]);
  const first = scoreSurvey(answers, axisMeta);
  const second = scoreSurvey(answers, axisMeta);
  assert.deepEqual(first, second);
});

test("scoreSurvey pools all answers per axis and labels them", () => {
  // Axis "delivery": one reverse item (raw 1 -> normalises to 5).
  const answers = [
    { axisId: "delivery", rawScore: 4, isReverseScored: false },
    { axisId: "delivery", rawScore: 4, isReverseScored: false },
    { axisId: "delivery", rawScore: 1, isReverseScored: true } // -> 5
  ];
  const axisMeta = new Map([["delivery", { name: "Delivery" }]]);
  const result = scoreSurvey(answers, axisMeta);
  assert.equal(result.length, 1);
  const delivery = result[0];
  assert.equal(delivery.name, "Delivery");
  assert.equal(delivery.count, 3);
  assert.equal(delivery.mean, round1((4 + 4 + 5) / 3));
});

test("reverse-scored answers are inverted before averaging", () => {
  // All answers are raw 5. The reverse item should drag the mean DOWN.
  const answers = [
    { axisId: "a", rawScore: 5, isReverseScored: false }, // -> 5
    { axisId: "a", rawScore: 5, isReverseScored: false }, // -> 5
    { axisId: "a", rawScore: 5, isReverseScored: true } // -> 1
  ];
  const scored = scoreByAxis(answers);
  assert.equal(scored.get("a").mean, round1((5 + 5 + 1) / 3));
});

function round1(n) {
  return Math.round(n * 10) / 10;
}
