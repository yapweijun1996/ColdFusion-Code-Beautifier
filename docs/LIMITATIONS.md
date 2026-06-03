# Known Limitations

Real cases where the formatter does not produce ideal output. None of these corrupt code, but the result may need manual touch-up.

## CFML

- **`##` hash escape inside SQL string literals** — a bare `##` is protected as a literal, but a surrounding single-quoted SQL string plus a nearby `#var#` in the same expression can produce slightly off spacing. Tracked as `FEAT-CFML-HASH-ESCAPE` (low priority).
- **Non-standard comment markers** with stray whitespace like `< ! --- … --->` are not recognized; use the standard `<!--- … --->` form.
- **`<cfoutput>` wrapping the whole file** — everything inside gets one extra indent level. This is the correct behavior; callers sometimes expect pages to stay flush-left.
- **HTML tags that open and close across a `<cfoutput>` boundary** — a common dashboard pattern opens structural markup in one `<cfoutput>` (`<cfoutput><div class="app">…<main></cfoutput>`) and closes it in a later one (`<cfoutput></main></div></cfoutput>`). The opener's `<cfoutput>` adds +1 indent that `</cfoutput>` removes before the matching `</main></div>` appear, so those closing tags land one tab shallower than their openers (e.g. `<main>` at T5 but `</main>` at T4). The body in between is internally consistent (no sibling drift) and idempotent; only the cross-boundary close tags are off by the cfoutput depth. Resolving it would require a combined CFML+HTML parser that understands tags spanning `<cfoutput>` blocks, which would also flatten the (correct) deep nesting inside the opener. Tracked as a known edge case; the line-by-line indenter cannot disambiguate it.
- **Dynamic SQL built with `<cfif>` inside `<cfquery>` — four-tier dispatch:**
  - **Tier 1 — Marker injection (Pro SQL on, structural cfif present, user-typed indent)**: own-line CFML control-flow tags (`<cfif>` / `<cfelseif>` / `<cfelse>` / `<cfloop>` / `<cfswitch>` / `<cfcase>` / `<cfdefaultcase>` / their close tags) are replaced with column-friendly markers (`__cfm_N__,`) that sql-formatter happily treats as identifiers in the SELECT list. After formatting, markers are restored to their original tags and body lines between OPEN and CLOSE/SIBLING are indented +1 tab per nesting depth. Achieves **full Pro SQL re-format (uppercase keywords + each column on own line) AND preserves cfif structure AND nests body correctly** — best of all worlds for SELECT-list cfif. Marker round-trip verified before commit; if any marker is orphaned or depth doesn't balance, falls through to Tier 2.
  - **Tier 2 — Verbatim with user indent**: when Tier 1 fails (e.g., cfif inside WHERE clause where markers can't form valid SQL) AND user typed hand-crafted indent, deep-format extracts the body from the **original (pre-beautify) source**, strips common leading whitespace, and re-indents uniformly to parent depth + 1 tab. Multi-line subquery continuations and inline CFML comments preserved exactly. Trade-off: SQL keywords NOT uppercased; user's manual layout is law.
  - **Tier 3 — Flat input fallback**: structural cfif but no user indent → trust `beautifyCFML`'s outer-pass output, which auto-derives cfif depth.
  - **Inline** (e.g., `WHERE x = 1 <cfif y>AND z = 2</cfif>` on a single line): NOT considered structural; deep-format runs as before — surrounding SQL is keyword-cased, the inline tag is protected and restored in place.
  - Helpers in `js/deep-format.js`: `bodyHasStructuralCFMLControlFlow`, `bodyHasUserIndent`, `extractAllCfqueryBodies`, `protectStructuralCFMLAsColumnMarkers`, `restoreStructuralCFMLMarkers`, `classifyStructuralCFMLTag`.

## SQL

- **Stored procedures with `BEGIN … END` blocks** — out of scope; treated as inline text.
- **Multiple chained CTEs** (`WITH a AS (...), b AS (...), c AS (...)`) — work, but the commas between CTEs stay with the closing `)` rather than breaking onto their own line.
- **`CASE` in rare non-list contexts** — formatter assumes CASE appears in a SELECT list or boolean condition. Unusual placements may produce extra blank lines.
- **Semicolon-separated multi-statement SQL** — `SELECT 1; SELECT 2;` is treated as one run; the formatter does not introduce a blank line between statements.

## Pro SQL (vendored sql-formatter)

- **First use is async** — the ~312KB UMD bundle is fetched once, so the first Beautify click after toggling Pro SQL has a small delay. Subsequent calls are instant; offline use works after the service worker has precached the bundle (i.e., after one online visit).
- **`<cfqueryparam>` and other CFML tags inside `<cfquery>`** — protected as opaque tokens before being handed to sql-formatter, then restored. Output spacing around the tokens is normalized but may differ from the built-in formatter's style.
- **Dialect-specific quirks** — sql-formatter parses each dialect strictly. Mixing dialect-specific syntax with the wrong dialect setting (e.g., T-SQL `[brackets]` while dialect is set to `mysql`) may throw a parse error; the wrapper catches it and falls back to the built-in formatter rather than producing a broken result.
- **Bundle size impact on PWA precache** — enabling Pro SQL adds ~312KB to the service worker's precached payload (only after first online use). Disabling it does not evict the cached bundle until the next `CACHE_VERSION` bump.

## JavaScript (Deep JS)

- **Nested parens are not reformatted** — `protectBraceCodeParens` protects every `(…)` so `for(;;)` and function arguments stay intact. The tradeoff: `(function(){ body })()` IIFE bodies are kept on the same line inside the paren.
- **Unterminated string literals** stop at the next line break for safety. The broken input is preserved as-is rather than consuming the rest of the file, but the output still reflects the original bug.
- **Object literal formatting** — every `{` triggers a newline. Small inline `{a:1}` becomes multi-line. This is verbose but not incorrect.

## Bare JS outside `<script>` (CFML files containing pure JS fragments)

CFML files that contain bare JS (no `<script>` wrapper) — e.g. files included
into another `.cfm` page that already provides the `<script>` boundary —
take the `beautifyCFML` per-line indentation path, NOT `formatBraceCode`.
Implications:

- **Per-line brace counter** (`countBracesOutsideStrings` in
  `js/beautifier.js`) string-protects single/double/template quotes, line
  comments, single-line block comments, **and regex literals**. Multi-line
  strings via `\`-continuation are NOT tracked across lines — if a string
  begins on one line and ends on another, `{`/`}`/`[`/`]` on the
  continuation line may be miscounted. Rare in real code; not seen in any
  committed fixture.
- **Object literal layout preserved as compact** when the source already
  has it compact (e.g., `{ skillName: 'x', toolName: 'y', args: {} },` on
  one line). Routing such a file through `'js'` mode would explode each
  `{` onto its own line via `formatBraceCode` — visually verbose. Auto-
  detect leaves CFML files in `'cfml'` mode for this reason; users wanting
  full `formatBraceCode` treatment must select `JavaScript` in the
  dropdown explicitly.
- **Idempotency does not prove correct alignment** — a wrong indent can be
  a fixed point if both passes drift equally. The `sample/` idempotency
  suite catches drift between passes, but a fixture that drifts on pass 1
  and stably reproduces the drift on pass 2 will still PASS. Pair the
  suite with manual visual inspection on first add, or with a brace-
  balance check on output (verified 2026-05-14: regex literal `[\s\S]`
  leak was idempotent but mis-aligned by 3 tabs).

## Semantic Indent (tree-sitter, opt-in, experimental)

Semantic Indent re-indents **flat, zero-indent** multi-line nested function-call
chains by their real call depth — the case the line-scanner cannot fix because
there is no original indentation to preserve. It runs as a post-pass over the
beautifier output, parsing each candidate block with a vendored tree-sitter
grammar. Boundaries:

- **Well-formed input only.** An unbalanced block (mid-edit paste — more `(`
  than `)`) parses with `rootNode.hasError === true` and is left **byte-identical
  to the line-scanner output**. (`isError` is true only when a node *is* an ERROR
  node — the root `program` almost never is — so the guard uses `hasError`, which
  is true when the subtree contains any error. `hasError` is a property/getter in
  this web-tree-sitter build, not a method.) So Semantic Indent only changes
  balanced, parseable blocks.
- **Only `call_expression` nesting drives indent.** Struct/object literals
  (`{ k: v }`), SQL-string arguments, and simple single-line arguments are *not*
  `call_expression` nodes, so they stay flat automatically — the distinction
  plain bracket-counting could never make. A `config = { … }` is processed but
  its keys carry no call, so they land flat at the base.
- **cfscript: control-structure-free blocks only.** The CFML grammar parses a
  `<cfscript>` body as one opaque node, so a separate CFScript grammar is used.
  But a `<cfscript>` block that contains *any* `statement_block` (the `{}` of
  `if` / `for` / `while` / `function` / `component`) is **skipped** and left to
  the normal line-scanner — the REPLACE model that keeps the simple path
  idempotent would otherwise flatten the brace-depth indent. In practice this
  means Semantic Indent re-indents cfscript only in **top-level assignment / call
  chains**; most production cfscript lives inside `component {}` / `function {}`
  and is therefore handled by the normal indenter (which already indents its
  brace structure correctly — a flat nested call *inside* such a block stays
  flat).
- **Per-line factor, not raw CST depth.** Indent is keyed off call-only depth
  (number of `call_expression` ancestors), normalized by the smallest positive
  gap between consecutive per-line depths, so each nesting level is exactly one
  tab regardless of intermediate argument calls (e.g. `Tlt(…)`). cfscript blocks
  factor **per statement** so a deeper sibling statement cannot rescale a
  shallower one.
- **Close-paren lines** align to the level they return to (the opener indent of
  the shallowest call ending on the line). A mixed `),fAy(` line is treated as a
  close (first non-ws char wins) — a documented edge, not optimized for.
- **Lazy-loaded, fail-safe.** Each grammar is fetched only when a matching flat
  block is present; if the fetch or parse fails, the post-pass is skipped and the
  line-scanner output stands. The feature is OFF by default and is a
  whitespace-only transform (content preserved).

## CSS (Deep CSS)

- **`@media` / `@keyframes` with nested rules** — opening `{` triggers a new line and increments indent, but the simple formatter does not separately format each inner rule. Complex animations may need manual tidy-up.

## Token protection, general

- CFML tokens are replaced with placeholders padded by spaces. This means a few input patterns like `<cfif x>AND(y=1)` gain a space after the closing `>` (becomes `<cfif x>AND (y=1)`). The space is cosmetically preferable and CFML-compatible, but it is a change from the original.
