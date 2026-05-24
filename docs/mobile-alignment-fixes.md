# Signal App — Mobile Alignment Fixes

**Context:** Review of three mobile screenshots (`sprintsignal.uk`) after a restyle. This document lists the alignment issues found and the exact fixes to apply. Hand straight to Claude Code.

**Scope:** Mobile (narrow viewport, ~390px wide). Verify each fix does not regress desktop.

---

## Summary Table

| # | Screen | Issue | Severity | Decision |
|---|--------|-------|----------|----------|
| 1 | New Survey | Radio dot misaligned with label; label wraps under the dot | High | Single-line radio rows, dot pinned to text |
| 2 | All screens | Nav pills ("All surveys", "Sign out") wrap to two lines | Medium | Force each pill to one line on mobile |
| 3 | Teams | Team name wraps; action buttons misalign | Medium | Stack name above buttons on mobile |
| 4 | Health Check | "Radar" card has a green border unlike other white cards | Low | Match the other white cards |

---

## Fix 1 — New Survey Radio Alignment (HIGH)

**Problem:** The radio dot sits above its label, and when a label is long ("Follow-up — compared against an earlier run") the text wraps to a second line while the dot stays pinned at the top, floating away from the text.

**Cause:** Radio input and label laid out without a shared flex row, so the input defaults to `vertical-align: baseline` and the wrapping label is not held in an indented text column.

**Intended structure:** Single line per option (dot + one label, label may wrap but stays beside the dot).

### Markup (target shape)

```html
<div class="radio-option">
  <input type="radio" id="run-baseline" name="run-type" value="baseline" checked>
  <label for="run-baseline">Baseline — a fresh, standalone run</label>
</div>

<div class="radio-option">
  <input type="radio" id="run-followup" name="run-type" value="followup">
  <label for="run-followup">Follow-up — compared against an earlier run</label>
</div>
```

### CSS

```css
.radio-option {
  display: flex;
  align-items: flex-start;   /* dot aligns to first line, not vertical centre of wrapped text */
  gap: 0.625rem;             /* 10px space between dot and label */
  margin-block: 0.5rem;
}

.radio-option input[type="radio"] {
  flex-shrink: 0;            /* dot never squashes when label wraps */
  margin-top: 0.2em;         /* optical nudge so dot lines up with cap height of first line */
  width: 1.125rem;
  height: 1.125rem;
}

.radio-option label {
  line-height: 1.45;
  cursor: pointer;
}
```

**Why `flex-start` not `center`:** with `center`, a two-line label pushes the dot to the middle of both lines, which looks wrong. The dot belongs beside the first line.

**Note:** keep the existing blue selected-state colour, or swap to the app green (`#2f6f4e`) if you want it on-brand. Flag which you want; not changed here.

---

## Fix 2 — Nav Pills Wrapping (MEDIUM)

**Problem:** In the header, "All surveys" and "Sign out" wrap onto two lines inside their pills while "Account" stays on one. The three pills end up uneven in height and rhythm.

**Cause:** Labels allowed to wrap, and pill padding/text size too large for the available width once the logo is placed.

**Decision:** Force each pill to one line on mobile by preventing wrap and trimming text size + horizontal padding.

### CSS

```css
.nav-pill {
  white-space: nowrap;       /* never wrap the label */
}

@media (max-width: 480px) {
  .nav-pill {
    font-size: 0.875rem;     /* down from default to buy horizontal room */
    padding-inline: 0.75rem; /* tighter side padding */
    padding-block: 0.5rem;
  }

  .nav-bar {
    gap: 0.5rem;             /* tighten spacing between pills */
  }
}
```

**Check after applying:** confirm all three pills plus the "Signal" logo fit on one row at 360px width (smallest common phone). If they still overflow, reduce `font-size` to `0.8125rem` or allow the pill row to scroll horizontally with `overflow-x: auto` on `.nav-bar`.

**Replace `.nav-pill` / `.nav-bar` with the actual class names in the codebase.**

---

## Fix 3 — Teams Row Alignment (MEDIUM)

**Problem:** In the Teams card, the team name ("Test Team") wraps to two lines on the left while "Rotate key" and "Delete" stack on the right with no shared alignment. The row looks lopsided.

**Cause:** A flex row with name left / buttons right, but no `align-items` rule and no handling for narrow widths, so the name wraps and the columns drift apart.

**Decision:** On mobile, stack the name above the buttons. Cleaner and predictable on narrow screens.

### Markup (target shape)

```html
<div class="team-row">
  <span class="team-name">Test Team</span>
  <div class="team-actions">
    <button class="btn-secondary">Rotate key</button>
    <button class="btn-danger">Delete</button>
  </div>
</div>
```

### CSS

```css
.team-row {
  display: flex;
  flex-direction: column;    /* name on top, buttons below on mobile */
  gap: 0.75rem;
  align-items: flex-start;
}

.team-name {
  font-weight: 600;
}

.team-actions {
  display: flex;
  flex-wrap: wrap;           /* buttons wrap gracefully if tight */
  gap: 0.5rem;
}

/* Restore side-by-side layout on wider screens */
@media (min-width: 600px) {
  .team-row {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  }
}
```

**Replace class names with the actual ones in the codebase.**

---

## Fix 4 — Radar Card Border (LOW)

**Problem:** The "Radar" card has a green border while the cards above it ("Survey link", etc.) are plain white with a soft shadow. The lone green border reads as a styling bug, not emphasis.

**Decision:** Match the other white cards.

### Fix

Find the rule giving the Radar card its green border and remove it so it inherits the shared card style. If it has a one-off class or inline style:

```css
/* Remove or neutralise the green border on the radar card */
.radar-card {
  border: 1px solid var(--card-border, #e8e2d4);  /* match other cards */
  /* or: border: none; if other cards use shadow only */
}
```

**Confirm in the codebase** whether the standard cards use a subtle border, a shadow, or both, and apply the identical treatment. Goal: the Radar card is visually indistinguishable in framing from the Survey link card.

---

## Build Order

1. **Fix 1 (radio)** — highest impact, clearly broken.
2. **Fix 2 (nav pills)** — affects every screen.
3. **Fix 3 (teams row)** — single screen.
4. **Fix 4 (radar border)** — quick cleanup last.

## Acceptance Checks

- [ ] Radio dot sits beside the first line of every label, including the long "Follow-up" option, at 360px and 390px widths.
- [ ] All three nav pills render on one line each, on one row, down to 360px width.
- [ ] Teams row: name above buttons on mobile, side by side at 600px+.
- [ ] Radar card framing is identical to the Survey link card.
- [ ] No desktop regression: re-check the same screens at 1280px width.

## Notes

- All class names above are placeholders. Map them to the real selectors before editing.
- Keep WCAG AA: ensure focus states remain visible on radios, pills, and buttons after these changes.
- No new dependencies needed. All fixes are plain CSS.
