# Task Backlog

Generated from [docs/UI-UX-AUDIT-2026-05-11.md](docs/UI-UX-AUDIT-2026-05-11.md). Severity column maps S1 (blocker / a11y) → S4 (engineering hygiene). Effort is rough wall-clock for a single dev. Status starts `todo`; flip to `doing` / `done` as work lands. The machine-readable mirror is [task.jsonl](task.jsonl) (one task per line, IDs match).

Re-verify viewports / measurements against `docs/UI-UX-AUDIT-2026-05-11.md` when re-prioritising.

| ID | Severity | Area | Title | Effort | Status |
|---|:-:|---|---|:-:|:-:|
| T01 | S1 | a11y | Add `aria-label` to `#input` and `#output` textareas | 5 min | todo |
| T02 | S1 | a11y | Wrap `.container` in `<main>` and `.toolbar` in `<nav aria-label="Actions">` | 10 min | todo |
| T03 | S1 | a11y | Add `role="status" aria-live="polite"` to `.simpleToastContainer` | 5 min | todo |
| T04 | S1 | a11y | Raise `.toolbar-options label` `min-height` to 44 px for touch | 5 min | todo |
| T05 | S1 | a11y | Add visible + hidden label for Pro SQL dialect `<select>` | 10 min | todo |
| T06 | S2 | responsive | Move mobile breakpoint from 768 to 640 (or 720) so iPad portrait keeps two-pane layout | 10 min | todo |
| T07 | S2 | hygiene | Remove or gate `console.log('window - onload')` in [js/app.js:2](js/app.js#L2) | 2 min | todo |
| T08 | S2 | UX | Show spinner / disabled state on Beautify while Pro SQL bundle loads | 30 min | todo |
| T09 | S2 | UX | Add Cmd/Ctrl-Enter shortcut to trigger Beautify | 15 min | todo |
| T10 | S2 | UX | Intercept Tab in textareas → insert `\t` (with Shift-Tab outdent) | 20 min | todo |
| T11 | S2 | UX | Re-think auto-clear defaults (default OFF, or show "input cleared — undo" toast) | 30 min | todo |
| T12 | S3 | visual | Raise dark-mode `--surface` to `#1a212b` (or bump border opacity) for pane contrast | 10 min | todo |
| T13 | S3 | visual | Decide H1 alignment vs toolbar alignment — pick one axis | 10 min | todo |
| T14 | S3 | visual | Normalize Pro SQL dialect dropdown to 44 px height | 5 min | todo |
| T15 | S3 | visual | Footer link styling: remove underline or change to brand colour | 5 min | todo |
| T16 | S4 | hygiene | Replace inline `onclick=` with `addEventListener` (enables CSP) | 30 min | todo |
| T17 | S4 | perf | Move `<script>` tags to `<head>` with `defer` for earlier first paint | 15 min | todo |

## Suggested batching

- **PR 1 — a11y pass** (T01–T05): single small PR, zero behaviour change, instant lift for screen-reader users.
- **PR 2 — UX quick wins** (T07, T09, T10, T13–T15): hygiene + visual polish, all sub-30-min items.
- **PR 3 — responsive + dark mode** (T06, T12): one media-query tweak, one variable; before/after screenshots in PR body.
- **PR 4 — beautify-state UX** (T08, T11): user-facing behaviour change, deserves its own PR for discussion.
- **PR 5 — CSP + script-loading hardening** (T16, T17): foundation for future security headers.
