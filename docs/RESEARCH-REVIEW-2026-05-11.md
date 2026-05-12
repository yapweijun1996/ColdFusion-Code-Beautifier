# Research Review — Open-Source JS Library Candidates for Beautifier Expansion

**Date verified**: 2026-05-11
**Scope**: Browser-only, vendored, no-build-step JS libraries that could expand `ColdFusion-Code-Beautifier` beyond its current CFML / SQL core.
**Method**: Live fetch of npm registry + GitHub `pushed_at` + jsdelivr `dist/` tree + first 200 bytes of each `.min.js` to confirm UMD wrapper signature. Two parallel subagents covered 16 candidates; cross-validated by direct WebFetch on 4 highest-stakes claims.
**Status**: Decision-grade source-of-truth. Re-verify in 2027-05 (npm registry + freshness rule will change).

---

## 1. Verdict summary

| Library | Version | License | Min size | UMD? | Verdict |
|---|---|---|---|:-:|:-:|
| `sql-formatter` (already vendored) | 15.7.3 | MIT | 312KB | ✅ `window.sqlFormatter` | **shipped** (commit `47be9c3`) |
| `json5` | 2.2.3 | MIT | ~20KB | ✅ `window.JSON5` | ✅ **PASS** |
| `jsonc-parser` | 3.3.1 | MIT | ~11KB | ⚠️ UMD lacks global, needs 3-line shim | ✅ PASS |
| `xml-formatter` | 3.7.0 | MIT | ~17KB | ✅ `window.xmlFormatter` | ✅ PASS |
| `js-yaml` | 4.1.1 | MIT | ~39KB | ✅ `window.jsyaml` | ✅ PASS (comments lost on round-trip) |
| `js-beautify` (CSS module) | 1.15.4 | MIT | ~53KB css-only | ✅ `window.beautifier` | ✅ PASS |
| `diff` (jsdiff) | 9.0.0 | BSD-3 | ~36KB | ✅ `window.Diff` | ✅ PASS |
| `diff2html` (core only) | 3.4.56 | MIT | ~76KB | ✅ `window.Diff2Html` | ✅ PASS |
| `diff2html-ui` (full) | 3.4.56 | MIT | ~1MB | — | ❌ FAIL (>500KB cap) |
| `vkbeautify` | 0.99.3 | MIT/GPL dual | ~10KB | ❌ CJS only | ❌ FAIL (2018 stale) |
| `graphql-js` | 16.14.0 | MIT | ~150KB tree | ❌ no single-file UMD | ❌ FAIL (multi-file ESM tree) |
| `@0no-co/graphql.web` | 1.0.2 | MIT | 153KB unpacked | ❌ ESM only | ❌ FAIL (last release 2023-06-05) |
| `eemeli/yaml` | 2.8.4 | ISC | ESM tree | ❌ no single-file | ❌ FAIL (needs build step) |
| `sass-formatter` | 0.8.0 | MIT | ESM tree | ❌ | ❌ FAIL |
| `cssbeautify` | 0.3.1 | MIT | ~5KB | ✅ | ❌ FAIL (2013 stale, 13 years) |
| `diff-match-patch` (Google) | 1.0.5 | Apache-2.0 | ~76KB | ❌ CJS only | ❌ FAIL (upstream archived 2024-08-05) |
| `highlight.js` | 11.11.1 | BSD-3 | ~124KB | ✅ `window.hljs` | ⚠️ FAIL strict / PASS lenient (~16.5 mo since release) |
| `prism` | 1.30.0 | MIT | ~10KB core | ✅ `window.Prism` | ⚠️ FAIL strict / PASS lenient (~14 mo since release) |
| Markdown source pretty-printer | — | — | — | — | ❌ NONE viable browser-side |

---

## 2. Per-category findings

### P0 — JSON / JSON5 / JSONC

**Use both libraries together** (different strengths):

- **`json5`** is the parser side — accepts trailing commas, comments, single quotes, hex numbers, `Infinity`/`NaN`. Drop-in `JSON.parse`/`stringify` API shape. UMD ready (`window.JSON5`). **Caveat**: `JSON5.stringify` does NOT preserve comments through round-trip.
- **`jsonc-parser`** (Microsoft, used by VS Code) is the format side — provides `format(text, range, options)` that returns AST edits, applied via `applyEdits` to preserve comments. **Caveat**: UMD wrapper omits `window.X` global-attach branch (Microsoft assumes ESM/AMD), so vendoring needs a 3-line shim or use ESM.

Combined cost: ~31KB minified. Highest ROI of any P0 expansion since CFML projects routinely paste JSON config / API responses.

### P1 — XML / SVG

**`xml-formatter@3.7.0` is the only viable option.**

Preserves CDATA, processing instructions, DOCTYPE, comments, `xml:space="preserve"`. Configurable indent / line separator / whitespace collapsing. ~17KB unminified. SOAP / WSDL / Maven `pom.xml` / SVG all format correctly.

`fast-xml-parser` is the second-best candidate but does XML→JSON→XML round-trip which risks attribute-ordering and mixed-content drift. Use only if `xml-formatter` proves insufficient.

`vkbeautify` (frequently recommended in stale articles) is **disqualified** — last commit 2018, CommonJS-only no UMD global, dual MIT/GPL license needs explicit MIT election.

### P1 — GraphQL

**No viable option in 2026.**

- `graphql-js` ships as ESM tree (~150KB across many files), no single-file UMD.
- `@0no-co/graphql.web` despite being described as "minimal", is **3 years stale** (v1.0.2 published 2023-06-05) and ESM-only.
- `graphql-formatter` (npm) hosted on private git server (unauditable), 2018 stale.

**Recommendation**: skip the category. Re-evaluate when `@wasm-fmt/graphql_fmt` (WASM single-file + small JS loader) matures, or when `graphql-js` ships an official UMD bundle.

### P2 — YAML

**`js-yaml@4.1.1`** is the only viable choice.

UMD ready (`window.jsyaml`), ~39KB minified. Reads/writes YAML 1.2 + multi-doc via `loadAll`. **Caveat**: comments and anchor positions NOT preserved through `load`/`dump` cycle.

`eemeli/yaml@2.8.4` would preserve comments (the only library that does) but ships ESM-only as 40+ files — incompatible with no-build-step constraint.

### P2 — Markdown

**No viable browser-side option.**

The only credible source-pretty-printer (`remark-stringify`) requires the full `unified` ecosystem chain (3+ ESM packages, deep relative-import trees). Prettier handles MD well but is a multi-MB build-step package. Skip the category.

### P2 — LESS / SCSS / Stylus

**`js-beautify@1.15.4`** (CSS module only) — ~53KB. Handles SCSS/LESS comments and nested rules without breaking, but doesn't deeply understand SCSS semantics (`@use` / `@forward` / `@mixin` calls treated as plain rules). UMD `window.beautifier`.

Stylus: no viable browser-side option. `sass-formatter` exists but ships ESM-only.

This is an **upgrade path** for the existing `formatCSSCode` in `js/deep-format.js`, not a net-new capability. Lower priority than P0/P1 expansions.

### P3 — Diff visualization

**Pair `jsdiff@9.0.0` (BSD-3, ~36KB) + `diff2html@3.4.56` core (MIT, ~76KB).**

- `jsdiff` produces patch arrays (Myers algorithm).
- `diff2html` renders patches into GitHub-style HTML (line-by-line or side-by-side).
- **Critical**: use `bundles/js/diff2html.min.js` (76KB core), NOT `diff2html-ui.min.js` (~1MB, exceeds size cap because it bundles all of highlight.js).

Combined ~112KB. Pure UX win — show before/after diff after Beautify so users see exactly what changed.

`diff-match-patch` (Google) is **disqualified** — upstream repo archived 2024-08-05, npm fork stale since 2020.

### P3 — Syntax highlighter

**Borderline / decision needed.**

| Library | Last release | Strict 12-mo rule | Lenient (24-mo) |
|---|---|:-:|:-:|
| `highlight.js@11.11.1` | 2024-12-25 (~16.5 mo) | ❌ FAIL | ✅ PASS |
| `prism@1.30.0` | 2025-03-10 (~14 mo) | ❌ FAIL | ✅ PASS |

Both are de-facto industry standard. Prism v2 is in development; v1 PRs are frozen for security-only fixes.

**Practical reality**: the textarea-based UI cannot show syntax highlighting without rewriting to `contenteditable` or a real editor (CodeMirror/Monaco — explicitly out of scope). So adding a highlighter requires a UI overhaul that exceeds the value. **Recommendation**: skip the category.

---

## 3. Recommended integration order

Three phases, in highest-ROI order. Each phase is independent and can ship incrementally.

### Phase 1 — Fill the JSON / XML gap (≈48KB total)

| Step | Library | Cost | Reason |
|:-:|---|:-:|---|
| 1 | `json5` | ~20KB | CFML projects constantly paste JSON config / API response |
| 2 | `jsonc-parser` | ~11KB | Comment-preserving JSONC format, complements json5 |
| 3 | `xml-formatter` | ~17KB | SOAP/WSDL/cf-config, currently malformed via HTML path |

**UI changes**: Language dropdown gains `JSON`, `JSON5/JSONC`, `XML` options. Can also be wired into deep-format if any embedded use case appears (low priority).

**Architecture cost**: 0 — each is a Language-router branch parallel to existing `sql` branch.

### Phase 2 — UX upgrade with diff visualization (≈112KB total)

| Step | Library | Cost | Reason |
|:-:|---|:-:|---|
| 4 | `jsdiff` | ~36KB | Patch generator |
| 5 | `diff2html` core | ~76KB | HTML renderer |

**UI changes**: optional "Show diff" toggle that adds a third pane between Input and Output showing colored before/after.

**Architecture cost**: medium — needs new pane rendering logic + CSS for diff coloring.

### Phase 3 — DevOps tooling (~39KB)

| Step | Library | Cost | Reason |
|:-:|---|:-:|---|
| 6 | `js-yaml` | ~39KB | YAML for K8s / GH Actions / Docker Compose |

**UI changes**: Language dropdown gains `YAML`.

### Optional — CSS engine upgrade (~53KB)

| Step | Library | Cost | Reason |
|:-:|---|:-:|---|
| 7 | `js-beautify` (CSS only) | ~53KB | Replace existing `formatCSSCode` simple-indent with proper CSS engine |

**Trade-off**: not net-new capability, just better quality. Defer until users complain about current CSS output.

### Skip permanently

- **GraphQL** — no viable single-file vendored option in 2026
- **Markdown** — same
- **Stylus / SCSS-deep** — same
- **Syntax highlighter** — requires UI overhaul (textarea → contenteditable) that exceeds value

---

## 4. Total bundle size projection

| Configuration | Total PWA precache (min) |
|---|---:|
| Current (already shipped) | ~372KB |
| + Phase 1 (json5 + jsonc-parser + xml-formatter) | **~420KB** (+48KB) |
| + Phase 2 (jsdiff + diff2html-core) | ~532KB (+112KB) |
| + Phase 3 (js-yaml) | ~571KB (+39KB) |
| + Optional CSS (js-beautify) | ~624KB (+53KB) |

**Lazy-load strategy** (recommended): keep Phase 1 in immediate precache (~48KB is cheap, JSON/XML are high-frequency), but make Phase 2 / 3 / Optional **lazy-loaded with localStorage opt-in restore + pre-warm** (the same pattern shipped for Pro SQL — see `js/app.js` `persistProSqlPrefs` + `js/pro-sql.js`).

Under lazy-load strategy: **first-load PWA precache stays ~420KB even with all 7 libraries integrated**. Each library adds bytes only when its toggle is checked.

---

## 5. Open decisions still needed

These should be resolved in writing (e.g., in `docs/ARCHITECTURE.md` or this file as it evolves) before starting Phase 2:

1. **Is the `no build step` constraint negotiable?** If yes, `eemeli/yaml` (preserves comments) and `@0no-co/graphql.web` (lightweight GraphQL) become viable via a one-time `esbuild` bundle into `vendor/`. If strict no-build-step, they stay disqualified.
2. **JSON5 + jsonc-parser dual integration**: confirm "use json5 for liberal parsing, jsonc-parser for comment-preserving format" pattern is acceptable. Alternative is jsonc-parser only (loses JSON5 syntax flexibility).
3. **`protectCFMLTokens` upgrade scope**: current implementation is SQL-specific. Adding JSON / XML / GraphQL / YAML deep-format would need 4 new language-specific token-replacement layers (different escape sequences per language). Decide which languages warrant the investment.
4. **12-month freshness rule**: relax to 24 months would re-qualify Prism (with caveat about v1 frozen). Keep strict and skip syntax highlighting entirely.
5. **Phase ordering**: ship Phase 1 in one PR or three independent PRs? One PR is faster, three is reviewable / revertable.

---

## 6. Cross-AI comparison appendix

Another AI agent independently produced a parallel research report. Cross-checking against live registry data on 2026-05-11 revealed systematic data staleness:

| Library | Other AI's claim | Live registry reality | Error |
|---|---|---|:-:|
| `jsdiff` | v5.2.0 (2024-02) | **v9.0.0** | 4 majors stale |
| `prism` | v1.29.0 (2024-03) | v1.30.0 (2025-03-10) | wrong version |
| `xml-formatter` | v3.6.3, 480 stars, 2024-01 | **v3.7.0, 110 stars, 2026-05-09 commit** | 3 fields wrong |
| `@0no-co/graphql.web` | "v1.0.8, 2024-03, 10KB" — recommended | **v1.0.2, 2023-06-05, 153KB unpacked** | version doesn't exist; 3 years stale |
| `cssbeautify` | "2013, Conditional verdict" | confirmed 2013 (13 yrs) — should be FAIL | violated own freshness rule |
| `jsonc-parser` | "1.1k stars, 2024-04" | 744 stars, 2026-05-04 | both fields wrong |
| `json5` | "11KB minified" | jsdelivr verified 20KB | underestimate |

The other AI also recommended libraries that violated the user's own hard requirements (e.g., recommending tools that require esbuild after stating "no build step"). Pattern matches "training-data-driven response template" rather than fresh fetch.

**Defensive lesson**: never accept library recommendations without independently verifying via live `npm registry` + GitHub `pushed_at` + jsdelivr `dist/` listing. See verification recipe in §7.

**The other AI's genuine contributions** (incorporated above):
- Mentioned `fast-xml-parser` as Top 2 XML candidate (correctly noted its round-trip risk)
- Articulated the "AST formatter rejects raw `<cfif>`" risk more concretely than initial research
- Highlighted `JSON5.stringify` comment-loss as P0-severity for beautifier use case

---

## 7. Verification recipe (re-validate this doc)

To re-verify this entire document in the future (recommended every 12 months):

```bash
# Per library, confirm latest version:
curl -s https://registry.npmjs.org/<pkg> | jq '.["dist-tags"].latest'

# Confirm last activity date:
curl -s https://api.github.com/repos/<owner>/<repo> | jq '.pushed_at'

# List dist/ files to confirm UMD vs ESM:
curl -s https://cdn.jsdelivr.net/npm/<pkg>@<latest>/

# Confirm UMD wrapper signature + global name:
curl -s https://cdn.jsdelivr.net/npm/<pkg>@<latest>/dist/<file>.min.js | head -c 300

# Confirm LICENSE:
curl -s https://raw.githubusercontent.com/<owner>/<repo>/main/LICENSE | head -3
```

When delegating to a research subagent, hard-code these fetches into the prompt — agents skip them by default unless forced. See KB item `9205fcc4` (claude-persistent-memory) for the proven prompt template.

---

## 8. Cross-references

- KB item `3ac45e20` (claude-persistent-memory) — same data in MCP KB form for cross-project reuse.
- KB item `9205fcc4` — research methodology (forced live-fetch in subagent prompts).
- KB item `b324d4b2` — pattern: AST formatters incompatible with host control flow (relevant when integrating any AST-based formatter).
- KB item `fb1072ff` — pattern: localStorage opt-in + lazy bundle pre-warm (use this for Phase 2/3 lazy-loaded libraries).
- `docs/ARCHITECTURE.md` — current Pro SQL precedent for vendored library integration.
- `docs/LIMITATIONS.md` — known limitations including the cfif structural-control-flow case.
- `docs/UI-UX-AUDIT-2026-05-11.md` — UI/UX-side findings (a11y, breakpoint, dark-mode contrast). Complements this library-side research.
- `task.md` / `task.jsonl` — actionable backlog generated from the UI/UX audit.
- Live demo: https://yapweijun1996.github.io/ColdFusion-Code-Beautifier/

---

## 9. Document maintenance

| Field | Value |
|---|---|
| Created | 2026-05-11 |
| Re-verify by | 2027-05-11 (annual) |
| Owner | yapweijun1996 |
| License | MIT (same as project) |

Update this file when:
- A library's version / freshness / size status changes materially
- A new library worth considering enters the ecosystem
- A Phase 1/2/3 step is shipped (mark with commit hash)
- A previously-FAIL library becomes viable (e.g., ships a UMD bundle)

If wholesale stale, **delete this file and run a fresh research pass** — do not patch outdated tables in place.
