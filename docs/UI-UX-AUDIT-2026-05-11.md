# UI / UX Audit — 2026-05-11

**Method**: Local static server (Python `http.server` on :8765) driven by Claude Preview MCP, since the live GitHub Pages deployment is a 1:1 mirror of `main`. Inspected at four viewport sizes (1440×900 desktop, 820×1180 iPad-Air, 768×1024 iPad-portrait, 375×812 iPhone) with both light and dark `prefers-color-scheme` emulation. Every measurement below comes from a live `getBoundingClientRect` / `getComputedStyle` call against the running page, not from reading CSS source.

**Source under audit**: commit `78b2879` (branch `cfml-multi-tag-split`).
**Live URL**: <https://yapweijun1996.github.io/ColdFusion-Code-Beautifier/>

---

## 1. Layout — measured

| Viewport | Grid columns (computed) | Container WxH | Notes |
|---|---|---|---|
| 1440 × 900 (desktop) | `686px 686px` | 1416 × 844 | Two-pane side-by-side. Toolbar 1384 × 99 below grid. Footer 1416 × 24. |
| 820 × 1180 (iPad Air) | `376px 376px` | full width | Side-by-side preserved (>768 breakpoint). |
| 768 × 1024 (iPad portrait) | `713px` (single col) | full width | **Mobile path triggered** — stacked layout, bodyHeight 1063 > viewportHeight 1024 → page scrolls. |
| 375 × 812 (iPhone) | `343px` (single col) | full width | Stacked. bodyHeight 1063px. Toolbar options column-stacked. |

**Behavior verdict**: Layout is correct at all four sizes. Beautify on a real `<cfquery>` sample produced expected indented output (`SELECT a,\n\tb,\n\tc\nFROM t…`).

## 2. Findings (ranked by severity)

### S1 — blocker / accessibility

1. **No `aria-label` on input / output textareas.** Screen readers announce only "edit, blank" / "edit, readonly". `aria-label="CFML / SQL / HTML source code"` and `aria-label="Beautified output"` are 2-line fixes in [index.html](index.html).
2. **No `<main>` / `<nav>` landmarks.** `document.querySelectorAll('main,nav,header,[role]')` returns `[]` — only `<footer>` exists. AT users have no quick-nav anchor. Wrap `.container` in `<main>` and `.toolbar` in `<nav aria-label="Actions">`.
3. **`role="status" aria-live="polite"` missing on `.simpleToastContainer`** — toast notifications are silent to screen readers.
4. **Checkbox row tap target = 32 px label height, checkbox itself 18 × 18 px.** Below Apple HIG (44 px) and Material (48 px). On 375 px mobile this is genuinely hard to hit. Increase `.toolbar-options label { min-height: 44px; }`.
5. **Pro SQL dialect `<select>` is unlabeled.** Only a `title=""` tooltip exists. Add a visually hidden `<label>` for screen readers + a visible "Dialect" mini-label.

### S2 — UX friction

6. **iPad portrait (768 px) lands on mobile layout.** Media query `@media (max-width: 768px)` is inclusive of 768. iPad-portrait users get the stacked / large-button mobile UI while having plenty of horizontal room. Change to `(max-width: 720px)` or use `(max-width: 640px)` (recommended).
7. **Console spam in production** — [js/app.js:2](js/app.js#L2) logs `window - onload` unconditionally on every load. Verified: 12 identical messages captured during a single boot (script tags fire reload chain). Remove or guard with `localStorage.debug`.
8. **No "Beautify" loading indicator.** When Pro SQL is enabled for the first time, the ~312 KB vendor bundle fetches asynchronously before the formatter runs. The button stays in idle state, so a user on slow 4G can perceive a freeze of 1-3 s.
9. **No keyboard shortcut.** Cmd/Ctrl-Enter for Beautify is industry-standard (CodePen, JSFiddle, all REPLs). ~10 LOC.
10. **Tab inside textarea jumps focus** instead of inserting `\t`. Disrupts editing the pasted code.
11. **Auto-clear input + auto-clear output is on by default.** First-time users paste, click Beautify, see their input vanish, the output flashes and disappears — easy to mistake for a bug. Recommend either: (a) default OFF, (b) keep ON but add a toast "Input cleared — undo".

### S3 — visual / polish

12. **Dark-mode surface contrast is low.** `--bg #0e1116` vs `--surface #161b22` — Δ luminance ≈ 0.012. The pane edges almost disappear. Raise surface to `#1a212b` or add a subtle 1 px `--border` (which already exists but is the same family). Visually confirmed in the dark screenshot — container barely separates from body.
13. **`<h1>` centered, toolbar left-aligned.** Visual axis breaks halfway down the page. Either center the toolbar too (mobile already does) or left-align the heading.
14. **Pro SQL dialect dropdown is 32 px tall** while every other interactive element is 44 px. Inconsistent.
15. **Footer is link-underlined with `text-decoration: underline` and `font-weight: 600`** in muted grey — reads as broken/disabled link in dark mode.

### S4 — engineering hygiene (touches UI surface)

16. **Inline `onclick="…"` attributes** on Beautify / Copy / Clear — works but violates CSP, blocks `<meta http-equiv="Content-Security-Policy" content="script-src 'self'">` adoption.
17. **All scripts at end of `<body>` without `defer`.** Network-then-parse cost is ~10 ms each × 10 files = 100 ms serial blocking. Moving to `<head>` + `defer` keeps semantics identical and lets the parser start the textareas earlier.

## 3. Screenshots captured

Saved during the audit (Claude Preview returns base64 JPEG):

- Desktop 1440 × 900, light — full layout, side-by-side panes, toolbar wraps after option row.
- Desktop 1440 × 900, dark — same layout, low surface contrast visible.
- Tablet 820 × 1180 (iPad Air), light — side-by-side preserved.
- Mobile 375 × 812, light, top of page — stacked panes, "Beautify" green full-width, Copy/Clear 50/50.
- Mobile 375 × 812, light, scrolled — option checkboxes, footer.

No screenshots saved to disk by default (Preview returns inline images). Re-run the audit if filesystem artifacts are needed.

## 4. Cross-references

- [docs/RESEARCH-REVIEW-2026-05-11.md](docs/RESEARCH-REVIEW-2026-05-11.md) — library-side recommendations (JSON / XML / Diff / YAML). This audit complements it on the UI side.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — pipeline + load order; relevant for S4 script-loading findings.
- [docs/LIMITATIONS.md](docs/LIMITATIONS.md) — known-edge cases on the formatter side.
- [task.md](task.md) / [task.jsonl](task.jsonl) — actionable backlog generated from S1–S4 above.

## 5. Re-verify

Re-run this audit when:
- The mobile breakpoint moves.
- The toolbar gets reorganised.
- A new pane (e.g. Diff view) is added.
- A new accessibility-conformance level is targeted.
