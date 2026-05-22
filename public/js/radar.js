"use strict";

/* radar.js — hand-drawn SVG radar chart. Zero dependencies.
 *
 * Algorithm (spec section 11): place n axes evenly around a circle
 * (angle = -90 + i * 360/n), convert each 1-5 score to a radius
 * (R * score / MAX), and join the points into a polygon. Faint rings and
 * spokes are drawn first as guides. Two series overlay: baseline (grey) and
 * the current run (accent green). Outer edge = 5 (best), centre = needs work.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

const RADAR = {
  width: 600,
  height: 460,
  radius: 150,
  scaleMax: 5,
  accent: "#1D9E75",
  accentFill: "rgba(29,158,117,0.16)",
  baseline: "#888780",
  baselineFill: "rgba(136,135,128,0.12)",
  guide: "#E3E3DF",
  text: "#2A2A28",
  textMuted: "#6B6B66"
};

function svgEl(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    node.setAttribute(key, value);
  }
  return node;
}

/**
 * Render a radar chart into `container`.
 * @param {Element} container
 * @param {{axes: Array<{name, mean, baselineMean?}>}} data
 */
function drawRadar(container, data) {
  const axes = (data && data.axes) || [];
  const n = axes.length;
  const cx = RADAR.width / 2;
  const cy = RADAR.height / 2 - 12;
  const R = RADAR.radius;
  const MAX = RADAR.scaleMax;

  container.replaceChildren();
  if (n < 3) {
    container.append(document.createTextNode("Not enough axes to chart."));
    return;
  }

  const svg = svgEl("svg", {
    viewBox: `0 0 ${RADAR.width} ${RADAR.height}`,
    role: "img",
    "aria-label": "Agile health check radar chart"
  });

  // A point on axis i at a given 1-5 score.
  function point(i, score) {
    const angle = ((-90 + (i * 360) / n) * Math.PI) / 180;
    const radius = (R * score) / MAX;
    return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
  }

  // Faint rings (scores 1..5).
  for (let k = 1; k <= MAX; k += 1) {
    svg.append(
      svgEl("circle", {
        cx,
        cy,
        r: (R * k) / MAX,
        fill: "none",
        stroke: RADAR.guide,
        "stroke-width": 1
      })
    );
  }

  // Spokes and axis labels.
  axes.forEach((axis, i) => {
    const [ex, ey] = point(i, MAX);
    svg.append(
      svgEl("line", {
        x1: cx,
        y1: cy,
        x2: ex,
        y2: ey,
        stroke: RADAR.guide,
        "stroke-width": 1
      })
    );

    const [lx, ly] = point(i, MAX + 0.85);
    const anchor = lx < cx - 4 ? "end" : lx > cx + 4 ? "start" : "middle";

    const name = svgEl("text", {
      x: lx,
      y: ly,
      "text-anchor": anchor,
      "dominant-baseline": "middle",
      "font-family": "system-ui, sans-serif",
      "font-size": 13,
      "font-weight": 600,
      fill: RADAR.text
    });
    name.textContent = axis.name;
    svg.append(name);

    const valueText =
      axis.baselineMean === null || axis.baselineMean === undefined
        ? axis.mean.toFixed(1)
        : `${axis.mean.toFixed(1)}  (was ${axis.baselineMean.toFixed(1)})`;
    const value = svgEl("text", {
      x: lx,
      y: ly + 15,
      "text-anchor": anchor,
      "dominant-baseline": "middle",
      "font-family": "system-ui, sans-serif",
      "font-size": 11,
      fill: RADAR.textMuted
    });
    value.textContent = valueText;
    svg.append(value);
  });

  const hasBaseline = axes.some(
    (a) => a.baselineMean !== null && a.baselineMean !== undefined
  );

  // Baseline series first, so the current run draws on top.
  if (hasBaseline) {
    const pts = axes
      .map((a, i) =>
        point(i, a.baselineMean === null || a.baselineMean === undefined
          ? 0
          : a.baselineMean
        ).join(",")
      )
      .join(" ");
    svg.append(
      svgEl("polygon", {
        points: pts,
        fill: RADAR.baselineFill,
        stroke: RADAR.baseline,
        "stroke-width": 2
      })
    );
  }

  // Current run.
  const currentPts = axes.map((a, i) => point(i, a.mean).join(",")).join(" ");
  svg.append(
    svgEl("polygon", {
      points: currentPts,
      fill: RADAR.accentFill,
      stroke: RADAR.accent,
      "stroke-width": 2.5
    })
  );
  axes.forEach((a, i) => {
    const [x, y] = point(i, a.mean);
    svg.append(svgEl("circle", { cx: x, cy: y, r: 4, fill: RADAR.accent }));
  });

  container.append(svg);
}
