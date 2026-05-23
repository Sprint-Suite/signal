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

  function surveyRow(survey) {
    const responses = `${survey.responseCount} response${
      survey.responseCount === 1 ? "" : "s"
    }`;
    const flaggedHtml = survey.flaggedCount > 0
      ? ` · <span class="tag tag-flagged">${survey.flaggedCount} flagged</span>`
      : "";
    const followUp = survey.parentSurveyId ? " · follow-up" : "";
    const glyph = weatherGlyphFor(survey);

    const row = document.createElement("a");
    row.className = "postcard-tile";
    row.href = `/survey?id=${encodeURIComponent(survey.id)}`;
    row.innerHTML = `
      <svg class="glyph" aria-hidden="true"><use href="/illos/theme-illos.svg#${glyph}"/></svg>
      <div class="pt-main">
        <div class="pt-team">${escapeHtml(survey.teamName)}</div>
        <div class="pt-meta">${escapeHtml(survey.templateName)}${escapeHtml(followUp)} · opened ${escapeHtml(formatDate(survey.openedAt))} · ${escapeHtml(responses)}${flaggedHtml}</div>
      </div>
      <span class="pill ${survey.status === "open" ? "tag-ok" : "tag"}">${escapeHtml(survey.status)}</span>
    `;
    return row;
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
    setChildren(list, surveys.map(surveyRow));
  }

  init();
})();
