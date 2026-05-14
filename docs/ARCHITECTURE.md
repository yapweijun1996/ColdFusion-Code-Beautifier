# Architecture

## Overview

Browser-side code beautifier for CFML/HTML/CSS/JS/SQL. No build step, no dependencies. Script tags load in a fixed order, globals hang off `window`, and a Node VM harness re-runs the same browser globals for regression testing.

## Load order

```
js/cf-tags.js          ← CF_TAGS config (inline / block / middle + HTML_VOID_TAGS)
js/sql-keywords.js     ← SQL_MAJOR_CLAUSES, SQL_UPPERCASE_KEYWORDS, SQL_FUNCTION_KEYWORDS
js/sql-beautifier.js   ← beautifySQL + tokenizeSQL + matchSQLMajorClause
js/deep-format.js      ← deepFormatEmbedded + token protection layers
js/tag-utils.js        ← get_tag_name / start / end
js/toast.js            ← notification UI
js/clipboard.js        ← copy_output_data / clear_data
js/beautifier.js       ← beautifyCFML + detectLanguage + beautifyCodes (router)
js/app.js              ← footer year + Pro SQL prefs persistence (localStorage) + bundle pre-warm
js/pro-sql.js          ← lazy-loads vendor/sql-formatter.min.js on first Pro SQL use
js/pwa.js              ← service-worker registration + auto-update reload (deferred)
```

## Pro SQL (optional, opt-in)

Default-on hand-written `sql-beautifier.js` covers the dual MySQL+Postgres
dialect. When users need other dialects (T-SQL, PL/SQL, Snowflake, BigQuery,
Spark, Trino, …) they tick the **Pro SQL** checkbox + pick a dialect.

```
vendor/sql-formatter.min.js  UMD bundle (~312KB), MIT, sql-formatter@15
js/pro-sql.js                PRO_SQL_DIALECTS, ensureProSQL(), formatProSQLSync(), isProSQLLoaded()
beautifier.js (sql branch)   if pro_sql && loaded → formatProSQLSync; else → beautifySQL
deep-format.js (cfquery)     same routing inside <cfquery> body, after CFML token protection
```

The vendor bundle is **lazy-loaded** via dynamic `<script>` injection on the
first Pro-SQL formatting call, then cached by the service worker so offline
use works on subsequent loads. Users who never enable Pro SQL pay zero bytes
for the feature.

## PWA layer

```
manifest.webmanifest   ← name, scope, display=standalone, theme color, SVG icon
sw.js                  ← network-first for HTML, stale-while-revalidate for assets
                         CACHE_VERSION constant — bump on release to evict
                         skipWaiting() + clients.claim() so update is one-tab-reload away
js/pwa.js              ← registers ./sw.js
                         on 'updatefound' + 'installed' + existing controller
                            → postMessage SKIP_WAITING
                         on 'controllerchange' → location.reload() (once)
                         calls reg.update() hourly + on visibilitychange
```

Release flow: edit code → bump `CACHE_VERSION` in `sw.js` → push `main` → GitHub Actions
runs `node tests/run-tests.js` then deploys via `actions/deploy-pages@v4`.

## Pipeline

```
beautifyCodes()                       router (DOM I/O)
  ├─ language = auto → detectLanguage(code)
  ├─ language == 'sql' → beautifySQL(code)
  ├─ language == 'js'  → formatJsWithLeadingComments(code)
  │                       (preserve leading <!---/<!--/`/*`/`//` banner,
  │                        run formatBraceCode on the JS body)
  └─ else (cfml)
       ├─ beautifyCFML(code, split_html_tag)   stage 1: outer CFML indent
       └─ if any deep_* checkbox on:
            deepFormatEmbedded(result, {sql, css, js})   stage 2
              ├─ if sql → <cfquery> body → protectCFMLTokens → beautifySQL → restore
              ├─ if js  → <script>  body → formatBraceCode
              └─ if css → <style>   body → formatCSSCode
```

`detectLanguage()` routes to `'js'` when BOTH:

1. The **post-comment-banner** body begins with a JS construct —
   `function` / `var` / `let` / `const` / `class` / `import` / `export` /
   `async` / `if` / `for` / `while` / `do` / `switch` / `return` / `throw`
   / `try` / `(…)=>` / `[` / `{` / `(` / `//` / `/*`. `splitLeadingCommentBlock`
   peels off any leading CFML markup (`<!--- --->`), HTML (`<!-- -->`),
   JS block (`/* */`), or JS line (`//`) comments before the prefix
   check, so a `.cfm` file that opens with a documentation banner over
   bare JS still routes correctly.
2. The full source has NO real `<TAG>` chars outside string literals
   AND outside comments AND outside regex literals. `hasTagsOutsideStrings`
   walks with JS lexer state across **six** opaque regions:
   - Strings with `\\`/`\'`/`\"` escapes
   - Template literals with `${…}`
   - `//` line comments
   - `/* */` block comments
   - `<!--- --->` CFML markup comments + `<!-- -->` HTML comments
   - **Regex literals `/.../flags`** — `/` in operator position opens a
     regex (scan to matching `/` respecting `\` escapes and `[...]`
     character classes where `/` is literal, then consume `gimsuy`).
     Without this, `src.replace(/'/g, '')` poisons string parity:
     the `'` inside the regex is mistaken for a string start, and
     subsequent `<TAG>` chars in real JS strings get flagged as real
     tags → file mis-routed to cfml → content corruption.

   Only `<TAG>` (alpha or `/` after `<`) outside all six contexts is
   a real tag.

The string-aware check is what makes JS fragments like
```js
var html = '<div class="x">' + name + '</div>';
```
route correctly. Without it, `<div` inside the string matched and the
file was misclassified as `'cfml'`, sending it through
`splitAdjacentCFMLTags` (whose string-walker doesn't honor JS escapes)
and corrupting the JS strings at runtime. The bug was data-loss class,
not just whitespace drift — see `tests/run-tests.js` cases
"HTML inside JS string literal preserved verbatim" and
"JS string literals containing HTML are NOT corrupted".

Any leading CFML/HTML tag OUTSIDE strings keeps the file in `'cfml'`
mode. The user can also force `'js'` from the dropdown if auto-detect
errs on a corner case.

## Token protection (key idea)

Guest languages (SQL, JS, CSS) live inside a host language (CFML). The guest formatter does not understand host syntax, so host fragments are replaced with opaque placeholders before formatting and restored afterwards.

**`protectCFMLTokens(sqlBody)`** — walks character-by-character so SQL string literals are recognized first (their contents stay literal) and then matches, outside strings: `<!---…--->`, `<cfqueryparam…>`, any `<cf*>` / `</cf*>`, `##`, `#…#`. Each match becomes `__CFTOKEN_N__`. `restoreCFMLTokens` splits on placeholders.

**`protectBraceCodeText(jsBody)`** — walks characters, protects: `//` line comment, `/* */` block comment, regex literal `/…/flags` (context-aware via `lastSig` operator/value tracker), `"…"` / `'…'` (stops at unescaped newline for safety), backtick template literal with `${…}` expression nesting (tracks `{` `}` depth inside expressions). Each protected span becomes `__BRACETOKEN_N__`.

**`protectBraceCodeParens(jsBody)`** — after text protection, wraps every balanced `(…)` as `__BRACEPAREN_N__` so the simple `{` `}` `;` formatter cannot split `for (i = 0; i < n; i++)` or a function argument list.

## SQL formatter state

The main loop in `beautifySQL` tracks four orthogonal axes:

| State | Purpose | Reset |
|---|---|---|
| `parenIndent` | subquery depth (each `(SELECT …)` pushes) | decremented on matching `)` |
| `funcDepth` | non-subquery paren depth (function calls, `OVER(...)`) | decremented on matching `)` |
| `caseLevel` | nested `CASE` expression depth | decremented on `END` |
| `listItemIndent` | persistent +1 indent after list-break comma | reset on next major clause |
| `inBetween` | suppress `AND` clause-match once after `BETWEEN` | consumed by first `AND` |
| `currentClause` | current top-level clause (`SELECT` / `WHERE` / …) | replaced on next major clause |
| `clauseStack` | saves all of the above on subquery entry, restores on exit | push/pop |

Major clauses do not break inside `funcDepth > 0` (window function `OVER(PARTITION BY … ORDER BY …)` stays inline) or `caseLevel > 0` (`AND`/`OR` in `WHEN x AND y THEN …` stays inline).

## CFML formatter state

`beautifyCFML` is line-based. Key state: `indentLevel`, plus `inMarkupComment` / `inBlockComment` so multi-line `<!--- … --->` / `/* … */` bodies are re-indented as comments, not re-parsed as code. Tag classification uses `CF_TAGS.inline` / `CF_TAGS.block` / `CF_TAGS.middle` and `HTML_VOID_TAGS`. Middle tags (`cfelse`, `cfelseif`) decrement then re-increment indent so the content after them lines up with the content before.

## Per-line brace counter (non-tag lines)

For lines that aren't CFML/HTML tags — bare JS / CSS / JSON-shaped content
between tags — `beautifyCFML` uses two helpers in `js/beautifier.js`:

- **`countBracesOutsideStrings(s)`** — counts `{` `[` (openers) and `}` `]`
  (closers) on one line, skipping these lexical contexts:
  1. Single/double-quoted strings (with `\` escapes)
  2. Template literals `` `…` `` (with `\` escapes; `${…}` braces DO count)
  3. Line comments `// …` (rest of line)
  4. Single-line block comments `/* … */`
  5. **Regex literals `/.../flags`** — `/` in operator position opens a
     regex (scan to matching `/` respecting `\` escapes and `[...]`
     character classes where `/` is literal, then consume `gimsuy`).
     `/` in value position is the division operator. Tracked via a
     `lastSig` (`'value'` | `'operator'`) state mirroring
     `protectBraceCodeText` in `js/deep-format.js`.

- **`leadingClosersOf(s)`** — counts consecutive `}` `]` at the start of
  the trimmed line (no intervening whitespace between closers). Used to
  pre-decrement `indentLevel` so the line's *display* position matches
  its visual depth before `applyIndent()` runs. Example: `} },` has
  `leadingClosers = 1` (second `}` is trailing) so the line displays
  at parent level, and the trailing `}` only affects next-line indent.

The math:
```
indentLevel -= leadingClosers
applyIndent()
indentLevel += (openers - closers + leadingClosers)
```
which simplifies to `indentLevel += (openers - closers)` net, but the
pre-decrement matters for the display level of THIS line.

**Why this matters**: without regex protection, `var markers = [ /\[a\][\s\S]*/, /\[b\][\s\S]*/ ]` leaks +1 indent per regex literal — each
regex contributes 2 `[` (escaped + character-class opener) but only 1 `]`.
Across a multi-regex array, the final closing `}` of the enclosing
function lands N tabs too deep. See `tests/run-tests.js` cases
"regex literal `[\s\S]` does not leak indent" and "division operator vs
regex literal disambiguation".

## Test harness

`tests/run-tests.js` uses Node `vm.runInContext` to execute all browser scripts in a faked `document` / `setTimeout` context, exposes `beautifySQL` / `beautifyCFML` / `beautifyCodes` / `deepFormatEmbedded` on that context, and runs `assertEqual` cases. This avoids needing a real browser or headless driver, and it exercises the exact same code the browser loads.
