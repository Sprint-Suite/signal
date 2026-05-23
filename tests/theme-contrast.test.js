// tests/theme-contrast.test.js
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { contrastRatio, meetsAA } = require("../lib/contrast");

/**
 * Signal palette pairs that MUST meet WCAG AA (4.5:1 body text, 3:1 large
 * text). If a token gets recoloured later, this test catches regressions.
 */
const SIGNAL = {
  bg:        "#FDF8EB",
  "bg-sky":  "#BFD8EE",
  surface:   "#FDF8EB",
  ink:       "#1F2C4C",
  muted:     "#466091",
  accent:    "#1F2C4C",
  "accent-on": "#FFF8EE",
  "accent-2": "#E8A47D",
  "accent-3": "#DCE9DA",
  ok:   "#2A5A2A",
  err:  "#B4232A"
};

const BODY_PAIRS = [
  ["ink",   "bg"],
  ["ink",   "surface"],
  ["muted", "bg"],
  ["accent-on", "accent"],
  ["err",   "bg"],
  ["ok",    "bg"],
  ["ink",   "bg-sky"]
];

for (const [fg, bg] of BODY_PAIRS) {
  test(`signal contrast: ${fg} on ${bg} meets AA body text`, () => {
    const ratio = contrastRatio(SIGNAL[fg], SIGNAL[bg]);
    assert.ok(
      meetsAA(SIGNAL[fg], SIGNAL[bg]),
      `${fg} (${SIGNAL[fg]}) on ${bg} (${SIGNAL[bg]}) = ${ratio.toFixed(2)}:1, need 4.5:1`
    );
  });
}
