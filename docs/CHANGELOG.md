# Changelog

## v6 series (2026-05-11)

### Feat (Phase 2): CFML normalization layer — tag/attr lowercase, operator uppercase, function camelCase

When Pro SQL is enabled, every cfquery output path runs through a string-aware CFML normalizer that produces consistent CFML style:

- **Tag names lowercased**: `<CFQUERYPARAM>` → `<cfqueryparam>`, `</CFIF>` → `</cfif>`
- **Attribute names lowercased**: `VALUE=` → `value=`, `CFSQLTYPE=` → `cfsqltype=`
- **cfsqltype CF_SQL_* values lowercased**: `CF_SQL_VARCHAR` → `cf_sql_varchar`
- **Multi-space between attrs → single space**: `<cfqueryparam  value=` → `<cfqueryparam value=`
- **CFML operators uppercased in expression tags** (cfif/cfelseif/cfset/cfreturn): `is`/`or`/`and`/`eq`/`neq`/`lt`/`gt`/`lte`/`gte`/`not`/`mod`/`xor`/`eqv`/`imp`/`contains`/`does not contain`/`is not` → `IS`/`OR`/`AND`/...
- **CFML built-in functions camelCased**: `isdefined` → `isDefined`, `arraylen` → `arrayLen`, `structkeyexists` → `structKeyExists`, `findnocase` → `findNoCase`, `dateformat` → `dateFormat`, `preservesinglequotes` → `PreserveSingleQuotes`, etc. (~50 functions in the lookup table; extensible)

Implementation is **string-aware**: a SQL string literal containing literal text like `'<CFIF>'` is NOT normalized — only real CFML tags outside strings/comments get transformed.

New helpers in `js/deep-format.js`:
- `CFML_OPERATORS` array + `CFML_BUILTIN_FUNCS` table
- `protectExpressionStrings` / `restoreProtectedExpressionStrings`
- `uppercaseCFMLOperators`, `camelCaseCFMLFunctions`
- `normalizeCFMLExpression`, `normalizeCFMLAttributes`
- `normalizeCFMLTagInternals` (single-tag transformer)
- `normalizeCFMLTagsInSafeText` (string-aware text walker)
- `maybeNormalizeCFMLTags` (cfquery handler wrapper)

12 new unit tests covering tag/attr/value case, multi-space, operator uppercase, function camelCase, string-aware safety. 73 tests total, green. `sw.js` `CACHE_VERSION` → `v2026-05-11-8`.

Phase 3 (WHERE hoisting + split-format-recombine) to follow.

### Feat (Phase 1): Lite Pro SQL on verbatim path — SQL keyword uppercasing

When Pro SQL is enabled AND a cfquery body falls through to Tier 2 verbatim (typically WHERE-cfif where marker injection can't form valid SQL), deep-format now applies SQL keyword case normalization to the verbatim body — protectCFMLTokens → case-insensitive uppercase of SELECT/FROM/WHERE/AND/OR/JOIN/etc. → restore. Layout completely preserved; only keywords outside CFML tags and SQL string literals are cased.

- New `PRO_SQL_KEYWORDS` array + `uppercaseSQLKeywordsInProtected(text)` helper in `js/deep-format.js`.
- Multi-word keywords (`order by`, `inner join`, etc.) sorted longest-first so they match before shorter prefixes; internal whitespace normalized to single space.
- 1 new e2e test (Pro SQL on, WHERE-cfif → uppercased keywords, layout preserved).
- `sw.js` `CACHE_VERSION` → `v2026-05-11-7`.

This closes the "Pro SQL toggle does nothing visible on WHERE-cfif" UX gap. Phase 2 (CFML tag/attr/operator normalization) and Phase 3 (WHERE hoisting + split-format-recombine) to follow as separate commits.

### Feat: marker injection — full Pro SQL re-format + cfif structure preserved (SELECT-list cfif)

When Pro SQL is enabled and a cfquery body contains structural CFML control-flow tags AND the user has typed hand-crafted indent, deep-format now uses a **marker-injection** strategy:
- Replace each own-line `<cfif>` / `<cfelseif>` / `<cfelse>` / `<cfloop>` / `<cfswitch>` / `<cfcase>` / `<cfdefaultcase>` / corresponding close tags with column-friendly markers (`__cfm_N__,`) that sql-formatter treats as identifiers in a column list.
- Run sql-formatter — produces full Pro SQL output (uppercase keywords, each column on its own line, normalized spacing) with markers cleanly placed at column-list indent.
- Restore markers to their original CFML tags. Body lines between OPEN and CLOSE/SIBLING are indented +1 tab per nesting depth so cfif branches read as nested under cfif.
- Marker round-trip is verified (orphan markers → depth balanced); on any failure, falls through to verbatim path (no regression risk).

User-visible result for SELECT-list cfif:
```cfml
<cfquery>
    SELECT
        creditterm_sales_unique,
        creditterm_sales_desc,
        <cfif x>
            delivmode_sales_unique,
            delivmode_sales_desc,
        </cfif>
        var_25_004
    FROM adm_cnt_main
    WHERE companyfn = <cfqueryparam ...>
</cfquery>
```

WHERE-clause cfif (where markers can't form valid SQL) silently falls through to Tier 2 verbatim — same correct behavior as before.

New helpers in `js/deep-format.js`: `classifyStructuralCFMLTag`, `protectStructuralCFMLAsColumnMarkers`, `restoreStructuralCFMLMarkers`. 8 new unit tests + 1 end-to-end integration test (loads vendored sql-formatter into vm context). 60 tests total, all green. `sw.js` `CACHE_VERSION` → `v2026-05-11-6`. `docs/LIMITATIONS.md` rewritten as four-tier dispatch.

### Fix: preserve user-crafted multi-line subquery indent inside structural cfif

Follow-up to the structural-cfif fix. The previous version trusted `beautifyCFML`'s post-pass body, which line-normalized continuation lines (e.g., multi-line `(SELECT ... FROM ... WHERE ...)` subqueries) to the same depth as the line above them — flattening the user's hand-crafted visual hierarchy.

- New: `deepFormatEmbedded` accepts a 3rd `originalSource` argument; `js/beautifier.js` now passes `rawCode`.
- New helpers in `js/deep-format.js`:
  - `extractAllCfqueryBodies(source)` — collects every cfquery body from the original (pre-beautifyCFML) source via `replaceEmbeddedBlock`'s tag-aware extractor.
  - `bodyHasUserIndent(body)` — true if any non-empty body line has any leading whitespace.
- cfquery handler now branches three ways:
  1. **structural cfif + user indent** → take the original body verbatim, only adjust leading common whitespace.
  2. **structural cfif + flat input** → fall back to `beautifyCFML`'s nested output (auto-derives cfif depth — keeps existing test passing).
  3. **inline cfif or no cfif** → original deep-format path (SQL keyword-casing, list-break, etc.).
- 3 new tests: hand-crafted subquery indent preserved, cfml-comment between cfif siblings stays aligned, plus the existing flat-input test still passes.
- `sw.js` `CACHE_VERSION` → `v2026-05-11-5`.
- `docs/LIMITATIONS.md` rewritten for the three modes.

### Fix: structural CFML control flow inside `<cfquery>` no longer scrambled
- Both `beautifySQL` (tokenizer) and `formatProSQLSync` (AST) treat protected CFML placeholders as plain identifiers and would inline `<cfif>`/`<cfelseif>`/`<cfelse>`/`</cfif>` onto random SQL lines, breaking the conditional layout.
- Added `bodyHasStructuralCFMLControlFlow` in `js/deep-format.js`: detects CFML control-flow tags occupying their own line (line-based regex). When detected in a cfquery body, deep-format **skips the SQL formatter entirely** and returns the body verbatim, trusting `beautifyCFML`'s outer indentation pass which correctly handles CFML conditional nesting.
- Inline cases (e.g., `WHERE x = 1 <cfif y>AND z = 2</cfif>` on one line) are NOT considered structural and continue through deep-format unchanged.
- Same detector also gates direct SQL mode (`Language=SQL` + Pro SQL on) — falls back to built-in `beautifySQL` if structural CFML control flow is pasted as raw SQL.
- Tests: 11 new structural-control-flow detector unit tests + 2 end-to-end router tests covering nested cfif preservation. Total now 51, all green.
- `sw.js` `CACHE_VERSION` bumped to `v2026-05-11-4`.
- `docs/LIMITATIONS.md` rewritten for this case to document the structural vs inline split.

### Pro SQL — opt-in multi-dialect formatter
- Vendored `sql-formatter@15.7.3` (MIT) UMD bundle to `vendor/sql-formatter.min.js` (~312KB). Loaded lazily via dynamic `<script>` injection only when the user ticks "Pro SQL".
- Added `js/pro-sql.js` — `PRO_SQL_DIALECTS` (16 dialects), `ensureProSQL()` (idempotent loader returning a cached Promise), `formatProSQLSync()` (wrapper with sane defaults: keywordCase upper, dataTypeCase upper, useTabs, tabWidth 4).
- `index.html` adds **Pro SQL** checkbox + **dialect** select (Standard, MySQL, MariaDB, PostgreSQL, SQLite, T-SQL, PL/SQL, DB2, Redshift, Snowflake, BigQuery, Hive, Spark, Trino, N1QL, SingleStoreDB).
- `styles.css` uses `:has(#pro_sql:checked)` to reveal the dialect select only when Pro SQL is on.
- `js/beautifier.js` and `js/deep-format.js` route to `formatProSQLSync` when Pro SQL is enabled, falling back to the built-in `beautifySQL` if the bundle fails to load or the dialect parser throws — guarantees zero regression for existing users.
- `sw.js` precaches `./vendor/sql-formatter.min.js` and `./js/pro-sql.js`; `CACHE_VERSION` bumped to `v2026-05-11-2`.
- `tests/run-tests.js` adds 6 Pro SQL smoke tests (dialect count, MySQL select, PostgreSQL order by, unknown-dialect fallback, all 16 dialects accept simple SELECT). All green.

### PWA + iOS safe area + SVG favicon + GitHub Actions
- Added `manifest.webmanifest` (standalone display, theme color `#28a745`, SVG icon).
- Added `sw.js` service worker — network-first for HTML (always latest source), stale-while-revalidate for assets, cache version `v2026-05-11-1`.
- Added `js/pwa.js` — registers SW, auto-updates on `visibilitychange` + hourly, force-reloads page once on `controllerchange` so users never get stuck on stale build.
- Added `favicon.svg` (CF monogram on brand-green tile, scales for any density).
- `index.html`: added `viewport-fit=cover`, `apple-mobile-web-app-*` meta, `theme-color` light/dark, `<link rel="icon" type="image/svg+xml">`, manifest link, SW registration script.
- `styles.css`: full theming via CSS custom properties; `prefers-color-scheme: dark` palette; `prefers-reduced-motion` honored; `env(safe-area-inset-*)` on body + toast container for iOS notch / home-indicator; `--tap: 44px` minimum hit target on buttons & select; mobile textarea font lifted to 16px to suppress iOS zoom; native-themed checkbox via `accent-color`.
- Added `.github/workflows/deploy.yml` — runs `node tests/run-tests.js` then publishes via `actions/deploy-pages@v4`. Requires repo Settings → Pages → Source = "GitHub Actions".

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
