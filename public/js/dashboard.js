"use strict";

/**
 * Pick a weather glyph that summarises a survey's status for the
 * dashboard tile. Closed surveys lean on their average score; open
 * surveys use a neutral cloud until results are in.
 */
function weatherGlyphFor(survey) {
  if (survey.status !== "closed") return "cloud";
  const avg = Number(survey.averageScore);
  if (!Number.isFinite(avg)) return "cloud";
  if (avg >= 4)   return "sun";
  if (avg >= 3)   return "cloud";
  if (avg >= 2)   return "wind";
  return "rain";
}

(function () {
  byId("signout-btn").addEventListener("click", async () => {
    await apiPost("/api/auth/logout");
    window.location.href = "/";
  });

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatDate(iso) {
    return iso ? new Date(iso).toLocaleDateString() : "";
  }

  function surveyRow(survey, followUpCount) {
    const responses = `${survey.responseCount} response${
      survey.responseCount === 1 ? "" : "s"
    }`;
    const flaggedHtml = survey.flaggedCount > 0
      ? ` · <span class="tag tag-flagged">${survey.flaggedCount} flagged</span>`
      : "";
    const kindLabel = survey.parentSurveyId ? "Follow-up" : "Baseline";
    const chip =
      !survey.parentSurveyId && followUpCount > 0
        ? `<span class="series-followup-chip">+${followUpCount} follow-up${followUpCount === 1 ? "" : "s"}</span>`
        : "";
    const glyph = weatherGlyphFor(survey);

    const row = document.createElement("a");
    row.className = "postcard-tile";
    row.href = `/survey?id=${encodeURIComponent(survey.id)}`;
    row.innerHTML = `
      <svg class="glyph" aria-hidden="true"><use href="/illos/theme-illos.svg#${glyph}"/></svg>
      <div class="pt-main">
        <div class="pt-team">${escapeHtml(kindLabel)}${chip}</div>
        <div class="pt-meta">opened ${escapeHtml(formatDate(survey.openedAt))} · ${escapeHtml(responses)}${flaggedHtml}</div>
      </div>
      <span class="pill ${survey.status === "open" ? "tag-ok" : "tag"}">${escapeHtml(survey.status)}</span>
    `;
    return row;
  }

  /**
   * Build a nested tree from the flat survey list. Returns an array of teams,
   * each containing templatesList (with chains of baselines + follow-ups) and
   * an orphans bucket for follow-ups whose baseline was deleted.
   */
  function buildTree(surveys) {
    const byTeam = new Map();
    for (const s of surveys) {
      if (!byTeam.has(s.teamId)) {
        byTeam.set(s.teamId, { teamId: s.teamId, teamName: s.teamName, templates: new Map() });
      }
      const team = byTeam.get(s.teamId);
      if (!team.templates.has(s.templateId)) {
        team.templates.set(s.templateId, {
          templateId: s.templateId,
          templateName: s.templateName,
          templateVersion: s.templateVersion,
          baselines: [],
          followUps: []
        });
      }
      const grp = team.templates.get(s.templateId);
      if (s.parentSurveyId) grp.followUps.push(s);
      else grp.baselines.push(s);
    }

    const teams = Array.from(byTeam.values()).sort((a, b) =>
      a.teamName.localeCompare(b.teamName)
    );

    for (const team of teams) {
      const templates = Array.from(team.templates.values()).sort((a, b) =>
        a.templateName.localeCompare(b.templateName)
      );
      team.templatesList = templates;
      team.orphans = [];

      for (const grp of templates) {
        grp.baselines.sort((a, b) => String(b.openedAt).localeCompare(String(a.openedAt)));
        const baselineIds = new Set(grp.baselines.map((b) => b.id));
        grp.chains = grp.baselines.map((baseline) => ({
          baseline,
          followUps: grp.followUps
            .filter((f) => f.parentSurveyId === baseline.id)
            .sort((a, b) => String(a.openedAt).localeCompare(String(b.openedAt)))
        }));
        // Anything whose parentSurveyId doesn't match a baseline in this group
        // is an orphan at the team level.
        for (const f of grp.followUps) {
          if (!baselineIds.has(f.parentSurveyId)) team.orphans.push(f);
        }
      }
    }
    return teams;
  }

  function renderTree(tree, container) {
    container.innerHTML = "";
    for (const team of tree) {
      const teamHeader = document.createElement("h2");
      teamHeader.className = "series-team-name";
      teamHeader.textContent = team.teamName;
      container.appendChild(teamHeader);

      for (const grp of team.templatesList) {
        if (grp.chains.length === 0) continue;
        const tplHeader = document.createElement("div");
        tplHeader.className = "series-template-name";
        tplHeader.textContent = `${grp.templateName} (v${grp.templateVersion})`;
        container.appendChild(tplHeader);

        for (const chain of grp.chains) {
          container.appendChild(surveyRow(chain.baseline, chain.followUps.length));
          if (chain.followUps.length > 0) {
            const wrap = document.createElement("div");
            wrap.className = "series-followups";
            for (const f of chain.followUps) {
              wrap.appendChild(surveyRow(f, 0));
            }
            container.appendChild(wrap);
          }
        }
      }

      if (team.orphans.length > 0) {
        const label = document.createElement("div");
        label.className = "series-orphans-label";
        label.textContent = "Orphaned follow-ups (baseline deleted)";
        container.appendChild(label);
        const wrap = document.createElement("div");
        wrap.className = "series-followups";
        for (const f of team.orphans) {
          wrap.appendChild(surveyRow(f, 0));
        }
        container.appendChild(wrap);
      }
    }
  }

  async function loadResend() {
    const banner = byId("verify-banner");
    const messageBox = byId("verify-banner-message");
    byId("resend-btn").addEventListener("click", async () => {
      hide(messageBox);
      const res = await apiPost("/api/auth/resend-verification");
      notice(
        messageBox,
        res.ok
          ? "Verification email sent."
          : (res.data && res.data.error) || "Could not send the email.",
        res.ok ? "ok" : "error"
      );
    });
    show(banner);
  }

  async function init() {
    if (!(await requireSession())) return;

    const res = await apiGet("/api/surveys");
    if (res.status === 403) {
      await loadResend();
      return;
    }

    show(byId("main-content"));
    const surveys = (res.data && res.data.surveys) || [];
    const list = byId("survey-list");
    if (surveys.length === 0) {
      show(byId("empty-state"));
      return;
    }
    renderTree(buildTree(surveys), list);
  }

  init();
})();
