# Changelog

## v6 series (2026-05-11 → 2026-05-12)

### Feat: auto-split now also handles `<script>`/`<style>` mid-line + `</td>` after CFML closes + `<cfscript>` opaque-skip

User feedback on real-world legacy CFML report: the existing auto-split (CFML tags only) didn't catch the very common pattern of `<td>...&nbsp;<script>JS</script><cfif>x</cfif>.</td>` where script and `</td>` should each be on their own line.

Three new split rules added to `splitAdjacentCFMLTags`:

1. **Always-split before `<script>`/`<style>` (and their closers)** when the current output line has any non-whitespace content. No "must follow `>`" requirement — `&nbsp;<script>` correctly splits even though `&nbsp;` ends with `;`.

2. **Split before HTML close-block tags (`</td>`, `</tr>`, `</table>`, `</div>`, `</li>`, `</ul>`, `</ol>`, `</p>`, `</section>`, `</article>`, `</header>`, `</footer>`, `</nav>`, `</main>`, `</aside>`, `</form>`)** ONLY when the current output line already contains a CFML close tag (`</cfif>`, `</cfelse>`, etc.). This is the targeted signal "mixed CFML+HTML content where the HTML close should be visually separated". Preserves inline `<td>x</td>` and `<td>x</td><td>y</td>` patterns (no CFML close → no split).

3. **`<cfscript>...</cfscript>` is now opaque** (like `<script>`, `<style>`, `<cfquery>`). Embedded `<script>`/`<style>` substrings inside JS line comments (`// ...`) inside `<cfscript>` no longer trigger splits.

### Real-world impact

User's `numberToEnglish` pattern now formats correctly:

```cfml
INPUT:
<td...>desc: &nbsp;<script Language="JavaScript">
    document.write(numberToEnglish('#x#'));
</script>
<cfif set_language is 'english'>Only</cfif>.</td>

OUTPUT:
<td...>desc: &nbsp;
    <script Language="JavaScript">
        document.write(numberToEnglish('#x#'));
    </script>
    <cfif set_language is 'english'>Only</cfif>.
</td>
```

JS body indents to script depth +1 naturally because `<td>` opens depth and `<script>` opens deeper.

### Validation

- 109 prior tests + 6 new (script/style/cfscript/HTML-close-block + real-world `numberToEnglish` pattern) = **115 tests, all green**.
- 14-file corpus (1.9 MB, 30,518 lines, 114 cfqueries): zero warnings, zero throws, all Pro SQL verdict counts unchanged.
- 3,729 inline `<td>x</td>` patterns in corpus stay inline (rule (B) only fires when CFML close is in line).

`sw.js` `CACHE_VERSION` → `v2026-05-12-15`.

### Feat (Phase 4): AND-leaves hoisting — Pattern A cfif trees now get full Pro SQL backbone

The dominant real-world pattern in legacy CFML reports: a `<cfquery>` body with a complete `WHERE base AND base AND base` block followed by multiple `<cfif>` tags that each merely append optional `and xxx` / `or xxx` clauses. Phase 3 (WHERE hoisting) couldn't handle this — it requires every leaf to START with `where`. Phase 4 is Phase 3's dual: every leaf STARTS with `and` or `or`.

Real-world impact (validated on 14-file corpus, 1.9 MB, 30,518 lines, 114 cfqueries): **Phase 4 fixed 5 of 8 Tier 2 verbatim cfqueries**, producing properly formatted SELECT/FROM/WHERE/GROUP BY/ORDER BY backbones with the cfif tree preserved as a sub-tree under WHERE, body lines indented +1 with keywords uppercased. The remaining 3 verbatim cfqueries are explicit out-of-scope patterns (Pattern B: cfif inside parens; Pattern D: cfif appends UNION arm).

New helpers in `js/deep-format.js`:
- `splitCfqueryBodyAtCfifTreeMulti` (captures from FIRST cfif to LAST `</cfif>` at depth 0; differs from Phase 3's splitter that stops at FIRST close)
- `detectAllLeavesStartWithAndOr` (precondition checker)
- `formatPhase4PostFragment` (synthesizes `SELECT 1 FROM t WHERE 1=1 + post` for sql-formatter, then slices off the prefix)

Phase 4 dispatch sits between Phase 3 hoist and Tier 2 verbatim. ANY failure → fall back to Tier 2, zero regression possible.

10 progressive e2e tests (T1–T10) pin the dispatch behavior. T1–T8 exercise Phase 4. T9 verifies Phase 3 still fires first. T10 verifies Pattern D (UNION cfif) safely falls back to Tier 2.

### Pre-existing bug fixed: `normalizeCFMLAttributes` truncated unquoted values with internal whitespace

Found while validating Phase 4 on `fr_fg_vari_qty.cfm`. Pattern: `<cfqueryparam value=#TNOdateformat('#fromday#/#frommth#/#fromyear# ')# cfsqltype="cf_sql_date">`. The unquoted attribute value contained a space INSIDE the `#expression#` (between `#fromyear#` and `')#`), and `normalizeCFMLAttributes` walked "until whitespace" — truncating mid-expression and dropping the rest of the tag.

Fix: when scanning unquoted attribute values, track `#...#` interpolation depth, paren depth, and nested quote state. Whitespace inside an expression now correctly stays part of the value. 1 new e2e regression test (T8b) pins this.

### Validation

- 98 prior tests + 11 new (T1–T10 + T8b) = **109 tests, all green**.
- 14-file corpus: zero warnings, zero throws. TIER2_VERBATIM_LITE drops from 7 → 2 (Phase 4 picked up 5 Pattern A targets).
- Phase 4 v2 design doc (`docs/PHASE4-DESIGN.md`) — algorithm matched implementation exactly.

`sw.js` `CACHE_VERSION` → `v2026-05-12-14`.

### Feat: auto-split adjacent CFML tags on the same source line — multi-`<cfset>` + comment-jammed legacy code now formats cleanly

Real-world legacy CFML often has lines like:

```cfml
<cfset layer_pos_top = 858><!---<cfset layer_pos_top = 758>---><cfset layer_pos_top = 849>
<cfset layer_left = "470px"><cfset layer_left = "478px">    <cfset layer_left = "323px">
<cfif x><cfinclude template="foo.cfm"></cfif>
```

The beautifier preserved these as-is — visually noisy and impossible to skim. New `splitAdjacentCFMLTags(code)` runs as the first pass inside `beautifyCFML` and inserts newlines at every tag-to-tag boundary so each CFML tag lives on its own line:

```cfml
<cfset layer_pos_top = 858>
<!---<cfset layer_pos_top = 758>--->
<cfset layer_pos_top = 849>
<cfset layer_left = "470px">
<cfset layer_left = "478px">
<cfset layer_left = "323px">
<cfif x>
    <cfinclude template="foo.cfm">
</cfif>
```

The split is **default-on, no checkbox** — there is no legitimate visual or semantic reason to glue two `<cfset>` tags together on one line.

### Safety rules

Trigger requires BOTH:
1. Next non-whitespace is `<cf...`, `</cf...`, `<!---` or `<!--` (CFML tag, CFML comment, or HTML comment).
2. Last non-whitespace character on the OUTPUT line is `>` (i.e., we're at a tag-to-tag boundary).

Rule (2) is what protects inline patterns from being broken:

```cfml
<cfif x>1<cfelse>0</cfif>          ← stays on one line (between `1` and `<cfelse>` is content, not `>`)
```

### Opaque blocks (parser is fully transparent — no splitting inside)

- CFML markup comments `<!--- ... --->`
- HTML comments `<!-- ... -->`
- `<script>...</script>` (JS strings can contain anything)
- `<style>...</style>` (CSS)
- `<cfquery>...</cfquery>` (SQL body — `<cfqueryparam>` stays inline)
- Single/double-quoted strings (with SQL `''`/`""` doubled-quote escape)

### Excluded tags (legitimately inline)

- `<cfqueryparam>` — designed to live inline inside SQL
- `<cfargument>` — designed to chain inside `<cffunction>` body

### Validation

- All 90 existing tests still pass.
- 8 new e2e tests for the splitter (T1: simple multi-cfset; T2: cfset + comment + cfset; T3: cfif/cfinclude/cfif close; T4: inline cfif preserved; T5: script block opaque; T6: cfquery+cfqueryparam preserved; T7: cfparam+cfinclude; T8: nested cfif fully split).
- 14-file corpus (1.9 MB / 30,518 lines / 114 cfqueries): zero warnings, zero throws, all 11 sal_inv_view185 cfqueries still FULL_REFORMAT, all Pro SQL verdict counts unchanged.
- Performance: 467ms → 1091ms on full corpus (+624ms for splitter pass on 1.9 MB ≈ 3 MB/s — acceptable for offline format).
- Visual inspection of `sal_inv_view185.beautified.cfm` confirms the screenshot's problem lines (`<cfset layer_pos_top = 858>...` and `<cfset layer_left = "470px">...`) are now properly split.

`sw.js` `CACHE_VERSION` → `v2026-05-11-13`. 98 tests total, green.

### Feat: PRO_SQL_KEYWORDS now covers `AS`, `USING`, `CAST`, `OVER`, `INTERSECT`, `EXCEPT`, `WITHIN GROUP`, `NATURAL JOIN`, etc. — Tier 2 Lite uppercase pass is no longer half-applied

When a `<cfquery>` body contains structural CFML control flow (cfif/cfloop), deep-format takes the **Tier 2 verbatim** path: layout is preserved, but SQL keywords still get uppercased via the Lite pass (`uppercaseSQLKeywordsInProtected`). Until now this list was missing several common SQL keywords — most notably `AS`, the column/table aliasing keyword. Real-world cfqueries like

```cfml
<cfquery name="q">
	SELECT scm.uniquenum_uniq as vehicle_unique, scm.tag_others01 as bank_act_yn
	FROM set_cnpj_main as scm
	INNER JOIN set_cnpj_body as scb ON scm.uniquenum_pri = scb.uniquenum_pri
	<cfif x>WHERE ...<cfelse>WHERE ...</cfif>
</cfquery>
```

came out of the beautifier with `as` still lowercase — visually inconsistent with the uppercase `SELECT`/`FROM`/`WHERE` next to it.

Added: `as`, `using`, `cast`, `over`, `intersect`, `except`, `within group`, `natural join`, `natural left join`, `natural right join`. All entries are word-boundary matched (`\bkw\b`) so none of them collide with column names like `cast_id`, `coverage`, or `as_of_date`.

1 new e2e regression test (Tier 2 verbatim path with cfif inside) — fails if any of `as`/`inner join`/`where`/`from`/`select`/`and`/`or` survives lowercase. 90 tests total, green. `sw.js` `CACHE_VERSION` → `v2026-05-11-12`.

### Fix: CFML strings no longer treat `\"` as an escape — Windows-path strings stop swallowing the closing quote

**Root cause of "13 cfqueries in sample/test.cfm — all skipped, no warning":**
`isInsideCommentOrString` and `findClosingTagOutsideText` both treated `\` as a C/JS-style escape character inside `"..."` strings. CFML / HTML strings do **not** use backslash escapes — `\` is a literal character. A real-world line like

```cfml
<cfset p = replace("..\..\..\#mainstorefld#\contentstore\#cookie.cookcfnunique#\","\\", "\\\\", "ALL")>
```

ends its first string with `\"` — the parser swallowed the closing `"` as "escaped", then continued scanning. Parser parity went off-by-one starting at line 478 and stayed off for the remaining **3868 lines** of the file. Every later `<cfquery>` opener was reported "inside a string" by `replaceEmbeddedBlock`, so it was silently skipped — no Pro SQL, no Lite uppercase, no Phase 2 normalization, not even a console.warn (the catch path is never reached because the dispatch never enters).

Diagnosed by walking quote-state across the actual sample file and finding the longest non-normal run started at line 478 and extended to EOF.

Fix: removed the `if (c == '\\') { i++; continue; }` block from both `isInsideCommentOrString` and `findClosingTagOutsideText`. Both already handle the SQL `''` / `""` doubled-quote escape, which is the only escape mechanism used in CFML/HTML/SQL strings.

After the fix the same 4346-line file now formats all 13 cfqueries through full Pro SQL (PostgreSQL dialect) — SELECT/FROM/WHERE on own lines, columns list-broken, `<cfqueryparam>` lowercased + `cfsqltype` values lowercased.

1 new e2e test pinning the Windows-path pattern (`replace("..\\..\\#x#\\", ...)` followed by a cfquery that must still be deep-formatted). 89 tests total, green. `sw.js` `CACHE_VERSION` → `v2026-05-11-11`.

### Fix: SQL doubled-quote escape (`''`) no longer flips isInsideCommentOrString parity for the rest of the file

**Root cause of "cfquery in 4000-line file doesn't get Pro SQL formatted, but same cfquery alone does":**
`isInsideCommentOrString` walks character-by-character to decide whether an embedded cfquery position is inside a SQL string / comment. The check was asymmetric with `findClosingTagOutsideText`: the closing-tag finder correctly skipped `''` SQL-standard escape (doubled quote = literal quote inside string), but the entry-point check did NOT. Result: any earlier `'it''s'` in the file flipped the quote-state parity for everything after — subsequent cfqueries were judged "inside a string" and **completely skipped by `replaceEmbeddedBlock`** → deep-format never saw them → no Pro SQL, no Phase 1/2/3, no fallback warning, just verbatim passthrough.

Fix: extended `isInsideCommentOrString` to skip `''` (and `""`) when inside a string of the same quote type. Now symmetric with `findClosingTagOutsideText`.

Also added a defensive `console.warn` in the `canUsePro=false` else branch (Pro SQL checkbox on, but engine not ready) so users see why fallback occurred instead of silent verbatim.

1 new e2e test: two consecutive cfqueries where the first has SQL doubled-quote escape; without the fix the second wouldn't be formatted. 88 tests total, green. `sw.js` `CACHE_VERSION` → `v2026-05-11-10`.

### Feat (Phase 3): WHERE hoisting + split-format-recombine — full Pro SQL backbone with cfif preserved

When a cfquery body's cfif tree has every leaf branch starting with `where ` keyword, deep-format now hoists the WHERE keyword OUT of the cfif branches and places a single SQL-formatted `WHERE` before the tree. This unlocks full Pro SQL formatting (SELECT/FROM/WHERE keywords each on their own line, columns list-broken) on the OUTER SQL backbone while preserving the cfif structure as a sub-tree under WHERE.

Algorithm:
1. `splitCfqueryBodyAtCfifTree` slices body into `{pre, treeLines, post}` at the outermost structural cfif boundary.
2. `detectAllLeavesStartWithWhere` verifies every non-tag tree line starts with `where ` — precondition for safe hoisting.
3. `stripWhereFromLeaves` strips the `where ` prefix from each leaf.
4. Format `pre + synthesized 'where'` via sql-formatter (produces uppercase `SELECT`/`FROM`/`WHERE` on own lines).
5. `formatStrippedTree` walks the cfif tree with depth tracking; each cfif at WHERE-body depth, each body line at +1 deeper, with keyword uppercase + `=` spacing normalization applied via `protectCFMLTokens` round-trip.
6. Post-cfif `AND` clauses get keyword uppercase + spacing normalization.
7. Assembled output flows through Phase 2 CFML normalization (tag/attr lowercase, operator uppercase, function camelCase).

If hoisting precondition fails (mixed leaves, not all start with where) or sql-formatter throws, falls through cleanly to Tier 1 marker → Tier 2 verbatim — zero regression risk.

New helpers in `js/deep-format.js`:
- `splitCfqueryBodyAtCfifTree`
- `detectAllLeavesStartWithWhere`
- `stripWhereFromLeaves`
- `formatStrippedTree`
- `normalizeSQLEqualsSpacing` (adds ` = ` around standalone `=`, leaves `<=`, `>=`, `!=`, `==` untouched)
- `repeatTab`

Result on the canonical user sample (cfquery with deeply nested cfif chain dispatching different `WHERE uniquenum_pri = ...` per branch + trailing `AND tag_table_usage`):
- SELECT/FROM/WHERE keywords each on own line
- All 4 columns list-broken
- WHERE hoisted out of cfif tree
- 3 levels of cfif/cfelseif/cfelse preserved with body indented +1 per depth
- `=` spaced around all standalone occurrences (`uniquenum_pri = <cfqueryparam ...>`)
- Phase 2 normalization on top: `IS`/`AND`/`OR`/`EQ`/`NEQ`/`isDefined`/etc.

14 new Phase 3 unit tests (split/detect/strip/formatStrippedTree/normEq) + 1 e2e test (WHERE-cfif hoisting on a 3-branch cfif). 87 tests total, green. `sw.js` `CACHE_VERSION` → `v2026-05-11-9`.

Phase 3 completes the 3-phase Pro SQL expansion (Phase 1 = lite verbatim uppercase, Phase 2 = CFML normalization, Phase 3 = WHERE hoisting). Users now get end-to-end Pro SQL formatting on CFML+SQL templates including WHERE-cfif patterns that were previously impossible.

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
