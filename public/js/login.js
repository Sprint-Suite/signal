"use strict";

(function () {
  const form = byId("login-form");
  const errorBox = byId("login-error");
  const button = byId("login-btn");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    hide(errorBox);
    button.disabled = true;

    const res = await apiPost("/api/auth/login", {
      email: byId("email").value.trim(),
      password: byId("password").value
    });

    if (res.ok) {
      window.location.href = "/dashboard";
      return;
    }
    button.disabled = false;
    notice(
      errorBox,
      (res.data && res.data.error) || "Sign in failed. Please try again.",
      "error"
    );
  });
})();
