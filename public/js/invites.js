"use strict";

// Single-use invite links: plaintext is only available in the creation
// response, so links are shown once with one copy-all button.

async function copyAndFlash(button, text) {
  const ok = await copyText(text);
  const original = button.textContent;
  button.textContent = ok ? "Copied" : "Copy failed";
  window.setTimeout(() => {
    button.textContent = original;
  }, 1500);
}

/** Render `links` into `container` and point `copyButton` at all of them. */
function showInviteLinks(container, copyButton, links) {
  setChildren(
    container,
    links.map((link) => el("p", { class: "key-box", text: link }))
  );
  copyButton.onclick = () => copyAndFlash(copyButton, links.join("\n"));
}

function inviteUsageText(used, total) {
  return `${used} of ${total} links used`;
}

/** Wire the survey detail's "Add links" control for an open survey. */
function wireAddLinks(surveyId, usage) {
  const message = byId("invite-message");
  byId("add-links-btn").addEventListener("click", async () => {
    const count = Number(byId("add-count").value);
    if (!Number.isInteger(count) || count < 1 || count > 50) {
      notice(message, "Enter a number of links from 1 to 50.", "error");
      return;
    }
    const res = await apiPost(
      `/api/surveys/${encodeURIComponent(surveyId)}/invites`,
      { count }
    );
    if (!res.ok) {
      notice(message, (res.data && res.data.error) || "Could not add links.", "error");
      return;
    }
    hide(message);
    usage.total += res.data.inviteLinks.length;
    byId("invite-usage").textContent = inviteUsageText(usage.used, usage.total);
    showInviteLinks(byId("new-links"), byId("copy-new"), res.data.inviteLinks);
    show(byId("new-links-block"));
  });
}
