"use strict";

(function () {
  byId("signout-btn").addEventListener("click", async () => {
    await apiPost("/api/auth/logout");
    window.location.href = "/";
  });

  function formatDate(iso) {
    return iso ? new Date(iso).toLocaleString() : "—";
  }

  function renderAccount(user) {
    byId("acct-email").textContent = user.email;
    byId("acct-verified").textContent = user.emailVerified ? "Yes" : "No";
    byId("acct-created").textContent = formatDate(user.createdAt);
    byId("acct-last").textContent = formatDate(user.lastLoginAt);
  }

  byId("password-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    hide(byId("password-message"));

    const newPassword = byId("cp-new").value;
    if (newPassword !== byId("cp-confirm").value) {
      notice(byId("password-message"), "The new passwords do not match.", "error");
      return;
    }

    byId("password-btn").disabled = true;
    const res = await apiPost("/api/auth/change-password", {
      currentPassword: byId("cp-current").value,
      newPassword
    });
    byId("password-btn").disabled = false;

    if (res.ok) {
      notice(byId("password-message"), "Password updated.", "ok");
      byId("password-form").reset();
    } else {
      notice(
        byId("password-message"),
        (res.data && res.data.error) || "Could not update the password.",
        "error"
      );
    }
  });

  byId("email-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    hide(byId("email-message"));

    byId("email-btn").disabled = true;
    const res = await apiPost("/api/auth/change-email", {
      newEmail: byId("ce-new").value.trim(),
      currentPassword: byId("ce-current").value
    });
    byId("email-btn").disabled = false;

    if (res.ok) {
      notice(byId("email-message"), "Login email updated.", "ok");
      byId("acct-email").textContent = res.data.email;
      byId("email-form").reset();
    } else {
      notice(
        byId("email-message"),
        (res.data && res.data.error) || "Could not update the email.",
        "error"
      );
    }
  });

  async function init() {
    const user = await requireSession();
    if (!user) return;
    renderAccount(user);
  }

  init();
})();
