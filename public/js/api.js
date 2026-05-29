"use strict";

/* Shared browser helpers, loaded first on every page. No modules — the strict
   CSP serves plain external scripts only. These names are intentionally
   global for the per-page scripts that follow. */

/** Element by id. */
function byId(id) {
  return document.getElementById(id);
}

/** A query-string parameter from the current URL. */
function qsParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

/** Build a DOM node. attrs: class | text | html | onX listeners | attributes. */
function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === undefined) continue;
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else if (key === "html") node.innerHTML = value;
      else if (key.startsWith("on") && typeof value === "function") {
        node.addEventListener(key.slice(2), value);
      } else node.setAttribute(key, value);
    }
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** Replace a node's children. */
function setChildren(node, ...children) {
  node.replaceChildren(...children.flat().filter(Boolean));
}

function show(node) {
  if (node) node.classList.remove("hidden");
}
function hide(node) {
  if (node) node.classList.add("hidden");
}

/** Send a JSON request. Resolves to { ok, status, data }. */
async function apiSend(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  // Session lost mid-use: the server guard (auth.requireAuth) 302-redirects an
  // expired/absent session to the hub login, which fetch follows cross-origin.
  // Reload so the top-level navigation bounces us through the guard properly.
  if (res.redirected || res.status === 401) {
    window.location.reload();
    return { ok: false, status: res.status || 401, data: null };
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: res.ok, status: res.status, data };
}

const apiGet = (path) => apiSend("GET", path);
const apiPost = (path, body) => apiSend("POST", path, body);
const apiDelete = (path) => apiSend("DELETE", path);

/**
 * Authenticated pages are guarded server-side by the hub (auth.requireAuth):
 * an absent/expired session never reaches this page — it is 302-bounced to the
 * hub login before the HTML is served. So by the time page JS runs we are
 * signed in, and this is a no-op kept for call-site compatibility. Mid-session
 * expiry is handled by apiSend() (reload on redirect/401) and the heartbeat.
 */
async function requireSession() {
  return true;
}

/** Render a message into a notice element. kind: error | ok | info. */
function notice(node, message, kind) {
  if (!node) return;
  node.className = `notice notice-${kind || "info"}`;
  node.textContent = message;
  show(node);
}

/** Copy text to the clipboard, falling back to a hidden textarea. */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * A styled confirmation dialog — the in-page replacement for window.confirm().
 * Resolves true when confirmed, false when cancelled (Cancel, Escape, or a
 * click on the backdrop).
 *
 * @param {{title?, message?, confirmLabel?, cancelLabel?, danger?}} options
 *        `danger` defaults to true (a destructive-looking confirm button).
 */
function confirmModal(options) {
  const opts = options || {};
  return new Promise((resolve) => {
    const titleId = `modal-title-${Date.now()}`;
    const cancelBtn = el("button", {
      class: "btn",
      type: "button",
      text: opts.cancelLabel || "Cancel"
    });
    const confirmBtn = el("button", {
      class: `btn ${opts.danger === false ? "btn-primary" : "btn-danger"}`,
      type: "button",
      text: opts.confirmLabel || "Confirm"
    });
    const overlay = el(
      "div",
      { class: "modal-overlay" },
      el(
        "div",
        {
          class: "modal-content",
          role: "dialog",
          "aria-modal": "true",
          "aria-labelledby": titleId
        },
        el("h2", { id: titleId, text: opts.title || "Are you sure?" }),
        opts.message ? el("p", { class: "modal-message", text: opts.message }) : null,
        el("div", { class: "modal-actions" }, cancelBtn, confirmBtn)
      )
    );

    function close(result) {
      document.removeEventListener("keydown", onKey);
      overlay.remove();
      resolve(result);
    }
    function onKey(event) {
      if (event.key === "Escape") close(false);
    }
    cancelBtn.addEventListener("click", () => close(false));
    confirmBtn.addEventListener("click", () => close(true));
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close(false); // backdrop click
    });
    document.addEventListener("keydown", onKey);

    document.body.append(overlay);
    confirmBtn.focus();
  });
}
