"use strict";

(function () {
  const form = byId("forgot-form");
  const messageBox = byId("forgot-message");
  const button = byId("forgot-btn");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    hide(messageBox);
    button.disabled = true;

    const res = await apiPost("/api/auth/forgot", {
      email: byId("email").value.trim()
    });

    button.disabled = false;
    // The response is deliberately generic — it never reveals whether the
    // account exists.
    notice(
      messageBox,
      (res.data && res.data.message) ||
        "If an account exists for that email, a reset link has been sent.",
      "ok"
    );
    form.reset();
  });
})();
