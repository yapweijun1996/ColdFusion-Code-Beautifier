# Known Limitations

Real cases where the formatter does not produce ideal output. None of these corrupt code, but the result may need manual touch-up.

## CFML

- **`##` hash escape inside SQL string literals** — a bare `##` is protected as a literal, but a surrounding single-quoted SQL string plus a nearby `#var#` in the same expression can produce slightly off spacing. Tracked as `FEAT-CFML-HASH-ESCAPE` (low priority).
- **Non-standard comment markers** with stray whitespace like `< ! --- … --->` are not recognized; use the standard `<!--- … --->` form.
- **`<cfoutput>` wrapping the whole file** — everything inside gets one extra indent level. This is the correct behavior; callers sometimes expect pages to stay flush-left.
- **Dynamic SQL built with `<cfif>` inside `<cfquery>` — handled in three modes:**
  - **Structural with hand-crafted indent** (each `<cfif>` on its own line AND user typed any non-zero leading whitespace): deep-format extracts the body from the **original (pre-beautify) source**, strips its common leading whitespace, and re-indents the whole block uniformly to the cfquery's parent depth + 1 tab. Multi-line subquery continuations and inline CFML comments are preserved exactly as the user typed them. Trade-off: SQL keywords are NOT uppercased or list-broken inside conditional branches; the user's intent is law.
  - **Structural with flat (zero-indent) input**: deep-format trusts `beautifyCFML`'s outer-pass output, which auto-derives cfif depth and produces correct nesting. This makes pasting unindented snippets still work.
  - **Inline** (e.g., `WHERE x = 1 <cfif y>AND z = 2</cfif>` on a single line): deep-format runs as before — the inline tag is protected, surrounding SQL is keyword-cased, and the tag is restored in place.
  - Detectors: `bodyHasStructuralCFMLControlFlow` (does the body have own-line cfif?) and `bodyHasUserIndent` (does any non-empty body line start with whitespace?), both in `js/deep-format.js`.
  - The original-source body is recovered via `extractAllCfqueryBodies` in `js/deep-format.js`, which collects all cfquery bodies from the raw input passed as the third argument to `deepFormatEmbedded`.

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

## CSS (Deep CSS)

- **`@media` / `@keyframes` with nested rules** — opening `{` triggers a new line and increments indent, but the simple formatter does not separately format each inner rule. Complex animations may need manual tidy-up.

## Token protection, general

- CFML tokens are replaced with placeholders padded by spaces. This means a few input patterns like `<cfif x>AND(y=1)` gain a space after the closing `>` (becomes `<cfif x>AND (y=1)`). The space is cosmetically preferable and CFML-compatible, but it is a change from the original.
