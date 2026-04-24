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
js/app.js              ← footer year
```

## Pipeline

```
beautifyCodes()                       router (DOM I/O)
  ├─ language = auto → detectLanguage(code)
  ├─ language == 'sql' → beautifySQL(code)
  └─ else
       ├─ beautifyCFML(code, split_html_tag)   stage 1: outer CFML indent
       └─ if any deep_* checkbox on:
            deepFormatEmbedded(result, {sql, css, js})   stage 2
              ├─ if sql → <cfquery> body → protectCFMLTokens → beautifySQL → restore
              ├─ if js  → <script>  body → formatBraceCode
              └─ if css → <style>   body → formatCSSCode
```

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

## Test harness

`tests/run-tests.js` uses Node `vm.runInContext` to execute all browser scripts in a faked `document` / `setTimeout` context, exposes `beautifySQL` / `beautifyCFML` / `beautifyCodes` / `deepFormatEmbedded` on that context, and runs `assertEqual` cases. This avoids needing a real browser or headless driver, and it exercises the exact same code the browser loads.
