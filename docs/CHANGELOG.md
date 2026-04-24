# Changelog

## v5 series (2026-04-24)

### `27aabc7` — Deep JS production upgrade
- Promoted Deep JS from beta to default-on.
- `protectBraceCodeText` rewritten: string line-break safety, regex literal detection (context-aware), template literal with `${…}` nesting, preserved line/block comments.
- Added `protectBraceCodeParens` so `for (i = 0; i < n; i++)` and function argument lists keep their semicolons and commas.
- New tests: HTML strings with `;` and apostrophes, for-loop semicolons, template literals, regex literals.

### `8f4dbae` — Split Deep format into SQL / CSS / JS
- Three independent checkboxes replace the single `deep_format` control.
- SQL and CSS default on; JS initially shipped as beta-off, then promoted in `27aabc7`.

### `437eac4` — CFML comment protection + auto-clear-output
- `protectCFMLTokens` now matches `<!--- … --->` and walks string literals first so `'</cfquery>'` inside a SQL string stays literal.
- Multi-line `<!--- … --->` / `/* … */` keep their indent inside `beautifyCFML`.
- `cleanRestoredCFMLTokenSpacing` normalizes `<cf*>AND(` to `<cf*>AND (`.
- Added `auto_clear_output` checkbox; clearing only happens if the copy succeeded.

### `a5f62df` — Split auto-copy-and-clear
- Previous single `auto_copy_n_clear_bcontent` checkbox split into independent `auto_copy` and `auto_clear` checkboxes (both default on).

### `70ed87b` — CASE-internal AND/OR + token merging
- Major-clause matching skipped inside `caseLevel > 0`, so `WHEN x = 'a' AND y > 1 THEN …` stays inline.
- `protectCFMLTokens` pads placeholders with spaces so `<cfif>AND` does not merge into a single tokenizer word.

### `de4f5f5` — SQL edge cases
- Window functions: major clauses stay inline inside `funcDepth > 0`, so `OVER (PARTITION BY … ORDER BY …)` is one line.
- `needsSpaceBefore('(')` rewritten: no space when preceded by an identifier (function call), space when preceded by a SQL keyword, and `needsLeadingSpace` flag on the token for subquery / `INSERT INTO` column-list parens.
- Tokenizer: unary `+` / `-` followed by a digit merges into a signed number when the previous token is an operator, `(`, `,`, `[`, or a boolean/clause keyword.
- `OVER` and `PARTITION` added to `SQL_UPPERCASE_KEYWORDS`.

### `c082ac9` — list-break, BETWEEN...AND, CASE...END
- SELECT / GROUP BY / ORDER BY / VALUES break on top-level commas with persistent `listItemIndent`.
- `funcDepth` counter tracks non-subquery parens so `COUNT(a, b)` / `CAST(x AS INT)` stay inline.
- `BETWEEN … AND …` no longer split; `inBetween` flag consumes the next `AND`.
- `CASE … WHEN … THEN … ELSE … END` formatted as multi-line block via `caseLevel` counter.
- Subquery scope saves/restores `currentClause`, `caseLevel`, `listItemIndent`, `inBetween`.

### `3c30e92` — Deep format pipeline
- `deepFormatEmbedded` scans `<cfquery>` / `<script>` / `<style>` blocks and runs the matching formatter on each body.
- CFML token protection: `<cfqueryparam>`, `<cf*>` tags, and `#var#` replaced with placeholders during SQL formatting.
- `<script src="…">` and non-JS `type="…"` values skipped.
- Embedded content indented one tab deeper than parent tag.

### `ee0cd9e` — SQL scaffolding (MySQL + PostgreSQL)
- `js/sql-keywords.js` + `js/sql-beautifier.js` built around a character-walking tokenizer.
- Language selector dropdown (Auto / CFML / SQL).
- `beautifyCodes` became a router that dispatches to `beautifyCFML` or `beautifySQL`.
- Base SQL features: major-clause newlines, keyword uppercasing, string / identifier / comment protection, operator normalization (`::`, `->`, `->>`, `<=`, `>=`, `!=`, `<>`).

### `cf124be` — UI fullscreen + CFML tag refactor
- Viewport-filling layout with CSS Grid + flex (input on left, output on right).
- CFML tag classification extracted into `js/cf-tags.js` (inline / block / middle + HTML void tags).
- `cfelse` / `cfelseif` middle-tag handling: decrement then re-increment indent so inner content stays aligned.
- Modularized scripts into `js/` directory.
