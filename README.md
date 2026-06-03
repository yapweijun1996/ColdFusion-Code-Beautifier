# ColdFusion Code Beautifier

A browser-side tool for formatting ColdFusion, HTML, JavaScript, CSS, and SQL. No build step, no dependencies — pure vanilla HTML/CSS/JS. Open `index.html` and start pasting.

**Live demo:** https://yapweijun1996.github.io/ColdFusion-Code-Beautifier/

## Features

- **CFML + HTML** outer tag indentation with inline / block / middle / void tag classification.
- **SQL** formatter (MySQL + PostgreSQL dialects) with:
  - CTE, JOIN, CASE, BETWEEN, window function (`OVER (PARTITION BY …)`), UNION, multi-column SELECT / GROUP BY / ORDER BY list-break.
  - Context-aware keyword uppercasing and unary `-` / `+` detection.
  - String, identifier, and comment preservation through a character-walking tokenizer.
- **Deep format** (all default on) runs the right formatter on embedded blocks:
  - `<cfquery>` body → SQL formatter with CFML token protection (`<cfqueryparam>`, `<cf*>`, `#var#`, `<!--- … --->`).
  - `<script>` body → JS formatter with protected strings, comments, regex literals, template literals (`${…}` nesting), and `(…)` groups.
  - `<style>` body → CSS formatter.
- **Language selector** with `Auto` / `CFML / HTML` / `SQL` / `JavaScript` modes; auto-detect routes SQL-looking input to the SQL formatter and tag-free JS-looking input through `formatBraceCode` (template literals, regex, and parens token-protected).
- **Auto-copy / auto-clear input / auto-clear output** independent toggles (copy-success guards the output clear).
- **Force-split `<tag><tag>`** option for dense HTML.
- **Fullscreen layout** with side-by-side input / output on desktop, stacked on mobile.
- **Pro SQL** (opt-in) — vendored [sql-formatter](https://github.com/sql-formatter-org/sql-formatter) (MIT) for 16 dialects: MySQL, MariaDB, PostgreSQL, SQLite, T-SQL, PL/SQL, DB2, Redshift, Snowflake, BigQuery, Hive, Spark, Trino, N1QL, SingleStoreDB, Standard. Lazy-loaded on first use (zero cost when off), falls back to the built-in formatter if the bundle fails.
- **Normalize Indent** (opt-in) — converts each line's *leading* whitespace from spaces to tabs before formatting (line content is never touched). Auto-detects the file's indent unit (2 / 4 / 8 spaces = 1 tab), or pick the width explicitly from the companion selector. Handles files that mix space-indent and tab-indent lines, including files already run through the beautifier (it recovers the original unit from the tab+space alignment). Checkbox + width persist in `localStorage`.
- **Semantic Indent** (opt-in, experimental) — uses tree-sitter CFML/CFScript parsers to indent **flat, zero-indent** multi-line nested function-call chains by their real call depth — the case the line-scanner cannot fix because there is no original indentation to preserve. Covers nested calls inside `<cfset>`/`<cfparam>` tags and inside control-structure-free `<cfscript>` blocks. Struct literals and SQL strings stay flat; unbalanced / mid-edit blocks fall back to the line-scanner untouched. Each grammar (~2.6 MB CFML, ~2.1 MB CFScript) lazy-loads only when a matching flat block is present. See [docs/LIMITATIONS.md](docs/LIMITATIONS.md#semantic-indent-tree-sitter-opt-in-experimental).
- **PWA** — installable, offline-capable via service worker. HTML uses network-first so users always pick up the latest source code on next page load; assets use stale-while-revalidate.

## Usage

1. Paste code into the left textarea.
2. Pick `Auto`, `CFML / HTML`, or `SQL` from the Language dropdown.
3. Toggle the deep-format checkboxes (SQL / CSS / JS) to pick what gets formatted inside embedded blocks.
4. Click **Beautify**. The right textarea shows the output and is copied to the clipboard if `Auto copy` is on.

## Architecture overview

```
beautifyCodes()  → router reads DOM + dispatches
  ├─ beautifySQL(code)        standalone SQL mode
  └─ beautifyCFML(code)       CFML / HTML outer pass
       │    (Normalize Indent, if on, runs first: leading spaces → tabs)
       ├─ deepFormatEmbedded(result, {sql, css, js})
       │    ├─ <cfquery>  → protectCFMLTokens → formatProSQLSync (Pro SQL, if on) | beautifySQL (built-in) → restore
       │    ├─ <script>   → formatBraceCode  (strings / regex / templates / parens protected)
       │    └─ <style>    → formatCSSCode
       └─ applySemanticIndentPostPass(result, cfmlParser, cfsParser)   (Semantic Indent, if on + grammar loaded)
            └─ re-indent flat multi-line nested call chains in <cfset>/<cfparam>/<cfscript>
```

Full detail in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Testing

```bash
npm test          # runs both suites below
# or individually:
node tests/run-tests.js          # VM-harness suite (SQL / CFML / deep-format / JS)
node tests/tree-sitter.test.mjs  # standalone tree-sitter Semantic Indent suite
```

`tests/run-tests.js` replays every browser script in a Node VM context with a faked DOM, then runs `assertEqual` cases (33+ covering SQL clauses, deep-format routing, token protection, JS hardening) plus 22 content-preservation invariants and the `sample/` idempotency suite. `tests/tree-sitter.test.mjs` runs **outside** the VM harness (it needs real WebAssembly) against the vendored grammars — the VM suite is structurally blind to the tree-sitter path. See [docs/TESTING.md](docs/TESTING.md).

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — load order, pipeline, token-protection layers, SQL/CFML state machines, test harness design.
- [docs/CHANGELOG.md](docs/CHANGELOG.md) — commit-by-commit release notes.
- [docs/LIMITATIONS.md](docs/LIMITATIONS.md) — known edge cases across CFML / SQL / JS / CSS.
- [docs/TESTING.md](docs/TESTING.md) — running the suite, helpers, adding new tests.

## File map

```
index.html                       UI shell (language select, deep-format + Normalize/Semantic Indent + Pro SQL checkboxes, auto copy/clear)
styles.css                       fullscreen grid layout + mobile media query + :has() reveal for dependent selectors
js/cf-tags.js                    CF_TAGS.inline / block / middle + HTML_VOID_TAGS
js/sql-keywords.js               SQL_MAJOR_CLAUSES + SQL_UPPERCASE_KEYWORDS + SQL_FUNCTION_KEYWORDS
js/sql-beautifier.js             tokenizer + formatter (caseLevel, funcDepth, listItemIndent, inBetween, clauseStack)
js/pro-sql.js                    Pro SQL — lazy-loaded vendored sql-formatter, PRO_SQL_DIALECTS, formatProSQLSync
js/js-lexer-utils.js             shared JS lexer helpers (REGEX_CONTEXT_KEYWORDS, regex/string/comment scanning)
js/deep-format.js                deepFormatEmbedded, protectCFMLTokens, protectBraceCodeText, protectBraceCodeParens, formatBraceCode, formatCSSCode
js/cfml-splitter.js              splitAdjacentCFMLTags — break glued <tag><tag> lines (comment/string-safe)
js/tag-utils.js                  get_tag_name / start / end
js/beautifier.js                 beautifyCFML (incl. normalizeLeadingSpacesToTabs) + detectLanguage + beautifyCodes (router)
js/tree-sitter-cfml.js           Semantic Indent — computeCallIndentByLine / computeCfscriptIndent / applySemanticIndentPostPass + dual lazy-loader
js/clipboard.js                  copy_output_data / clear_data
js/toast.js                      notification UI
js/pwa.js                        service worker registration + force-reload-to-latest pipeline
js/app.js                        footer year + Pro SQL / Normalize / Semantic / Safe-Mode preference persistence (localStorage)
vendor/sql-formatter.min.js      Pro SQL vendored bundle (MIT)
vendor/tree-sitter/              vendored tree-sitter runtime + CFML & CFScript grammar WASM (see vendor/tree-sitter/README.md)
tests/run-tests.js               Node VM harness + assertEqual cases + content-preservation + sample idempotency
tests/tree-sitter.test.mjs       standalone Semantic Indent suite (real WASM, outside the VM harness)
tools/spike-tree-sitter.mjs      self-contained tree-sitter CST spike / reference implementation
```

## License

[MIT](LICENSE) © [yapweijun1996](https://github.com/yapweijun1996). Free for personal and commercial use; keep the copyright notice in copies or substantial portions.
