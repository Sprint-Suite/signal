"use strict";

(function () {
  byId("signout-btn").addEventListener("click", async () => {
    await apiPost("/api/auth/logout");
    window.location.href = "/";
  });

  function formatDate(iso) {
    return iso ? new Date(iso).toLocaleDateString() : "";
  }

  function surveyRow(survey) {
    const flagged =
      survey.flaggedCount > 0
        ? el("span", { class: "tag tag-flagged", text: `${survey.flaggedCount} flagged` })
        : null;
    const responses = `${survey.responseCount} response${
      survey.responseCount === 1 ? "" : "s"
    }`;

    return el(
      "a",
      { class: "survey-row", href: `/survey?id=${encodeURIComponent(survey.id)}` },
      el(
        "span",
        { class: "survey-row-main" },
        el("span", { class: "survey-row-team", text: survey.teamName }),
        el("span", { class: "faint" },
          ` · ${survey.templateName}`,
          survey.parentSurveyId ? " · follow-up" : "",
          ` · opened ${formatDate(survey.openedAt)}`)
      ),
      el(
        "span",
        { class: "row" },
        el("span", { class: "muted" }, responses),
        flagged,
        el("span", {
          class: `pill pill-${survey.status === "open" ? "open" : "closed"}`,
          text: survey.status
        })
      )
    );
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
