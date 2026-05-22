"use strict";

(function () {
  const form = byId("reset-form");
  const messageBox = byId("reset-message");
  const button = byId("reset-btn");
  const done = byId("reset-done");
  const token = qsParam("token");

  if (!token) {
    notice(messageBox, "This reset link is missing its token.", "error");
    button.disabled = true;
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    hide(messageBox);

    const password = byId("password").value;
    const confirm = byId("confirm").value;
    if (password !== confirm) {
      notice(messageBox, "The two passwords do not match.", "error");
      return;
    }

    button.disabled = true;
    const res = await apiPost("/api/auth/reset", { token, password });

    if (res.ok) {
      notice(messageBox, "Password updated. You can now sign in.", "ok");
      hide(form);
      show(done);
      return;
    }
    button.disabled = false;
    notice(
      messageBox,
      (res.data && res.data.error) || "Could not reset the password.",
      "error"
    );
  });
})();
