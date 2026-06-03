// tests/theme-contrast.test.js
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { contrastRatio, meetsAA } = require("../lib/contrast");

/** Instrument palette pairs Signal relies on. Hexes are the sRGB equivalents of
 *  the oklch tokens in instrument-core.css (computed via the standard oklch →
 *  oklab → LMS' → LMS → linear sRGB → gamma pipeline, not guessed). */
const INS = {
  bone:      "#F1F3F5",  // --bone      oklch(0.964 0.004 240)
  panel:     "#FDFEFF",  // --panel     oklch(0.996 0.002 240)
  ink:       "#1A1F24",  // --ink       oklch(0.235 0.013 250)
  soft:      "#52575D",  // --soft      oklch(0.455 0.012 250)
  faint:     "#7C8186",  // --faint     oklch(0.6   0.01  250)
  green:     "#266248",  // --green     oklch(0.45  0.077 162)
  greenwash: "#DDF5E9",  // --greenwash oklch(0.95  0.03  165)
  amberdark: "#934F00",  // warn text   oklch(0.5   0.12   60)
  amberwash: "#FFEBCA",  // --amberwash oklch(0.95  0.05   78)
  white:     "#FFFFFF"
};

const BODY_PAIRS = [
  ["ink",   "bone"],
  ["ink",   "panel"],
  ["soft",  "panel"],
  ["soft",  "bone"],
  ["green", "greenwash"],
  ["amberdark", "amberwash"]
];

for (const [fg, bg] of BODY_PAIRS) {
  test(`instrument contrast: ${fg} on ${bg} meets AA body text`, () => {
    const ratio = contrastRatio(INS[fg], INS[bg]);
    assert.ok(meetsAA(INS[fg], INS[bg]),
      `${fg} (${INS[fg]}) on ${bg} (${INS[bg]}) = ${ratio.toFixed(2)}:1, need 4.5:1`);
  });
}

test("instrument contrast: white on green meets AA large/bold text", () => {
  const ratio = contrastRatio(INS.white, INS.green);
  assert.ok(meetsAA(INS.white, INS.green, { largeText: true }),
    `white on green = ${ratio.toFixed(2)}:1, need 3:1 large`);
});
