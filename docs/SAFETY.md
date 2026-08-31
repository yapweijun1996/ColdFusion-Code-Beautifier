# Safety — Crash vs Corruption Risk Per Language

This document is the honest risk evaluation for production use. Read it before you batch-process critical code.

## Two distinct concerns

| Concept | Definition | Current evidence |
|---------|-----------|------------------|
| **Crash** | Throws an exception, hangs, returns empty output | **0 crashes** across the v18 corpus (15 files / 33,716 lines / 2.1 MB / 126 cfqueries — 0 throws, 0 warnings) |
| **Corruption** | Output code is not semantically equivalent to input | Not provable by tests alone. See per-language analysis below. |

The current suite includes 246 exact formatter `assertEqual` call sites, 22 content-preservation invariants, 27 Pro SQL token-equivalence cases, UI/CLI suites, and a real-WASM Tree-sitter suite. These enforce that **CFML auto-split and indent paths are whitespace-only transformations**. Pro SQL and deep-JS/CSS paths are inherently more aggressive and remain the primary realistic corruption surface.

## Per-language risk

### CFML — lowest risk

| Surface | Risk | Why |
|--------|------|-----|
| `splitAdjacentCFMLTags` (Rules A/B/C/D) | **Near-zero** | Only inserts `\n` + leading whitespace. Never deletes, never reorders. |
| Indent tracker | **Near-zero** | Only rewrites line-leading whitespace. |
| String literal scanner (`"..."` / `'...'`) | **Near-zero** | Splitter explicitly enters string-mode; tag-like content inside quoted strings is copied verbatim (case #25 pins this). |
| CFML markup comment `<!--- --->` | **Near-zero** | Shared depth-aware scanning keeps nested comments and commented-out tags opaque across split/indent/deep-format paths. |

**Verdict**: CFML tag structure (open/close pairing, nesting depth, content order) is preserved. The 22 round-trip equivalence tests prove this for every user-reported scenario.

### SQL (inside `<cfquery>`) — tiered

| Path | Risk | Notes |
|------|------|-------|
| Tier 2 Verbatim (cfif-bearing cfquery, no Pro SQL) | **Very low** | Body kept word-for-word, only keyword case normalized. |
| Tier 2 Lite uppercase | **Low** | Uppercases tokens in `PRO_SQL_KEYWORDS`. Columns named `from`/`select`/`as`/etc. would also be uppercased — **cosmetic only**, SQL identifiers are case-insensitive in most engines. |
| Pro SQL Phase 3 hoist (cfif outside WHERE) | **Medium** | Uses `__cfm_NN__` markers. Orphan-marker detection falls back to Tier 2 verbatim, never silent corruption. |
| Pro SQL Phase 4 (split-format-recombine per cfif branch) | **Low–Medium** | Each branch goes through sql-formatter independently. Any branch throws → entire query falls back to Tier 2 verbatim. Token-equivalence test suite (13 CI-gated cases) proves no column/literal/CFML-tag is dropped or reordered, and no comment is dropped or duplicated. **Remaining caveat**: comment *position* may shift between cfif branches (content/count preserved by multiset check). |
| Pro SQL Full reformat (no cfif) | **Low** | sql-formatter@15.7.3 (mature third-party library). |

**Verdict**: SQL token sequences are preserved on every path. Whitespace and case may change. Only Pro SQL Phase 4 has the comment-placement caveat above.

### JavaScript (inside `<script>` / `<cfscript>`)

| `deep_js` | Risk | Notes |
|-----------|------|-------|
| **OFF** | **Zero** | Body copied through verbatim by the splitter (opaque region). |
| **ON** (UI/CLI default unless Safe Mode or saved preferences override it) | **Low–Medium** | Home-rolled brace formatter (not vendored js-beautify). Strings, template literals, comments, regex literals, parenthesis groups, and own-line CFML control tags are protected before reformatting. Multi-line template payloads bypass the second deep pass. Risk point: `/foo/` vs `a / b` still uses an operator/value heuristic; adversarial syntax can be misclassified. |

**Recommendation**: For production JS, run an external Prettier/js-beautify pass instead of `deep_js`.

### CSS (inside `<style>`)

| `deep_css` | Risk | Notes |
|------------|------|-------|
| **OFF** | **Zero** | Opaque copy-through. |
| **ON** | **Very low** | `formatCSSCode` is 60 lines of brace tracking + indent. Never deletes content. **Risk point**: CSS string literals containing literal `{`/`}` (extremely rare) could mis-count brace depth → wrong indent. Content unchanged either way. |

### HTML (inline, non-script/style)

Goes through the same `beautifyCFML` indent tracker.

| Surface | Risk |
|---------|------|
| Tag boundaries | **Low**. Unescaped `<` in HTML body text (e.g. `if a < b` written without entity encoding) may be parsed as a tag start, but the splitter recovers as verbatim copy when the parse fails. |
| Text content | **Near-zero**. Only leading whitespace is rewritten. |

## Empirical corpus baseline (v18)

```
files:    15           threw:    0
lines:    33,716       warnings: 0
bytes:    2,093,006    cfquery:  126
elapsed:  2.4 s

Verdict distribution:
  FULL_REFORMAT             96  (76.2%)
  PRESERVED_AS_FORMATTED    11  ( 8.7%)
  PHASE3_HOIST_OR_MARKER     8  ( 6.3%)
  WHITESPACE_ONLY            7  ( 5.6%)
  TIER2_VERBATIM_LITE/NOCASE 3  ( 2.4%)
  NO_PRO_SQL_BUT_CHANGED     1  ( 0.8%)
```

Re-run any time with:
```bash
node tools/diagnose-corpus.js
```

## Safe-use checklist

1. **Always diff before you trust.** `git add` your input, beautify, `git diff` the output — confirm only whitespace changes (and SQL keyword case if Pro SQL is on).
2. **Sensitive cfquery with complex cfif?** Turn Pro SQL OFF. Lite path is whitespace-only + keyword-case-only.
3. **Sensitive JS in `<script>`?** Turn Deep JS OFF and post-process with Prettier.
4. **Batch-processing?** Use the **Safe Mode** toggle in the UI — it disables all deep-format and Pro SQL paths in one click, leaving only the proven whitespace-only CFML pipeline.
5. **CI/CD integration?** Have your pipeline run `git diff --stat` after beautification and gate on a sanity threshold; never blindly commit beautifier output.

## What's tested vs what's not

**Tested and CI-gated** (246 exact formatter `assertEqual` call sites + 22 content-preservation invariants + 27 Pro SQL token-equivalence cases + 26 documented user-case scenarios, plus UI/CLI/Tree-sitter suites):
- CFML tag structure preservation
- String literal content preservation (single / double / SQL `''` doubled-quote)
- Markup comment preservation
- `<script>` / `<style>` / `<cfquery>` / `<cfscript>` body preservation in opaque mode
- Pro SQL marker injection / orphan detection / fallback chain
- **Pro SQL token-equivalence**: input and output cfquery bodies are tokenized; non-keyword identifiers, string/numeric literals, CFML tags/expressions, and punctuation must appear in the **same sequence**. SQL keywords are exempt (Phase 3 hoist legitimately merges duplicated `WHERE`/`AND` prefixes). SQL comments (`/* */`, `--`, `<!--- --->`) compared as **multisets** — Phase 4 may shift them between cfif branches, but never drop, duplicate, or invent them.
- All 26 documented user-reported scenarios (see `docs/CI-TEST-POLICY.md`)
- Nested CFML-comment opacity, deep-JS CFML branch depth, bare-JS fragments inside CFML, multi-line template payloads, whitespace-tolerant raw closes, and legacy `<!--` / `//-->` script wrappers

**Not exhaustively tested** (corpus-tested or implementation-only, no formal proof):
- CLI UTF-8 BOM and UTF-16LE encoding round trips (UTF-16BE + CRLF is CI-covered)
- `formatJSCode` regex/division heuristic on adversarial input
- CSS string literals containing `{`/`}` characters
- HTML body text containing unescaped `<`/`>`

The previous entry "Pro SQL Phase 4 + SQL multi-line `/* */` comment placement across cfif branches" was promoted to the CI-gated list above on 2026-05-12 via the token-equivalence test suite. Comment **content** preservation is now formally proven; comment **position** is intentionally allowed to drift (this matches the empirical Phase 4 behavior).

If you hit any of these, file an issue with a minimal repro and it becomes case #27+ per the policy in `docs/CI-TEST-POLICY.md`.
