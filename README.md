# ColdFusion Code Beautifier

A browser-side tool for formatting ColdFusion, HTML, JavaScript, CSS, and SQL. The production UI has no build step or required network dependency: it is vanilla HTML/CSS/JS with optional libraries vendored in the repository. Open `index.html` and start pasting.

**Live demo:** https://yapweijun1996.github.io/ColdFusion-Code-Beautifier/

## Features

- **CFML + HTML** outer tag indentation with inline / block / middle / void tag classification. Nested CFML comments are depth-aware: commented-out tags remain opaque to the outer structure, while code-looking multiline CFML comments receive an isolated internal alignment pass.
- **SQL** formatter (MySQL + PostgreSQL dialects) with:
  - CTE, JOIN, CASE, BETWEEN, window function (`OVER (PARTITION BY …)`), UNION, multi-column SELECT / GROUP BY / ORDER BY list-break.
  - Context-aware keyword uppercasing and unary `-` / `+` detection.
  - String, identifier, and comment preservation through a character-walking tokenizer.
- **Deep format** (all default on) runs the right formatter on embedded blocks:
  - `<cfquery>` body → SQL formatter with CFML token protection (`<cfqueryparam>`, `<cf*>`, `#var#`, `<!--- … --->`).
  - `<script>` body → JS formatter with protected strings, comments, regex literals, template literals (`${…}` nesting), and `(…)` groups.
  - `<style>` body → CSS formatter.
- **Language selector** with `Auto` / `CFML / HTML` / `SQL` / `JavaScript` modes; auto-detect routes SQL-looking input to the SQL formatter and tag-free JS-looking input through `formatBraceCode` (template literals, regex, and parens token-protected).
- **Auto-copy / auto-clear input / auto-clear output** independent toggles. Auto-copy defaults on; both auto-clear options default off so source and result remain visible until explicitly cleared.
- **Force-split `<tag><tag>`** option for dense HTML.
- **Fullscreen layout** with side-by-side input / output on desktop, stacked on mobile.
- **Pro SQL** (opt-in) — vendored [sql-formatter](https://github.com/sql-formatter-org/sql-formatter) (MIT) for 16 dialects: MySQL, MariaDB, PostgreSQL, SQLite, T-SQL, PL/SQL, DB2, Redshift, Snowflake, BigQuery, Hive, Spark, Trino, N1QL, SingleStoreDB, Standard. It is runtime-lazy and falls back to the built-in formatter if loading/parsing fails. The current service worker precaches the UMD bundle for offline readiness, so installed PWA users download that asset even when the option remains off.
- **Normalize Indent** (opt-in) — converts each line's *leading* whitespace from spaces to tabs before formatting (line content is never touched). Auto-detects the file's indent unit (2 / 4 / 8 spaces = 1 tab), or pick the width explicitly from the companion selector. Handles files that mix space-indent and tab-indent lines, including files already run through the beautifier (it recovers the original unit from the tab+space alignment). Checkbox + width persist in `localStorage`.
- **Semantic Indent** (opt-in, experimental) — uses tree-sitter CFML/CFScript parsers to indent **flat, zero-indent** multi-line nested function-call chains by their real call depth — the case the line-scanner cannot fix because there is no original indentation to preserve. Covers nested calls inside `<cfset>`/`<cfparam>` tags and inside control-structure-free `<cfscript>` blocks. Struct literals and SQL strings stay flat; unbalanced / mid-edit blocks fall back to the line-scanner untouched. Each grammar (~2.6 MB CFML, ~2.1 MB CFScript) lazy-loads only when a matching flat block is present. See [docs/LIMITATIONS.md](docs/LIMITATIONS.md#semantic-indent-tree-sitter-opt-in-experimental).
- **PWA** — installable and offline-capable via service worker. HTML uses network-first and assets use stale-while-revalidate. New releases show an **Update now** prompt; the current input is saved and restored across the controlled reload. The footer displays the deployed source version. GitHub Pages automatically stamps it from the commit SHA; for another static host, run `node tools/inject-build-version.js` before publishing.

## Usage

1. Paste code into the left textarea.
2. Pick `Auto`, `CFML / HTML`, `SQL`, or `JavaScript` from the Language dropdown.
3. Toggle the deep-format checkboxes (SQL / CSS / JS) to pick what gets formatted inside embedded blocks.
4. Click **Beautify**. The right textarea shows the output and is copied to the clipboard if `Auto copy` is on. `Ctrl+Enter` / `Cmd+Enter` also runs Beautify; `Tab` and `Shift+Tab` indent the selected input lines, and `Escape` then `Tab` moves focus out of the editor.

## Command-line use for AI agents

The repository includes a Node.js CLI for AI coding agents and local automation.
After the package is published, an agent can use the same serverless CLI through
NPM without cloning the repository:

```bash
npx coldfusion-code-beautifier path/to/source.cfm
```

The GitHub clone remains an offline fallback. Both entry points use the same
formatter scripts and default to a separate `_beutifier.cfm` output file:

```bash
node tools/beautify-file.js path/to/source.cfm
# writes path/to/source_beutifier.cfm

# Print formatted code without creating a file
node tools/beautify-file.js - --stdout < path/to/source.cfm

# Select a language or enable the vendored multi-dialect SQL formatter
node tools/beautify-file.js path/to/source.cfm --language cfml --pro-sql --dialect postgresql
```

The CLI never uploads source code. It requires only Node.js for the default formatter; `--pro-sql` uses the committed MIT-licensed vendor bundle. File/stdin decoding recognizes UTF-8 (with or without BOM), UTF-16LE BOM, and UTF-16BE BOM, and output preserves the detected encoding/BOM plus routed LF/CRLF style.

## Architecture overview

```
beautifyCodes()  → DOM router + optional-resource preload + stale-request guard
  ├─ SQL → formatProSQLSync (if enabled/loaded) | beautifySQL
  ├─ JS  → formatJsWithLeadingComments → formatBraceCode
  └─ CFML / HTML
       ├─ Normalize Indent (optional)
       ├─ splitAdjacentCFMLTags
       ├─ beautifyCFML (named tag hierarchy + raw JS/CSS/CFScript state)
       ├─ deepFormatEmbedded(result, {sql, css, js})
       │    ├─ <cfquery> → CFML protection + structural Phase 3/4/fallback routing
       │    ├─ <script>  → protected strings/comments/regex/templates/parens + CFML control tags
       │    └─ <style>   → formatCSSCode
       └─ applySemanticIndentPostPass (optional loaded Tree-sitter grammars)
```

The current implementation also preserves deep-JS CFML branch depth, multi-line template payloads, legacy `<!--` / `//-->` script wrappers, bare JavaScript fragments emitted inside CFML control flow, and routed LF/CRLF output style.

Full detail in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Testing

```bash
npm test          # runs formatter, UI-contract, CLI, and Tree-sitter suites
# or individually:
node tests/run-tests.js          # VM-harness formatter suite
node tests/ui.test.js            # static HTML + editor interaction suite
node tests/cli.test.js            # Node CLI end-to-end suite
node tests/tree-sitter.test.mjs  # standalone tree-sitter Semantic Indent suite
```

`tests/run-tests.js` replays the formatter scripts in a Node VM context with a faked DOM and currently contains 246 exact `assertEqual` call sites, 22 content-preservation invariants, 27 Pro SQL token-equivalence cases, and the optional local `sample/` idempotency suite. `tests/ui.test.js` verifies static/UI lifecycle contracts, `tests/cli.test.js` exercises the production CLI, and `tests/tree-sitter.test.mjs` runs **outside** the VM harness with real vendored WASM. See [docs/TESTING.md](docs/TESTING.md).

## Documentation

- [DESIGN.md](DESIGN.md) / [SPEC.md](SPEC.md) — current refactor design and required compatibility behavior.
- [EPIC.md](EPIC.md) / [ROADMAP.md](ROADMAP.md) / [TASK.md](TASK.md) — scope, phase status, dependencies, blockers, and next work.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — current load order, pipeline, token-protection layers, and state machines.
- [docs/CHANGELOG.md](docs/CHANGELOG.md) — implementation history and unreleased changes.
- [docs/LIMITATIONS.md](docs/LIMITATIONS.md) — known edge cases across CFML / SQL / JS / CSS.
- [docs/TESTING.md](docs/TESTING.md) — running the suite, helpers, and regression policy.
- [docs/SAFETY.md](docs/SAFETY.md) — per-language production risk and Safe Mode guidance.
- [docs/AI-AGENT-USAGE.md](docs/AI-AGENT-USAGE.md) — GitHub-only CLI usage for coding agents.

## File map

```
index.html                       UI shell (language select, deep-format + Normalize/Semantic Indent + Pro SQL checkboxes, auto copy/clear)
styles.css                       fullscreen grid layout + mobile media query + :has() reveal for dependent selectors
js/cfml-comment-utils.js          shared depth-aware nested CFML/HTML markup-comment scanner
js/cf-tags.js                    CF_TAGS.inline / block / middle + HTML_VOID_TAGS
js/sql-keywords.js               SQL_MAJOR_CLAUSES + SQL_UPPERCASE_KEYWORDS + SQL_FUNCTION_KEYWORDS
js/sql-beautifier.js             tokenizer + formatter (caseLevel, funcDepth, listItemIndent, inBetween, clauseStack)
js/pro-sql.js                    Pro SQL — lazy-loaded vendored sql-formatter, PRO_SQL_DIALECTS, formatProSQLSync
js/js-lexer-utils.js             shared JS lexer helpers (REGEX_CONTEXT_KEYWORDS, regex/string/comment scanning)
js/deep-format.js                deepFormatEmbedded, protectCFMLTokens, protectBraceCodeText, protectBraceCodeParens, formatBraceCode, formatCSSCode
js/cfml-splitter.js              splitAdjacentCFMLTags — break glued <tag><tag> lines (comment/string-safe)
js/tag-utils.js                  get_tag_name / start / end
js/beautifier.js                 current combined CFML state machine + language detection + DOM/async router (planned decomposition documented in DESIGN.md)
js/editor-ui.js                  button delegation + shortcuts + Tab indentation + async Beautify state
js/tree-sitter-cfml.js           Semantic Indent — computeCallIndentByLine / computeCfscriptIndent / applySemanticIndentPostPass + dual lazy-loader
js/clipboard.js                  copy_output_data / clear_data
js/toast.js                      notification UI + accessible action toasts
js/pwa.js                        service worker registration + user-controlled Update now flow + draft recovery
js/app.js                        footer year/version + Pro SQL / Normalize / Semantic / Safe-Mode preference persistence (localStorage)
vendor/sql-formatter.min.js      Pro SQL vendored bundle (MIT)
vendor/tree-sitter/              vendored tree-sitter runtime + CFML & CFScript grammar WASM (see vendor/tree-sitter/README.md)
tests/run-tests.js               Node VM harness + exact assertions + Pro SQL token equivalence + content/sample invariants
tests/tree-sitter.test.mjs       standalone Semantic Indent suite (real WASM, outside the VM harness)
tests/cli.test.js                end-to-end Node CLI tests
tests/version.test.js            deployment version-stamping test
tools/beautify-file.js           Node CLI for file/stdin formatting
tools/inject-build-version.js    stamps sw.js and index.html with the source commit
tools/source-encoding.js         CLI/diagnostic UTF-8 and BOM-marked UTF-16 decode/encode preservation
tools/spike-tree-sitter.mjs      self-contained tree-sitter CST spike / reference implementation
```

## License

[MIT](LICENSE) © [yapweijun1996](https://github.com/yapweijun1996). Free for personal and commercial use; keep the copyright notice in copies or substantial portions.
