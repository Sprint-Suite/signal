"use strict";

/** Map an axis score (0–5) to a weather glyph id from theme-illos.svg. */
function weatherForScore(score) {
  if (!Number.isFinite(score)) return { glyph: "cloud", cls: "axis-glyph-cloud" };
  if (score >= 4)   return { glyph: "sun",   cls: "axis-glyph-sun" };
  if (score >= 3)   return { glyph: "cloud", cls: "axis-glyph-cloud" };
  if (score >= 2)   return { glyph: "wind",  cls: "axis-glyph-wind" };
  return                    { glyph: "rain",  cls: "axis-glyph-rain" };
}

(function () {
  const surveyId = qsParam("id");

  function fail(message) {
    hide(byId("loading"));
    notice(byId("page-error"), message, "error");
  }

  function formatDate(iso) {
    return iso ? new Date(iso).toLocaleDateString() : "";
  }

  // ----------------------------------------------------------------------
  // Builder
  // ----------------------------------------------------------------------
  async function builderMode() {
    if (!(await requireSession())) return;

    const [teamsRes, templatesRes, surveysRes] = await Promise.all([
      apiGet("/api/teams"),
      apiGet("/api/templates"),
      apiGet("/api/surveys")
    ]);
    if (teamsRes.status === 403) {
      window.location.href = "/dashboard";
      return;
    }

    hide(byId("loading"));
    show(byId("builder"));

    const teams = (teamsRes.data && teamsRes.data.teams) || [];
    const templates = (templatesRes.data && templatesRes.data.templates) || [];
    const surveys = (surveysRes.data && surveysRes.data.surveys) || [];

    if (teams.length === 0) {
      show(byId("builder-no-teams"));
      return;
    }
    show(byId("builder-form"));

    const teamSelect = byId("team-select");
    setChildren(
      teamSelect,
      teams.map((t) => el("option", { value: t.id, text: t.name }))
    );
    setChildren(
      byId("template-select"),
      templates.map((t) =>
        el("option", { value: t.id, text: `${t.name} (v${t.version})` })
      )
    );

    const baselineField = byId("baseline-field");
    const baselineSelect = byId("baseline-select");

    function refreshBaselines() {
      const forTeam = surveys.filter((s) => s.teamId === teamSelect.value);

      if (forTeam.length === 0) {
        setChildren(baselineSelect, [
          el("option", { value: "", text: "No earlier surveys for this team" })
        ]);
        return;
      }

      // Group by templateId. Map preserves insertion order; we sort by name
      // before rendering so the dropdown is alphabetical.
      const groups = new Map();
      for (const s of forTeam) {
        if (!groups.has(s.templateId)) {
          groups.set(s.templateId, {
            templateId: s.templateId,
            templateName: s.templateName,
            templateVersion: s.templateVersion,
            surveys: []
          });
        }
        groups.get(s.templateId).surveys.push(s);
      }

      const ordered = Array.from(groups.values()).sort((a, b) =>
        a.templateName.localeCompare(b.templateName)
      );

      const children = [];
      for (const group of ordered) {
        const sorted = group.surveys.slice().sort((a, b) =>
          String(b.openedAt).localeCompare(String(a.openedAt))
        );
        const options = sorted.map((s) =>
          el("option", {
            value: s.id,
            text: `opened ${formatDate(s.openedAt)} (${s.responseCount} responses)`
          })
        );
        children.push(
          el(
            "optgroup",
            { label: `${group.templateName} (v${group.templateVersion})` },
            options
          )
        );
      }
      setChildren(baselineSelect, children);
    }
    refreshBaselines();
    teamSelect.addEventListener("change", refreshBaselines);

    const isFollowUp = () => byId("run-followup").checked;
    function syncRunType() {
      if (isFollowUp()) show(baselineField);
      else hide(baselineField);
    }
    byId("run-baseline").addEventListener("change", syncRunType);
    byId("run-followup").addEventListener("change", syncRunType);

    byId("create-btn").addEventListener("click", async () => {
      hide(byId("builder-error"));
      const inviteCount = Number(byId("invite-count").value);
      if (!Number.isInteger(inviteCount) || inviteCount < 3 || inviteCount > 50) {
        notice(byId("builder-error"), "Enter how many people will answer: 3 to 50.", "error");
        return;
      }
      let body;
      if (isFollowUp()) {
        if (!baselineSelect.value) {
          notice(
            byId("builder-error"),
            "Choose a baseline survey, or switch to a Baseline run.",
            "error"
          );
          return;
        }
        body = { parentSurveyId: baselineSelect.value, inviteCount };
      } else {
        body = {
          teamId: teamSelect.value,
          templateId: byId("template-select").value,
          inviteCount
        };
      }

      byId("create-btn").disabled = true;
      const res = await apiPost("/api/surveys", body);
      byId("create-btn").disabled = false;
      if (!res.ok) {
        notice(
          byId("builder-error"),
          (res.data && res.data.error) || "Could not create the survey.",
          "error"
        );
        return;
      }
      showInviteLinks(byId("result-links"), byId("copy-result"), res.data.inviteLinks);
      hide(byId("builder-form"));
      show(byId("builder-result"));
    });
  }

  // ----------------------------------------------------------------------
  // Report
  // ----------------------------------------------------------------------
  function deltaInfo(delta) {
    if (delta === null || delta === undefined) {
      return { text: "", cls: "delta-flat" };
    }
    if (delta > 0.05) return { text: `▲ +${delta.toFixed(1)}`, cls: "delta-up" };
    if (delta < -0.05) return { text: `▼ ${delta.toFixed(1)}`, cls: "delta-down" };
    return { text: "± 0.0", cls: "delta-flat" };
  }

  function renderHead(data) {
    const s = data.survey;
    byId("report-title").textContent = s.teamName || "Survey";
    const bits = [
      s.templateName,
      s.parentSurveyId ? "follow-up" : "baseline",
      `${data.responseCount} response${data.responseCount === 1 ? "" : "s"}`
    ];
    if (data.flaggedCount) bits.push(`${data.flaggedCount} flagged`);
    byId("report-sub").textContent = bits.join(" · ");
  }

  async function renderInviteUsage(id, isOpen) {
    const res = await apiGet(`/api/surveys/${encodeURIComponent(id)}`);
    if (!res.ok) return;
    const usage = { used: res.data.survey.invitesUsed, total: res.data.survey.invitesTotal };
    byId("invite-usage").textContent = inviteUsageText(usage.used, usage.total);
    if (!isOpen) return;
    show(byId("add-links"));
    wireAddLinks(id, usage);
  }

  function renderControls(id, data) {
    const s = data.survey;
    renderInviteUsage(id, s.status === "open");

    if (!data.locked) {
      const csv = byId("csv-link");
      csv.href = `/api/surveys/${encodeURIComponent(id)}/export.csv`;
      show(csv);
    }

    const toggle = byId("toggle-status");
    toggle.textContent = s.status === "open" ? "Close survey" : "Reopen survey";
    toggle.addEventListener("click", async () => {
      const action = s.status === "open" ? "close" : "reopen";
      const r = await apiPost(`/api/surveys/${encodeURIComponent(id)}/${action}`);
      if (r.ok) window.location.reload();
      else notice(byId("control-message"), "Could not update the survey.", "error");
    });

    byId("delete-survey").addEventListener("click", async () => {
      const ok = await confirmModal({
        title: "Delete survey",
        message:
          "Delete this survey and every response to it? This cannot be undone.",
        confirmLabel: "Delete survey"
      });
      if (!ok) return;
      const r = await apiDelete(`/api/surveys/${encodeURIComponent(id)}`);
      if (r.ok) window.location.href = "/dashboard";
      else notice(byId("control-message"), "Could not delete the survey.", "error");
    });
  }

  function renderReport(data) {
    drawRadar(byId("radar"), { axes: data.axes });
    if (!data.hasBaseline) hide(byId("legend-baseline"));

    const focus = byId("focus");
    if (data.focusAreas.length === 0) {
      setChildren(focus, [
        el("p", {
          class: "muted",
          text: "No pressing focus areas — every axis looks healthy."
        })
      ]);
    } else {
      setChildren(
        focus,
        data.focusAreas.map((a) =>
          el(
            "div",
            { class: `focus-card focus-${a.scenario}` },
            el(
              "div",
              { class: "focus-card-head" },
              el("span", { class: "focus-axis", text: a.name }),
              el("span", { class: "focus-score", text: a.mean.toFixed(1) })
            ),
            el("p", { class: "focus-tip", text: a.tip || "" })
          )
        )
      );
    }

    setChildren(
      byId("axes"),
      data.axes.map((a) => {
        const d = deltaInfo(a.delta);
        const { glyph, cls } = weatherForScore(a.mean);
        const glyphSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        glyphSvg.setAttribute("class", `axis-glyph ${cls}`);
        glyphSvg.setAttribute("aria-hidden", "true");
        const useEl = document.createElementNS("http://www.w3.org/2000/svg", "use");
        useEl.setAttribute("href", `/illos/theme-illos.svg#${glyph}`);
        glyphSvg.append(useEl);
        return el(
          "div",
          { class: "axis-card" },
          el("div", { class: "axis-card-name" }, glyphSvg, a.name),
          el(
            "div",
            { class: "row" },
            el("span", { class: "axis-card-score", text: a.mean.toFixed(1) }),
            a.delta !== null
              ? el("span", { class: `axis-delta ${d.cls}`, text: d.text })
              : null
          ),
          a.divided ? el("span", { class: "tag tag-divided", text: "divided" }) : null
        );
      })
    );

    byId("guidance").textContent = data.guidanceNote;
  }

  function renderBreakdown(questions) {
    setChildren(
      byId("breakdown"),
      questions.map((q) => {
        const fill = el("div", { class: "bar-fill" });
        const bar = el("div", { class: "bar" }, fill);
        const row = el(
          "div",
          { class: "q-row" },
          el(
            "div",
            {},
            el("div", { class: "q-text", text: q.text }),
            el(
              "div",
              { class: "q-meta" },
              el("span", { class: "faint", text: q.axisName }),
              q.divided
                ? el("span", { class: "tag tag-divided", text: "divided" })
                : null
            )
          ),
          el(
            "div",
            { class: "row" },
            bar,
            el("span", { class: "q-score", text: q.mean.toFixed(1) })
          )
        );
        fill.style.width = `${(q.mean / 5) * 100}%`;
        return row;
      })
    );
  }

  async function reportMode(id) {
    if (!(await requireSession())) return;

    const res = await apiGet(`/api/surveys/${encodeURIComponent(id)}/report`);
    if (res.status === 403) {
      window.location.href = "/dashboard";
      return;
    }
    if (res.status === 404) return fail("Survey not found.");
    if (!res.ok) return fail("Could not load this report.");

    hide(byId("loading"));
    show(byId("report"));
    renderHead(res.data);
    renderControls(id, res.data);

    if (res.data.locked) {
      notice(
        byId("report-locked"),
        `This report stays hidden until the survey has 3 responses ` +
          `(currently ${res.data.responseCount}) — it protects anonymity.`,
        "info"
      );
      return;
    }

    show(byId("report-body"));
    renderReport(res.data);

    const breakdown = await apiGet(
      `/api/surveys/${encodeURIComponent(id)}/breakdown`
    );
    if (breakdown.ok && !breakdown.data.locked) {
      renderBreakdown(breakdown.data.questions);
    }
  }

  byId("signout-btn").addEventListener("click", () => {
    // Hub-delegated logout: revokes the central session, clears the local
    // cookie, and redirects to the hub.
    window.location.href = "/auth/logout";
  });

  if (surveyId) reportMode(surveyId);
  else builderMode();
})();
