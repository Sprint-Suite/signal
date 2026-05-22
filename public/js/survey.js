"use strict";

(function () {
  const surveyId = qsParam("id");

  function fail(message) {
    hide(byId("loading"));
    notice(byId("page-error"), message, "error");
  }

  async function copyAndFlash(button, text) {
    const ok = await copyText(text);
    const original = button.textContent;
    button.textContent = ok ? "Copied" : "Copy failed";
    window.setTimeout(() => {
      button.textContent = original;
    }, 1500);
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
      setChildren(
        baselineSelect,
        forTeam.length
          ? forTeam.map((s) =>
              el("option", {
                value: s.id,
                text: `${s.templateName} — opened ${formatDate(
                  s.openedAt
                )} (${s.responseCount} responses)`
              })
            )
          : [el("option", { value: "", text: "No earlier surveys for this team" })]
      );
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
        body = { parentSurveyId: baselineSelect.value };
      } else {
        body = {
          teamId: teamSelect.value,
          templateId: byId("template-select").value
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
      const link = res.data.survey.link;
      byId("result-link").textContent = link;
      byId("copy-result").addEventListener("click", () =>
        copyAndFlash(byId("copy-result"), link)
      );
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

  function renderControls(id, data) {
    const s = data.survey;
    const link = `${window.location.origin}/s/${s.accessCode}`;
    byId("share-link").textContent = link;
    byId("copy-share").addEventListener("click", () =>
      copyAndFlash(byId("copy-share"), link)
    );

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
      if (
        !window.confirm(
          "Delete this survey and every response to it? This cannot be undone."
        )
      ) {
        return;
      }
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
        return el(
          "div",
          { class: "axis-card" },
          el("div", { class: "axis-card-name", text: a.name }),
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

  if (surveyId) reportMode(surveyId);
  else builderMode();
})();
