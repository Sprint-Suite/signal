"use strict";

(function () {
  byId("signout-btn").addEventListener("click", () => {
    // Hub-delegated logout: revokes the central session, clears the local
    // cookie, and redirects to the hub.
    window.location.href = "/auth/logout";
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
    const ok = await confirmModal({
      title: "Rotate access key",
      message: `Rotate the access key for "${team.name}"? The current key stops working immediately.`,
      confirmLabel: "Rotate key"
    });
    if (!ok) return;
    const res = await apiPost(`/api/teams/${encodeURIComponent(team.id)}/rotate-key`);
    if (!res.ok) {
      notice(byId("team-message"), "Could not rotate the key.", "error");
      return;
    }
    revealKey(`New access key for "${team.name}" — copy it now:`, res.data.accessKey);
  }

  async function deleteTeam(team) {
    const ok = await confirmModal({
      title: "Delete team",
      message: `Delete the team "${team.name}"? This cannot be undone.`,
      confirmLabel: "Delete team"
    });
    if (!ok) return;
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

  async function init() {
    byId("create-team-btn").addEventListener("click", createTeam);
    await loadTeams();
  }

  init();
})();
