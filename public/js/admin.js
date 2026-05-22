"use strict";

(function () {
  byId("signout-btn").addEventListener("click", async () => {
    await apiPost("/api/auth/logout");
    window.location.href = "/";
  });

  function revealKey(label, key) {
    byId("key-reveal-label").textContent = label;
    byId("key-reveal-value").textContent = key;
    show(byId("key-reveal"));
  }

  function teamRow(team) {
    return el(
      "div",
      { class: "survey-row" },
      el(
        "span",
        { class: "survey-row-main" },
        el("span", { class: "survey-row-team", text: team.name }),
        team.weak ? el("span", { class: "tag tag-flagged", text: " weak key" }) : null
      ),
      el(
        "span",
        { class: "row" },
        el("button", {
          class: "btn btn-sm",
          type: "button",
          text: "Rotate key",
          onclick: () => rotateKey(team)
        }),
        el("button", {
          class: "btn btn-sm btn-danger",
          type: "button",
          text: "Delete",
          onclick: () => deleteTeam(team)
        })
      )
    );
  }

  async function loadTeams() {
    const res = await apiGet("/api/teams");
    if (res.status === 403) {
      window.location.href = "/dashboard";
      return;
    }
    const teams = (res.data && res.data.teams) || [];
    setChildren(
      byId("team-list"),
      teams.length
        ? teams.map(teamRow)
        : [el("p", { class: "muted", text: "No teams yet." })]
    );
  }

  async function createTeam() {
    const input = byId("team-name");
    const name = input.value.trim();
    hide(byId("team-message"));
    if (!name) {
      notice(byId("team-message"), "Enter a team name.", "error");
      return;
    }
    const res = await apiPost("/api/teams", { name });
    if (!res.ok) {
      notice(
        byId("team-message"),
        (res.data && res.data.error) || "Could not create the team.",
        "error"
      );
      return;
    }
    input.value = "";
    revealKey(`Access key for "${res.data.team.name}" — copy it now:`, res.data.accessKey);
    await loadTeams();
  }

  async function rotateKey(team) {
    if (
      !window.confirm(
        `Rotate the access key for "${team.name}"? The current key stops working.`
      )
    ) {
      return;
    }
    const res = await apiPost(`/api/teams/${encodeURIComponent(team.id)}/rotate-key`);
    if (!res.ok) {
      notice(byId("team-message"), "Could not rotate the key.", "error");
      return;
    }
    revealKey(`New access key for "${team.name}" — copy it now:`, res.data.accessKey);
  }

  async function deleteTeam(team) {
    if (!window.confirm(`Delete the team "${team.name}"?`)) return;
    const res = await apiDelete(`/api/teams/${encodeURIComponent(team.id)}`);
    if (!res.ok) {
      notice(
        byId("team-message"),
        (res.data && res.data.error) || "Could not delete the team.",
        "error"
      );
      return;
    }
    hide(byId("key-reveal"));
    await loadTeams();
  }

  async function invite() {
    const input = byId("invite-email");
    hide(byId("invite-message"));
    const res = await apiPost("/api/auth/invite", { email: input.value.trim() });
    if (res.ok) {
      notice(
        byId("invite-message"),
        `Invite sent to ${res.data.email}.`,
        "ok"
      );
      input.value = "";
    } else {
      notice(
        byId("invite-message"),
        (res.data && res.data.error) || "Could not send the invite.",
        "error"
      );
    }
  }

  async function init() {
    if (!(await requireSession())) return;
    byId("create-team-btn").addEventListener("click", createTeam);
    byId("invite-btn").addEventListener("click", invite);
    await loadTeams();
  }

  init();
})();
