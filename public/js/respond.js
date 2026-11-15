"use strict";

(function () {
  // The invite code is the last path segment of /s/CODE.
  const code = window.location.pathname.split("/").filter(Boolean).pop();

  const SCALE_LABELS = {
    1: "Strongly disagree",
    2: "Disagree",
    3: "Neutral",
    4: "Agree",
    5: "Strongly agree"
  };

  let questions = [];
  let scaleMin = 1;
  let scaleMax = 5;
  let index = 0;
  let startTime = 0;
  const answers = new Map(); // questionId -> score

  function render() {
    const q = questions[index];
    byId("progress-text").textContent = `Question ${index + 1} of ${questions.length}`;
    byId("progress-fill").style.width = `${((index + 1) / questions.length) * 100}%`;
    byId("axis-label").textContent = q.axisName;
    byId("question-text").textContent = q.text;

    const scale = byId("scale");
    scale.replaceChildren();
    for (let s = scaleMin; s <= scaleMax; s += 1) {
      const selected = answers.get(q.id) === s;
      const option = el(
        "label",
        { class: `scale-option${selected ? " selected" : ""}` },
        el("input", {
          type: "radio",
          name: "scale",
          value: String(s),
          ...(selected ? { checked: "checked" } : {})
        }),
        el("span", { class: "scale-num", text: String(s) }),
        el("span", { text: SCALE_LABELS[s] || "" })
      );
      option.addEventListener("click", () => {
        answers.set(q.id, s);
        render();
      });
      scale.append(option);
    }

    byId("back-btn").disabled = index === 0;
    const next = byId("next-btn");
    next.textContent = index === questions.length - 1 ? "Submit" : "Next";
    next.disabled = !answers.has(q.id);
    hide(byId("respond-error"));
  }

  async function submit() {
    const next = byId("next-btn");
    next.disabled = true;
    const res = await apiPost(`/api/respond/${encodeURIComponent(code)}`, {
      answers: questions.map((q) => ({
        questionId: q.id,
        score: answers.get(q.id)
      })),
      durationSeconds: (Date.now() - startTime) / 1000
    });
    if (res.ok) {
      const postcard = document.querySelector(".question-postcard");
      const finish = () => {
        hide(byId("respond-question"));
        show(byId("respond-thanks"));
      };
      if (postcard) {
        postcard.classList.add("motion-send");
        postcard.addEventListener("animationend", finish, { once: true });
      } else {
        finish();
      }
      return;
    }
    next.disabled = false;
    notice(
      byId("respond-error"),
      (res.data && res.data.error) || "Could not submit. Please try again.",
      "error"
    );
  }

  async function init() {
    byId("back-btn").addEventListener("click", () => {
      if (index > 0) {
        index -= 1;
        render();
      }
    });
    byId("next-btn").addEventListener("click", () => {
      if (!answers.has(questions[index].id)) return;
      if (index < questions.length - 1) {
        index += 1;
        render();
      } else {
        submit();
      }
    });

    const res = await apiGet(`/api/respond/${encodeURIComponent(code)}`);
    hide(byId("respond-loading"));

    if (res.data && res.data.used) {
      show(byId("respond-used"));
      return;
    }
    if (res.status === 404 || !res.data || res.data.open === false) {
      show(byId("respond-closed"));
      return;
    }
    questions = res.data.questions || [];
    if (res.data.scale) {
      scaleMin = res.data.scale.min;
      scaleMax = res.data.scale.max;
    }
    if (questions.length === 0) {
      show(byId("respond-closed"));
      return;
    }
    startTime = Date.now();
    show(byId("respond-question"));
    render();
  }

  init();
})();
