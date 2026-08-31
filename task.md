# Task Backlog

Generated from [docs/UI-UX-AUDIT-2026-05-11.md](docs/UI-UX-AUDIT-2026-05-11.md). Severity column maps S1 (blocker / a11y) → S4 (engineering hygiene). Effort is rough wall-clock for a single dev. Status reflects the completed SCMC implementation. The machine-readable mirror is [task.jsonl](task.jsonl) (one task per line, IDs match).

Re-verify viewports / measurements against [docs/UI-UX-AUDIT-2026-05-11.md](docs/UI-UX-AUDIT-2026-05-11.md) after browser smoke testing.

| ID | Severity | Area | Title | Effort | Status |
|---|:-:|---|---|:-:|:-:|
| T01 | S1 | a11y | Verify accessible names for `#input` and `#output` (existing labels retained) | 5 min | done |
| T02 | S1 | a11y | Wrap `.container` in `<main>` and `.toolbar` in `<nav aria-label="Actions">` | 10 min | done |
| T03 | S1 | a11y | Add `role="status" aria-live="polite"` to `.simpleToastContainer` | 5 min | done |
| T04 | S1 | a11y | Raise `.toolbar-options label` `min-height` to 44 px for touch | 5 min | done |
| T05 | S1 | a11y | Add visible label for Pro SQL dialect `<select>` | 10 min | done |
| T06 | S2 | responsive | Move mobile breakpoint from 768 to 640 so iPad portrait keeps two-pane layout | 10 min | done |
| T07 | S2 | hygiene | Remove `console.log('window - onload')` from `js/app.js` | 2 min | done |
| T08 | S2 | UX | Show spinner / disabled state on Beautify while optional bundles load | 30 min | done |
| T09 | S2 | UX | Add Cmd/Ctrl-Enter shortcut to trigger Beautify | 15 min | done |
| T10 | S2 | UX | Intercept Tab in editor → insert `\t` (with Shift-Tab outdent) | 20 min | done |
| T11 | S2 | UX | Set auto-clear defaults OFF and protect newer async input | 30 min | done |
| T12 | S3 | visual | Raise dark-mode `--surface` to `#1a212b` for pane contrast | 10 min | done |
| T13 | S3 | visual | Align H1 and toolbar to the same left axis | 10 min | done |
| T14 | S3 | visual | Normalize Pro SQL dialect dropdown to 44 px height | 5 min | done |
| T15 | S3 | visual | Footer link uses brand color with visible underline/focus | 5 min | done |
| T16 | S4 | hygiene | Replace inline `onclick=` with `addEventListener` | 30 min | done |
| T17 | S4 | perf | Move scripts to `<head>` with `defer` in dependency order | 15 min | done |
| T18 | S2 | CI | Use `npm test` as the single PR and deployment quality gate | 10 min | done |
| T19 | S2 | testing | Add offline UI contract and editor interaction tests | 30 min | done |

## Completed batching

- **A11y pass** (T01–T05): semantic landmarks, accessible controls, live toast, and touch targets.
- **UX pass** (T07–T11): clean console, loading state, keyboard editing, safe defaults, and async input protection.
- **Responsive / visual pass** (T06, T12–T15): tablet breakpoint, dark contrast, alignment, control size, and links.
- **CSP / loading pass** (T16–T17): no inline handlers and deferred dependency-ordered scripts.
- **CI / regression pass** (T18–T19): one test command plus offline UI coverage.
