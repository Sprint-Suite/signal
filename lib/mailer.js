"use strict";

/**
 * lib/mailer.js — the email transport seam.
 *
 * One responsibility: deliver a message. In v1 the transport is `log` — it
 * writes the message (including any verification / reset link) to the server
 * log instead of sending it. Swapping to a real transport (SMTP, or an API
 * like Resend / Postmark / SES) in v1.1 is a change to THIS FILE ONLY.
 *
 * `sendMail` is async so the interface does not change when a real,
 * network-bound transport replaces the log transport.
 */

function logTransport({ to, subject, body }) {
  const line = "-".repeat(60);
  console.log(line);
  console.log("[mailer:log] Email not sent — transport is 'log' (v1 default).");
  console.log(`  To:      ${to}`);
  console.log(`  Subject: ${subject}`);
  console.log("");
  console.log(
    String(body || "")
      .split("\n")
      .map((l) => `  ${l}`)
      .join("\n")
  );
  console.log(line);
}

/**
 * Build a mailer bound to a transport.
 * @param {{transport?: string}} [options] — defaults to MAIL_TRANSPORT env, then 'log'.
 */
function createMailer(options = {}) {
  const transport = options.transport || process.env.MAIL_TRANSPORT || "log";

  async function sendMail({ to, subject, body }) {
    if (!to || !subject) {
      throw new Error("sendMail requires 'to' and 'subject'.");
    }
    if (transport === "log") {
      logTransport({ to, subject, body });
      return { delivered: false, transport: "log" };
    }
    // 'smtp' / 'api' are deferred to v1.1.
    throw new Error(
      `Mail transport "${transport}" is not configured. Set MAIL_TRANSPORT=log for v1.`
    );
  }

  return { transport, sendMail };
}

const defaultMailer = createMailer();

module.exports = {
  createMailer,
  sendMail: defaultMailer.sendMail
};
