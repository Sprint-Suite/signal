"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  selectTip,
  classifyAxis,
  getInsights,
  TIP_LIBRARY,
  MAX_FOCUS_AREAS
} = require("../lib/insights");

test("selectTip returns the curated tip for an axis + scenario", () => {
  assert.equal(
    selectTip("Delivery", "lowFlat"),
    TIP_LIBRARY.Delivery.lowFlat
  );
  assert.ok(selectTip("Psychological Safety", "divided").length > 0);
});

test("selectTip returns null for healthy or unknown axes", () => {
  assert.equal(selectTip("Delivery", "healthy"), null);
  assert.equal(selectTip("No Such Axis", "lowFlat"), null);
});

test("a low score with no baseline classifies as lowFlat", () => {
  assert.equal(
    classifyAxis({ name: "Delivery", mean: 2.4, divided: false }),
    "lowFlat"
  );
});

test("a low score that has improved classifies as lowRising", () => {
  assert.equal(
    classifyAxis({
      name: "Delivery",
      mean: 2.8,
      baselineMean: 2.2,
      divided: false
    }),
    "lowRising"
  );
});

test("a high baseline that has dipped classifies as highSlip", () => {
  assert.equal(
    classifyAxis({
      name: "Quality",
      mean: 3.7,
      baselineMean: 4.4,
      divided: false
    }),
    "highSlip"
  );
});

test("divided takes precedence over score and trend", () => {
  // Decent score, improving — but the team is divided.
  assert.equal(
    classifyAxis({
      name: "Team Health",
      mean: 4.0,
      baselineMean: 3.5,
      divided: true
    }),
    "divided"
  );
});

test("a healthy axis produces no scenario tip and no focus entry", () => {
  const { axes, focusAreas } = getInsights([
    { axisId: "a", name: "Delivery", mean: 4.5, spread: 0.4, divided: false }
  ]);
  assert.equal(axes[0].scenario, "healthy");
  assert.equal(axes[0].tip, null);
  assert.equal(focusAreas.length, 0);
});

test("focus areas are ranked by attention need, capped at the max", () => {
  const scored = [
    { axisId: "d", name: "Delivery", mean: 2.2, spread: 0.5, divided: false },
    { axisId: "q", name: "Quality", mean: 4.6, spread: 0.3, divided: false },
    { axisId: "t", name: "Team Health", mean: 3.9, spread: 1.4, divided: true },
    {
      axisId: "l",
      name: "Learning & Improvement",
      mean: 2.9,
      baselineMean: 2.4,
      spread: 0.6,
      divided: false
    },
    { axisId: "v", name: "Value & Purpose", mean: 4.8, spread: 0.2, divided: false }
  ];
  const { focusAreas } = getInsights(scored);
  assert.equal(focusAreas.length, MAX_FOCUS_AREAS);
  // Delivery (lowFlat, score 2.2) is the most urgent.
  assert.equal(focusAreas[0].name, "Delivery");
  // The two healthy axes are excluded.
  const names = focusAreas.map((a) => a.name);
  assert.equal(names.includes("Quality"), false);
  assert.equal(names.includes("Value & Purpose"), false);
});

test("a decent-scoring divided axis can outrank a healthy higher one", () => {
  const { focusAreas } = getInsights([
    { axisId: "t", name: "Team Health", mean: 3.8, spread: 1.5, divided: true },
    { axisId: "q", name: "Quality", mean: 4.7, spread: 0.3, divided: false }
  ]);
  assert.equal(focusAreas.length, 1);
  assert.equal(focusAreas[0].name, "Team Health");
});

test("Psychological Safety is prioritised regardless of other (lower) scores", () => {
  // Both axes are stuck (lowFlat). Delivery scores far lower, so on score
  // alone it would lead — but a Psych Safety concern is primary and should
  // still rank first.
  const { focusAreas } = getInsights([
    {
      axisId: "p",
      name: "Psychological Safety",
      mean: 3.0,
      spread: 0.5,
      divided: false
    },
    { axisId: "d", name: "Delivery", mean: 1.5, spread: 0.5, divided: false }
  ]);
  assert.equal(focusAreas[0].name, "Psychological Safety");
});

test("getInsights reports delta vs baseline and carries the guidance note", () => {
  const { axes, guidanceNote } = getInsights([
    {
      axisId: "d",
      name: "Delivery",
      mean: 3.6,
      baselineMean: 3.0,
      spread: 0.5,
      divided: false
    }
  ]);
  assert.equal(axes[0].delta, 0.6);
  assert.ok(guidanceNote.includes("guidance, not prescriptions"));
});
