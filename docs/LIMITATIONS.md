# Known Limitations

Real cases where the formatter does not produce ideal output. None of these corrupt code, but the result may need manual touch-up.

## CFML

- **`##` hash escape inside SQL string literals** — a bare `##` is protected as a literal, but a surrounding single-quoted SQL string plus a nearby `#var#` in the same expression can produce slightly off spacing. Tracked as `FEAT-CFML-HASH-ESCAPE` (low priority).
- **Non-standard comment markers** with stray whitespace like `< ! --- … --->` are not recognized; use the standard `<!--- … --->` form.
- **`<cfoutput>` wrapping the whole file** — everything inside gets one extra indent level. This is the correct behavior; callers sometimes expect pages to stay flush-left.
- **Dynamic SQL built with `<cfif>` inside `<cfquery>`** — the tags are protected, but text between them is still real SQL and may format independently, producing awkward wrapping around the `<cfif>` boundaries.

## SQL

- **Stored procedures with `BEGIN … END` blocks** — out of scope; treated as inline text.
- **Multiple chained CTEs** (`WITH a AS (...), b AS (...), c AS (...)`) — work, but the commas between CTEs stay with the closing `)` rather than breaking onto their own line.
- **`CASE` in rare non-list contexts** — formatter assumes CASE appears in a SELECT list or boolean condition. Unusual placements may produce extra blank lines.
- **Semicolon-separated multi-statement SQL** — `SELECT 1; SELECT 2;` is treated as one run; the formatter does not introduce a blank line between statements.

## JavaScript (Deep JS)

- **Nested parens are not reformatted** — `protectBraceCodeParens` protects every `(…)` so `for(;;)` and function arguments stay intact. The tradeoff: `(function(){ body })()` IIFE bodies are kept on the same line inside the paren.
- **Unterminated string literals** stop at the next line break for safety. The broken input is preserved as-is rather than consuming the rest of the file, but the output still reflects the original bug.
- **Object literal formatting** — every `{` triggers a newline. Small inline `{a:1}` becomes multi-line. This is verbose but not incorrect.

## CSS (Deep CSS)

- **`@media` / `@keyframes` with nested rules** — opening `{` triggers a new line and increments indent, but the simple formatter does not separately format each inner rule. Complex animations may need manual tidy-up.

## Token protection, general

- CFML tokens are replaced with placeholders padded by spaces. This means a few input patterns like `<cfif x>AND(y=1)` gain a space after the closing `>` (becomes `<cfif x>AND (y=1)`). The space is cosmetically preferable and CFML-compatible, but it is a change from the original.
