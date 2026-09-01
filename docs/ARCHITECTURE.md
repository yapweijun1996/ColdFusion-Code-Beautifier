# Architecture

## Overview

Browser-side code beautifier for CFML/HTML/CSS/JS/SQL. Production has no build step or required network dependency; optional third-party runtimes are vendored. Script tags load in a fixed order, globals are exposed by classic scripts, and Node VM harnesses re-run the same browser code for regression and CLI use.

**Current baseline:** working tree based on HEAD `9206986`. `js/cfml-comment-utils.js` is now a shared depth-aware nested-markup-comment scanner loaded by all production/VM paths. `js/beautifier.js` remains the combined 1,849-line CFML formatter, language detector, line-ending restorer, and DOM/async router. The broader decomposition in root `DESIGN.md` / `ROADMAP.md` remains planned.

## Node CLI

`tools/beautify-file.js` provides a GitHub-hosted entry point for coding agents
and local automation. It loads the same production scripts in a small VM-backed
DOM harness, then calls `beautifyCodes()`; it does not maintain a second
formatter implementation and never uploads source code.

```text
node tools/beautify-file.js source.cfm
  └─ source_beutifier.cfm

node tools/beautify-file.js - --stdout < source.cfm
```

File mode keeps the input unchanged and writes the fixed `_beutifier.cfm`
suffix. Stdin/stdout mode is useful when an agent wants to format a temporary
buffer. `tools/source-encoding.js` detects UTF-8 (with/without BOM), UTF-16LE
BOM, and UTF-16BE BOM and re-encodes output with the same encoding/BOM; corpus
diagnostics use the same helper. The CLI defaults match the browser's normal formatting options (Auto
language, deep SQL/CSS/JS, and continuation alignment); flags can disable
those stages, normalize indentation, select a dialect, or enable the committed
Pro SQL bundle. Semantic Indent remains browser-only and opt-in.

## Load order

```
js/cfml-comment-utils.js ← nested CFML/HTML comment scanning shared by all formatter paths
js/cf-tags.js          ← CF_TAGS config (inline / block / middle + HTML_VOID_TAGS)
js/sql-keywords.js     ← SQL_MAJOR_CLAUSES, SQL_UPPERCASE_KEYWORDS, SQL_FUNCTION_KEYWORDS
js/sql-beautifier.js   ← beautifySQL + tokenizeSQL + matchSQLMajorClause
js/js-lexer-utils.js   ← shared JS regex/string lexical helpers
js/deep-format.js      ← deepFormatEmbedded + token protection layers
js/tag-utils.js        ← get_tag_name / start / end
js/cfml-splitter.js    ← splitAdjacentCFMLTags pre-pass
js/toast.js            ← notification UI
js/clipboard.js        ← copy_output_data / clear_data
js/pro-sql.js          ← lazy-loads vendor/sql-formatter.min.js on first Pro SQL use
js/tree-sitter-cfml.js ← Semantic Indent: algorithm + post-pass + dual grammar lazy-loader
js/beautifier.js       ← beautifyCFML (+ normalizeLeadingSpacesToTabs) + detectLanguage + beautifyCodes (router)
js/editor-ui.js        ← button events, keyboard shortcuts, Tab indentation, and async Beautify state
js/app.js              ← footer year + Pro SQL / Normalize / Semantic / Safe-Mode prefs persistence (localStorage) + bundle pre-warm
js/pwa.js              ← service-worker registration + auto-update reload (deferred)
```

`js/tree-sitter-cfml.js` loads before `js/beautifier.js` so its globals
(`applySemanticIndentPostPass`, `ensureTreeSitterCFML`, …) are available to the
`beautifyCodes` router. `js/editor-ui.js` then loads after the formatter so it
can bind the public formatter/clipboard functions without inline HTML handlers.
All application scripts are classic `defer` scripts in this same order; this
preserves the global API while allowing the document to parse before execution.
The UI module guards browser-only initialization and the Node VM harness loads
it separately in `tests/ui.test.js`; the standalone `tests/tree-sitter.test.mjs`
exercises the semantic path directly.

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

The vendor bundle is **runtime-lazy**: it is injected only when Pro SQL is enabled (or a saved preference pre-warms it), and failures fall back to the built-in formatter. The current `sw.js` also lists `vendor/sql-formatter.min.js` in `PRECACHE_URLS`, so an installed/controlled PWA downloads it during service-worker installation for offline readiness even if Pro SQL remains off. Runtime execution is zero-cost while off; network precache cost is not.

## Normalize Indent (optional, opt-in)

`normalizeLeadingSpacesToTabs(code, unitOverride)` in `js/beautifier.js` runs as
the very first step of `beautifyCFML` when the **Normalize Indent** checkbox is
on. It rewrites each line's *leading* whitespace from spaces to tabs; line
content is never touched (only the run before the first non-whitespace char).

Unit detection is two-phase: (1) the smallest pure-space leading run across the
file; (2) if none exists — the file is already tab-indented from a prior beautify
— recover the original unit from the space remainder of tab+space lines
(`minSpaces + 1`, because the beautifier emits `N×unit − 1` spaces for N levels).
A `unitOverride` of 2 / 4 / 8 from the companion selector skips detection. The
checkbox + width persist in `localStorage` (`js/app.js`).

## Semantic Indent (tree-sitter) (optional, opt-in, experimental)

`js/tree-sitter-cfml.js` adds depth-aware indentation for **flat, zero-indent**
multi-line nested call chains — the case the line-by-line indenter cannot fix.

```
vendor/tree-sitter/web-tree-sitter.js     ESM glue (Parser, Language) — npm web-tree-sitter
vendor/tree-sitter/web-tree-sitter.wasm   tree-sitter core runtime (~196 KB)
vendor/tree-sitter/tree-sitter-cfml.wasm  CFML grammar (~2.6 MB) — <cfset>/<cfparam> expressions
vendor/tree-sitter/tree-sitter-cfscript.wasm  CFScript grammar (~2.1 MB) — <cfscript> bodies
```

Flow (post-pass, after `beautifyCFML` + any deep-format):

```
beautifyCodes (cfml branch)
  └─ if semantic_indent && (cfml or cfscript parser loaded):
       applySemanticIndentPostPass(result, cfmlParser, cfsParser)
         ├─ <cfset>/<cfparam> multi-line block → cfmlParser → computeCallIndentByLine
         └─ <cfscript> block (control-structure-free) → cfsParser → computeCfscriptIndent (per-statement)
```

Indent algorithm (`computeCallIndentByLine` / `computeCfscriptIndent`):
- Depth = number of `call_expression` ancestors (**call-only** depth, not raw CST
  depth, which would step unevenly through `arguments` / argument calls).
- `factor` = smallest positive gap between consecutive per-line start depths →
  exactly one tab per nesting level. cfscript factors **per statement**.
- Opening lines indent by their shallowest starting call; close lines align to
  the opener of the shallowest call ending on them.
- **`hasError` guard** (whole-subtree, not `isError`): unbalanced/incomplete
  blocks fall back to the line-scanner. cfscript additionally **skips** any block
  containing a `statement_block` (if/for/while/function/component braces).

Dual lazy-loader: one shared runtime init, then each grammar fetched
independently and only when a matching flat block is present
(`hasFlatInlineTagBlock` / `hasFlatCfscriptBlock`). The grammars are **not**
precached by the service worker (they are large and opt-in); they fall to the
stale-while-revalidate cache after first use. The whole feature is gated by a
default-OFF checkbox and degrades to the line-scanner output on any failure.

## Editor UI layer

`js/editor-ui.js` is deliberately small and browser-facing. It owns button
listeners, `Control/Command+Enter`, Tab/Shift-Tab line indentation, and the
Beautify busy indicator. It calls `beautifyCodes()` but does not implement any
formatting rules. The formatter returns a resolved Promise for the synchronous
path and a real Promise when Pro SQL or Tree-sitter must load, allowing the UI
to disable duplicate actions during the wait.

The formatter captures the input at request start. If the user edits the input
while a lazy resource is loading, the stale request is not applied and
`auto_clear` can only erase the unchanged captured input. This prevents an
async completion from overwriting or deleting newer user work. Before copy/clear,
`normalizeOutputLineEndings` restores CRLF when the captured source contains
CRLF; otherwise routed browser/CLI output uses LF.

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
runs `npm test` (formatter + UI contract + Tree-sitter) then deploys via
`actions/deploy-pages@v4`.

## Pipeline

```
beautifyCodes()                       DOM I/O + preload + stale-request guard
  ├─ language = auto → detectLanguage(code)
  ├─ language == 'sql' → formatProSQLSync (if enabled/loaded) | beautifySQL
  ├─ language == 'js'  → formatJsWithLeadingComments(code)
  │                       (peel leading CFML/HTML markup comments only;
  │                        keep JS comments in token protection; format JS body)
  └─ else (cfml)
       ├─ Normalize Indent (optional, before splitting)
       ├─ splitAdjacentCFMLTags(code)                  stage 0
       ├─ beautifyCFML(code, ...)                      stage 1
       ├─ deepFormatEmbedded(result, options, source) stage 2, optional
       │    ├─ <cfquery> → token protection + Pro/built-in structural dispatch
       │    ├─ <script>  → formatBraceCodeWithCFML / template-safe passthrough
       │    └─ <style>   → formatCSSCode
       └─ applySemanticIndentPostPass                  stage 3, optional/loaded
```

The no-preload path performs formatting immediately and returns an already-resolved Promise. When resources are lazy-loaded, the captured input is checked again before output is committed or cleared.

The outer scanner maintains a persistent named CFML/HTML tag hierarchy rather
than relying on a global opens-minus-closes counter. A matching close returns to
its opener and discards malformed descendants; an unmatched close is neutral.
`cfelse`/`cfelseif` reset the current conditional branch, and optional HTML end
tags (`tr`, `td`, `li`, `option`, `p`, etc.) are closed implicitly. This same
mechanism handles document roots, forms, queries, scripts, styles, and arbitrary
containers—there are no tag-specific root/form alignment patches.

CF tags embedded after SQL/text on a line (for example `AND <cfif ...>`) enter
the same hierarchy with quoted strings protected. Brace depth is active only
inside JavaScript/CFScript/CSS (or tag-free input explicitly routed through the
CFML scanner), so braces in SQL or ordinary HTML text cannot corrupt structural
indentation. Structural `<cfquery>` fallback formatting merges the canonical outer
hierarchy with the preserved SQL body: CFML branch tags and baseline SQL use
canonical depth, while substantially deeper pure-tab SQL continuation lines
remain intact. Common-indent cleanup uses the first real body line and never
lets a shorter mixed-whitespace outlier delete content. Already-canonical
bodies therefore remain fixed points instead of adding another level on a
later pass.

`detectLanguage()` routes to `'js'` when BOTH:

1. The **post-markup-banner** body begins with a JS construct —
   `function` / `var` / `let` / `const` / `class` / `import` / `export` /
   `async` / `if` / `for` / `while` / `do` / `switch` / `return` / `throw`
   / `try` / `(…)=>` / `[` / `{` / `(` / `//` / `/*`. `splitLeadingCommentBlock`
   peels leading CFML markup (`<!--- --->`) and HTML (`<!-- -->`) comments.
   JS block/line comments remain in the body and match the JS prefix directly,
   allowing `protectBraceCodeText` to restore them with host-context-aware
   indentation.
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

## Token restoration contract

**Any `protectXxxToken` MUST have a host-context-aware `restoreXxxToken` for multi-line tokens.** This is a hard contract — violating it produces wrong-but-stable alignment bugs (the formatter re-indents code around the token but the token content keeps its source whitespace, off by N tabs).

The contract:

| Token kind | Restore strategy | Why |
|---|---|---|
| Single-line tokens | Plain substring replace | Token sits on one line — placeholder's line indent is the only indent needed; main loop already applied it. |
| Multi-line block comments (`/* … */`) | Strip longest common leading TAB sequence from continuation lines; re-prepend with placeholder's host-line baseIndent | Tabs are structural indent (re-indentable); spaces preserve visual alignment under `/* ` and must NOT be stripped. |
| Multi-line `(…)` paren groups | Walk lines tracking brace depth from 0. Strip each continuation line's leading whitespace; prepend `baseIndent + depth-tabs`. Lines starting with `}`/`]` pre-decrement so closers align with their openers. | Paren content is real code — its structure dictates indent, not source whitespace. |
| Multi-line template literals / regex | Verbatim restore (NEVER modify) | Content is syntactically significant — every character + newline is part of the string/pattern value. Re-indent would alter runtime behavior. |
| Single-line strings | Verbatim restore | Content is significant; can't span newlines anyway. |

Detection at restore time uses the token value's leading chars:
- starts with `/*` → block comment, re-indent
- starts with `` ` `` → template literal, verbatim
- starts with `/` (not `/*` or `//`) → regex, verbatim
- starts with `"` or `'` → string, verbatim
- starts with `//` → line comment, single-line (no newline)
- starts with `(` → paren group, re-indent with depth tracking

Implementations: [`restoreBraceCodeText`](../js/deep-format.js) (commit `e308e69`), [`restoreBraceCodeParens`](../js/deep-format.js) (commit `9156ba7`), shared helpers `reindentMultilineBlockComment` + `reindentMultilineParenContent`.

**Anti-pattern (the bug that motivated this contract)**:

```js
// WRONG — flat replace mis-aligns multi-line tokens after host context changes.
function restoreXxx(code, tokens) {
    for (var i = 0; i < tokens.length; i++) {
        code = code.split('__XXX_' + i + '__').join(tokens[i]);
    }
    return code;
}
```

Real-world repros that broke under the flat-replace approach (all 2026-05-14):
- Multi-line `(function(evt) { body })` callback — body kept source's +1 tab outer-wrap after wrapper got dedented. Visible in `sample/ai_chatbox_js_runtime_send.cfm` L218-222.
- File-header `/* ========== HEADER … */` block comment — comment kept source's +1 tab after surrounding code got dedented to 0. Visible in same fixture L13-15.

**When adding a new `protectXxxToken`**: also write `restoreXxxToken` that handles the multi-line case. If your token value is always single-line, document that invariant and the restore can stay flat — but you must guarantee no caller can pass multi-line content. Otherwise, add a regression test that exercises a multi-line input.

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

`beautifyCFML` is line-based. Key state: `indentLevel`, plus `inMarkupComment` / `inBlockComment` so multi-line `<!--- … --->` / `/* … */` bodies cannot affect the outer structure stack. Before that outer pass, `alignCFMLCommentedCodeBlocks` identifies code-looking multiline CFML comments and runs their body through a zero-based, alignment-only virtual pass; prose-only comments remain unchanged, and failed content/line-count checks fall back to the source block. Tag classification uses `CF_TAGS.inline` / `CF_TAGS.block` / `CF_TAGS.middle` and `HTML_VOID_TAGS`. Middle tags (`cfelse`, `cfelseif`) decrement then re-increment indent so the content after them lines up with the content before.

## Per-line brace counter (non-tag lines)

For lines that aren't CFML/HTML tags — bare JS / CSS / JSON-shaped content
between tags — `beautifyCFML` uses helpers split across focused files:

- **`splitAdjacentCFMLTags(code)`** in `js/cfml-splitter.js` — inserts safe
  line breaks between adjacent CFML/HTML tags before outer indentation.

- **`scanJSRegexLiteralEnd(code, pos, prefix, opts)`** in
  `js/js-lexer-utils.js` — shared lightweight regex literal scanner used by
  the CFML splitter to avoid treating `/</g` as a real `</g>` tag.

- **`countBracesOutsideStrings(s)`** in `js/beautifier.js` — counts `{` `[` (openers) and `}` `]`
  (closers) on one line, skipping these lexical contexts:
  1. Single/double-quoted strings (with `\` escapes)
  2. Template literals `` `…` `` (with `\` escapes) are opaque to this per-line counter; outer multi-line-template state preserves payload lines, while the deep JS token protector separately tracks `${…}` nesting
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

## Shared nested markup-comment scanner

`js/cfml-comment-utils.js` provides `findCFMLCommentEnd`, `findMarkupCommentEnd`, `consumeMarkupComment`, and line-oriented `advanceMarkupCommentState`. CFML comments are depth-aware: an inner `<!--- ... --->` does not prematurely terminate the outer comment. Browser, CLI VM, formatter tests, splitter, brace/tag scanner, language detector, SQL token/tree handling, deep JS protection, and the host-side corpus range classifier load the helper before use. HTML comments remain first-close regions. The outer formatter still treats both forms as opaque; only code-looking multiline CFML comments are aligned by the isolated prepass described above.

This module is the only completed extraction related to the broader refactor. Its dependent script-order and SW-precache entries are already present.

## Latest implementation hardening

The current baseline additionally includes:

- depth-aware nested CFML comments kept opaque across splitting, outer indentation, SQL, JavaScript, and detection; code-looking multiline CFML comments receive a separate internal alignment pass;
- routed LF/CRLF output style restoration;
- CLI/diagnostic preservation of UTF-8 BOM state and BOM-marked UTF-16LE/UTF-16BE source encoding;
- `normalizeStructuralCFMLTags` before structural query dispatch, including multi-line control tags;
- whitespace-tolerant closing raw tags such as `</cfquery >`;
- idempotent marker/Phase 3/structural fallback alignment with SQL parenthesis/subquery awareness;
- `formatBraceCodeWithCFML`, which composes own-line CFML control depth with JS brace depth;
- a conservative bare-JS fragment state inside CFML control flow, including Allman braces;
- multi-line template payload preservation and deep-JS bypass when reformatting would alter payload indentation;
- legacy executable script wrappers (`<!--` ... `//-->`) distinguished from ordinary HTML comments.

## Planned decomposition

Beyond the existing shared comment scanner, the current combined module will be decomposed only after characterization tests are locked. Planned modules and phase gates are defined in root [DESIGN.md](../DESIGN.md), [SPEC.md](../SPEC.md), [ROADMAP.md](../ROADMAP.md), and [TASK.md](../TASK.md). This is a behavior-preserving refactor: classic scripts, public globals, load order, synchronous no-preload behavior, VM/CLI parity, and fallback semantics remain requirements.

## Test harness

`tests/run-tests.js` uses Node `vm.runInContext` to execute production browser scripts in a faked `document` / timer context and currently contains 246 exact `assertEqual` call sites, 22 content-preservation invariants, and 27 Pro SQL token-equivalence cases. Separate suites cover UI behavior, CLI E2E, and real-WASM Semantic Indent. This avoids a required headless browser while exercising the same formatter code loaded by production.
