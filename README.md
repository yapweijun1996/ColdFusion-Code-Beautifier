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
- **Language selector** with `Auto` / `CFML / HTML` / `SQL` modes; auto-detect routes SQL-looking input directly to the SQL formatter.
- **Auto-copy / auto-clear input / auto-clear output** independent toggles (copy-success guards the output clear).
- **Force-split `<tag><tag>`** option for dense HTML.
- **Fullscreen layout** with side-by-side input / output on desktop, stacked on mobile.

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
       └─ deepFormatEmbedded(result, {sql, css, js})
            ├─ <cfquery>  → protectCFMLTokens → beautifySQL → restore
            ├─ <script>   → formatBraceCode  (strings / regex / templates / parens protected)
            └─ <style>    → formatCSSCode
```

Full detail in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Testing

```bash
node tests/run-tests.js
```

Node harness replays every browser script in a VM context with a faked DOM, then runs `assertEqual` cases (33+ covering SQL clauses, deep-format routing, token protection, JS hardening). See [docs/TESTING.md](docs/TESTING.md).

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — load order, pipeline, token-protection layers, SQL/CFML state machines, test harness design.
- [docs/CHANGELOG.md](docs/CHANGELOG.md) — commit-by-commit release notes.
- [docs/LIMITATIONS.md](docs/LIMITATIONS.md) — known edge cases across CFML / SQL / JS / CSS.
- [docs/TESTING.md](docs/TESTING.md) — running the suite, helpers, adding new tests.

## File map

```
index.html              UI shell (language select, Deep SQL / CSS / JS checkboxes, auto copy/clear)
styles.css              fullscreen grid layout + mobile media query
js/cf-tags.js           CF_TAGS.inline / block / middle + HTML_VOID_TAGS
js/sql-keywords.js      SQL_MAJOR_CLAUSES + SQL_UPPERCASE_KEYWORDS + SQL_FUNCTION_KEYWORDS
js/sql-beautifier.js    tokenizer + formatter (caseLevel, funcDepth, listItemIndent, inBetween, clauseStack)
js/deep-format.js       deepFormatEmbedded, protectCFMLTokens, protectBraceCodeText, protectBraceCodeParens, formatBraceCode, formatCSSCode
js/tag-utils.js         get_tag_name / start / end
js/beautifier.js        beautifyCFML + detectLanguage + beautifyCodes (router)
js/clipboard.js         copy_output_data / clear_data
js/toast.js             notification UI
js/app.js               footer year
tests/run-tests.js      Node VM harness + assertEqual cases
```

## License

See [LICENSE](LICENSE). Project by [yapweijun1996](https://github.com/yapweijun1996).
