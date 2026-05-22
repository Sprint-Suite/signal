"use strict";

(function () {
  const messageBox = byId("verify-message");
  const link = byId("verify-link");
  const token = qsParam("token");

  async function run() {
    if (!token) {
      notice(messageBox, "This verification link is missing its token.", "error");
      show(link);
      return;
    }
    const res = await apiPost("/api/auth/verify", { token });
    if (res.ok) {
      notice(
        messageBox,
        "Your email is verified. You can now sign in and use Signal.",
        "ok"
      );
    } else {
      notice(
        messageBox,
        (res.data && res.data.error) ||
          "This verification link is invalid or has expired.",
        "error"
      );
    }
    show(link);
  }

  run();
})();
