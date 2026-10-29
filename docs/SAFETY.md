# Safety — Crash vs Corruption Risk Per Language

This document is the honest risk evaluation for production use. Read it before you batch-process critical code.

## Two distinct concerns

| Concept | Definition | Current evidence |
|---------|-----------|------------------|
| **Crash** | Throws an exception, hangs, returns empty output | **0 crashes** across the v18 corpus (15 files / 33,716 lines / 2.1 MB / 126 cfqueries — 0 throws, 0 warnings) |
| **Corruption** | Output code is not semantically equivalent to input | Not provable by tests alone. See per-language analysis below. |

The suite includes content-preservation invariants, Pro SQL token-equivalence cases, UI/CLI suites, and a real-WASM Tree-sitter suite. These checks cover selected inputs and do not prove semantic preservation. Even whitespace-only HTML changes can alter rendered output; Pro SQL and deep-JS/CSS transformations also require review.

## Per-language risk

### CFML — lowest risk

| Surface | Risk | Why |
|--------|------|-----|
| `splitAdjacentCFMLTags` (Rules A/B/C/D) | **Guarded** | Inserts line breaks; the final HTML guard restores recognized output text boundaries. |
| Indent tracker | **Guarded** | Rewrites line-leading whitespace; the final HTML guard protects recognized output text. |
| String literal scanner (`"..."` / `'...'`) | **Guarded** | Multiline CFML and JavaScript literals have targeted preservation checks; unsupported combinations still require review. |
| CFML markup comment `<!--- --->` | **Near-zero** | Shared depth-aware scanning keeps nested comments and commented-out tags opaque across split/indent/deep-format paths. |

The tests cover selected tag structures and content-preservation cases; they do not prove all CFML runtime behavior.

### SQL (inside `<cfquery>`) — tiered

| Path | Risk | Notes |
|------|------|-------|
| Tier 2 Verbatim (cfif-bearing cfquery, no Pro SQL) | **Very low** | Body kept word-for-word, only keyword case normalized. |
| Tier 2 Lite uppercase | **Low** | Uppercases tokens in `PRO_SQL_KEYWORDS`. Columns named `from`/`select`/`as`/etc. would also be uppercased — **cosmetic only**, SQL identifiers are case-insensitive in most engines. |
| Pro SQL Phase 3 hoist (cfif outside WHERE) | **Medium** | Uses `__cfm_NN__` markers. Orphan-marker detection falls back to Tier 2 verbatim, never silent corruption. |
| Pro SQL Phase 4 (split-format-recombine per cfif branch) | **Low–Medium** | Each branch goes through sql-formatter independently. Any branch throws → entire query falls back to Tier 2 verbatim. Token-equivalence test suite (13 CI-gated cases) proves no column/literal/CFML-tag is dropped or reordered, and no comment is dropped or duplicated. **Remaining caveat**: comment *position* may shift between cfif branches (content/count preserved by multiset check). |
| Pro SQL Full reformat (no cfif) | **Low** | sql-formatter@15.7.3 (mature third-party library). |

Selected SQL token and literal cases are tested; this does not prove every dialect, server-generated branch or fallback preserves semantics.

### JavaScript (inside `<script>` / `<cfscript>`)

| `deep_js` | Risk | Notes |
|-----------|------|-------|
| **OFF** | **Guarded, not a guarantee** | Deep JS is disabled; the outer formatter still processes the document. Multiline template and continuation values have targeted checks. |
| **ON** (UI/CLI default unless Safe Mode or saved preferences override it) | **Low–Medium** | Home-rolled brace formatter (not vendored js-beautify). Strings, template literals, comments, regex literals, parenthesis groups, and own-line CFML control tags are protected before reformatting. Multi-line template payloads bypass the second deep pass. Risk point: `/foo/` vs `a / b` still uses an operator/value heuristic; adversarial syntax can be misclassified. |

**Recommendation**: For production JS, run an external Prettier/js-beautify pass instead of `deep_js`.

### CSS (inside `<style>`)

| `deep_css` | Risk | Notes |
|------------|------|-------|
| **OFF** | **Unverified** | Deep CSS formatting is disabled; this alone does not establish whole-file preservation. |
| **ON** | **Not fully assessed** | The formatter protects CSS strings, comments and CFML spans, and retains the original style body when those spans cannot be safely preserved. Synthetic Chrome checks cover selected strings and styles, not all CSS or CFML semantics. |

### HTML (inline, non-script/style)

Goes through the same `beautifyCFML` indent tracker.

| Surface | Risk |
|---------|------|
| Tag boundaries | **Low**. Unescaped `<` in HTML body text (e.g. `if a < b` written without entity encoding) may be parsed as a tag start, but the splitter recovers as verbatim copy when the parse fails. |
| Text content | **Guarded in the browser/CLI pipeline**. Source text between recognized HTML/CFML tags is restored except for line-leading indentation before standalone CFML tags and line breaks between adjacent standalone assignments outside `<pre>`; these can change emitted whitespace. Unmatched boundaries fall back to the original document. Previous synthetic Lucee 6.2.2.91 and Chrome checks cover selected conditional and include paths, inline text, `<pre>`, `<textarea>` and CSS whitespace, but do not verify this change or every template/runtime case. |

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

1. **Always review the diff and target behavior.** Whitespace can affect literal values and rendered HTML; a whitespace-only diff is not proof of safety.
2. **Sensitive cfquery with complex cfif?** Turn Pro SQL OFF and validate the generated query and values in the target environment.
3. **Sensitive JS in `<script>`?** Turn Deep JS OFF and review the output; this option alone does not guarantee whole-document preservation.
4. **Batch-processing?** Safe Mode disables Deep SQL/CSS/JS, Pro SQL and Semantic Indent. Recognized standalone SQL and JavaScript are returned unchanged; CFML/HTML still goes through the outer formatter. A pending request is cancelled if a captured formatting or output option changes. Review output before use.
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
- CFML runtime/database behavior across all supported versions and dialects; CLI UTF-8 BOM and BOM-marked UTF-16LE/BE examples have focused coverage.
- `formatJSCode` regex/division heuristic on adversarial input
- CSS string literals containing `{`/`}` characters
- HTML body text containing unescaped `<`/`>`

The token-equivalence suite covers selected Pro SQL Phase 4 examples; comment position may still move across branches and needs application-specific review.

If you hit any of these, file an issue with a minimal repro and it becomes case #27+ per the policy in `docs/CI-TEST-POLICY.md`.
