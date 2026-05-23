"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { contrastRatio, meetsAA } = require("../lib/contrast");

test("contrast: pure black on pure white is 21:1", () => {
  assert.equal(contrastRatio("#000000", "#FFFFFF").toFixed(2), "21.00");
});

test("contrast: identical colours are 1:1", () => {
  assert.equal(contrastRatio("#777777", "#777777"), 1);
});

test("meetsAA: WCAG AA body text requires 4.5:1", () => {
  assert.equal(meetsAA("#2A1F12", "#FDF4E3"), true);   // signal-ish pair
  assert.equal(meetsAA("#999999", "#FFFFFF"), false);  // too light
});
