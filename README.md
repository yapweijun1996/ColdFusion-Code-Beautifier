# ColdFusion Code Beautifier

A browser-side tool for formatting ColdFusion, HTML, JavaScript, CSS, and SQL. The production UI has no build step or required network dependency: it is vanilla HTML/CSS/JS with required and optional libraries vendored in the repository. Open `index.html` and start pasting.

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
- **Language selector** with `Auto` / `CFML / HTML` / `SQL` / `JavaScript` modes; auto-detect routes SQL-looking input to the SQL formatter and recognizes JavaScript with HTML-like text in strings or regex literals. Detection is heuristic; select a language explicitly when in doubt.
- **Safe Mode** disables Deep SQL/CSS/JS, Pro SQL and Semantic Indent, restoring their previous selections when switched off in the same page session. Recognized standalone SQL and JavaScript are returned unchanged; CFML/HTML still receives outer formatting, so review its output.
- **JavaScript safety check** compares the parsed syntax, tokens, and comment positions before accepting formatting. Unparseable or unsafe JavaScript is kept unchanged and reported. Mixed CFML tags use a checked mapping; this is not proof of every server-generated branch.
- **Structure-based JavaScript indentation** uses parsed blocks, calls, arrays, objects, computed keys, assignment/arrow continuations and switch cases when supported. Unsupported or mixed-language constructs retain the compatibility formatter and still receive the safety check.
- **Auto-copy / auto-clear input / auto-clear output** independent toggles. Auto-copy defaults on; both auto-clear options default off so source and result remain visible until explicitly cleared.
- **Force-split `<tag><tag>`** option for dense HTML.
- **Fullscreen layout** with side-by-side input / output on desktop, stacked on mobile.
- **Pro SQL** (opt-in) — vendored [sql-formatter](https://github.com/sql-formatter-org/sql-formatter) (MIT) for 16 dialects: MySQL, MariaDB, PostgreSQL, SQLite, T-SQL, PL/SQL, DB2, Redshift, Snowflake, BigQuery, Hive, Spark, Trino, N1QL, SingleStoreDB, Standard. It is runtime-lazy and falls back to the built-in formatter if loading/parsing fails. The current service worker precaches the UMD bundle for offline readiness, so installed PWA users download that asset even when the option remains off.
- **Normalize Indent** (opt-in) — converts each line's *leading* whitespace from spaces to tabs before formatting (line content is never touched). Auto-detects the file's indent unit (2 / 4 / 8 spaces = 1 tab), or pick the width explicitly from the companion selector. Handles files that mix space-indent and tab-indent lines, including files already run through the beautifier (it recovers the original unit from the tab+space alignment). Checkbox + width persist in `localStorage`.
- **HTML output safety** — the browser and CLI preserve source text and inline HTML whitespace, including preformatted content. Standalone CFML tags can receive new indentation, and adjacent standalone assignments can be split onto separate lines. Either change may affect whitespace emitted by the template; review output where exact whitespace matters. Embedded SQL, CSS and JavaScript still use their selected formatters; ambiguous tag sequences fall back to the original document.
- **Semantic Indent** (opt-in, experimental) — uses tree-sitter CFML/CFScript parsers to indent multi-line nested function-call chains by their real call depth, including flat, zero-indent input. Covers nested calls inside `<cfset>`/`<cfparam>` tags and inside control-structure-free `<cfscript>` blocks. Struct literals and SQL strings stay flat; unbalanced / mid-edit blocks fall back to the line-scanner untouched. Each grammar (~2.6 MB CFML, ~2.1 MB CFScript) lazy-loads when its supported tag appears in the input; tag-like text in comments or strings can also trigger loading. See [docs/LIMITATIONS.md](docs/LIMITATIONS.md#semantic-indent-tree-sitter-opt-in-experimental).
- **PWA** — installable and offline-capable via service worker. HTML uses network-first and assets use stale-while-revalidate. Online HTTP errors remain visible but do not overwrite the cached offline page; offline use requires a previously cached usable page. New releases show an **Update now** prompt with the old/new versions; input and output are saved in tab-local `sessionStorage` and restored after the controlled reload. A failed save postpones the reload; browser confirmation on manual navigation is best-effort. The footer displays the deployed source version. GitHub Pages automatically stamps it from the commit SHA; for another static host, run `node tools/inject-build-version.js` before publishing.

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
formatter scripts and default to a separate `_beutifier.cfm` output file.

Default file output fails rather than overwriting an existing destination. An
explicit `--output` may replace a different file but cannot refer to the input
or a hard-link alias. Use `--stdout` for previews without writing a file.

For `--normalize-indent`, omit `--indent-width` to auto-detect the width, or
specify exactly `--indent-width 2`, `4`, or `8`. An explicit width also enables
normalization; invalid values are rejected before writing output.

```bash
node tools/beautify-file.js path/to/source.cfm
# writes path/to/source_beutifier.cfm

# Print formatted code without creating a file
node tools/beautify-file.js - --stdout < path/to/source.cfm

# Select a language or enable the vendored multi-dialect SQL formatter
node tools/beautify-file.js path/to/source.cfm --language cfml --pro-sql --dialect postgresql
```

The CLI never uploads source code. It requires only Node.js for the default formatter; `--pro-sql` uses the committed MIT-licensed vendor bundle. File/stdin decoding recognizes UTF-8 (with or without BOM), UTF-16LE BOM, and UTF-16BE BOM, and output preserves the detected encoding/BOM plus routed LF/CRLF style. Truncated BOM-marked UTF-16 with an odd byte count is rejected.

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
npm test          # runs formatter, structure, UI, CLI, version, Pages, and Tree-sitter suites
# or individually:
node tests/run-tests.js          # VM-harness formatter suite
node tests/html-whitespace.test.js # rendered HTML text preservation
node tests/sql-token-safety.test.js # CFML token placeholder preservation
node tests/sql-lexical-safety.test.js # SQL numeric, parameter and literal boundaries
node tests/embedded-literal-safety.test.js # embedded SQL and JavaScript values
node tests/mixed-literal-safety.test.js # mixed-language literals and Semantic Indent
node tests/structure-contract.test.js # JS/CFML structural and safety contracts
node tests/js-structure-planner.test.js # syntax-backed indentation planner
node tests/ui.test.js            # static HTML + editor interaction suite
node tests/cli.test.js            # Node CLI end-to-end suite
node tests/version.test.js       # build version stamping
node tests/pages.test.js         # CI privacy and Pages asset staging
node tests/tree-sitter.test.mjs  # standalone tree-sitter Semantic Indent suite
```

`tests/run-tests.js` replays the formatter scripts in a Node VM context with a faked DOM. The structure suite covers nesting, JavaScript/CFML preservation and safe fallback; the remaining suites exercise UI, CLI, version stamping, Pages staging and real Tree-sitter WASM. Pages publishes only the assets listed in `tools/prepare-pages.js`; repository documentation is available on GitHub, not from the Pages artifact. See [docs/TESTING.md](docs/TESTING.md).

## Documentation

- [DESIGN.md](DESIGN.md) / [SPEC.md](SPEC.md) — current refactor design and required compatibility behavior.
- [EPIC.md](EPIC.md) / [ROADMAP.md](ROADMAP.md) / [TASK.md](TASK.md) — scope, phase status, dependencies, blockers, and next work.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — current load order, pipeline, token-protection layers, and state machines.
- [docs/CHANGELOG.md](docs/CHANGELOG.md) — implementation history and unreleased changes.
- [docs/LIMITATIONS.md](docs/LIMITATIONS.md) — known edge cases across CFML / SQL / JS / CSS.
- [docs/TESTING.md](docs/TESTING.md) — running the suite, helpers, and regression policy.
- [docs/SAFETY.md](docs/SAFETY.md) — per-language production risk and Safe Mode guidance.
- [docs/AI-AGENT-USAGE.md](docs/AI-AGENT-USAGE.md) — unified CLI usage for Codex CLI, Gemini CLI, Claude Code, and other Node/npm agents.
- [docs/WEB-MCP-USAGE.md](docs/WEB-MCP-USAGE.md) — browser-based Web MCP workflow using the static GitHub Pages demo; no MCP server required.

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
js/js-structure.js               offline JavaScript syntax/token/comment verification
js/js-structure-planner.js       syntax-backed JavaScript indentation for supported structures
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
vendor/acorn.js                  vendored JavaScript parser (MIT; see vendor/ACORN.md)
vendor/tree-sitter/              vendored tree-sitter runtime + CFML & CFScript grammar WASM (see vendor/tree-sitter/README.md)
tests/run-tests.js               Node VM harness + exact assertions + Pro SQL token equivalence + content/sample invariants
tests/structure-contract.test.js JS/CFML structure, validation and fallback contracts
tests/js-structure-planner.test.js syntax-backed indentation and fallback tests
tests/tree-sitter.test.mjs       standalone Semantic Indent suite (real WASM, outside the VM harness)
tests/cli.test.js                end-to-end Node CLI tests
tests/version.test.js            deployment version-stamping test
tools/beautify-file.js           Node CLI for file/stdin formatting
tools/formatter-script-manifest.js common Node formatter script order
tools/inject-build-version.js    stamps sw.js and index.html with the source commit
tools/source-encoding.js         CLI/diagnostic UTF-8 and BOM-marked UTF-16 decode/encode preservation
tools/spike-tree-sitter.mjs      self-contained tree-sitter CST spike / reference implementation
```

## License

[MIT](LICENSE) © [yapweijun1996](https://github.com/yapweijun1996). Free for personal and commercial use; keep the copyright notice in copies or substantial portions.
