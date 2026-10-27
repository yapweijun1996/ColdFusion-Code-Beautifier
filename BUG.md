# Bug Report

**Review date:** 2026-10-27  
**Scope:** local working tree of ColdFusion Code Beautifier; browser UI, service worker, CLI, CFML/HTML, JavaScript, CSS, SQL, and opt-in Semantic Indent.  
**Status:** the detailed observations below are historical. Use the current review matrix for status and severity; earlier source line numbers and P0/P1/P2 labels may no longer match the working tree. This is a bounded investigation, not proof that every possible bug has been found. Published npm package and live deployment were not tested.

## Current review matrix

Rechecked against the local working tree on 2026-10-27. **Targeted fix** and **Sample protected** mean the listed cases pass focused checks, not that every related input is safe. **Open** means the stated behavior was reproduced locally under the conditions below. The six follow-up candidates have been investigated; the SQL candidate is protected in the tested final output.

Current priorities use **P1** for confirmed input-specific source corruption, data-loss risk, or a material safety failure; **P2** for limited presentation, routing, invalid-input or configuration behavior. Reassess impact for a particular production workflow. Historical severity labels in the detailed entries are retained only as review history.

| ID | Current status | Priority | Boundary |
|---|---|---|---|
| BUG-01 | Sample protected | P1 if reproduced | Specific CSS literal preserved; broader mixed CSS remains unverified. |
| BUG-02 | Sample protected | P1 if reproduced | Specific SQL marker collision preserved; other SQL paths remain in scope. |
| BUG-03 | Sample protected | P2 if reproduced | Specific `<pre>` text preserved in the current CLI sample. |
| BUG-04 | Sample protected | P1 if reproduced | Specific `<textarea>` value preserved in the current CLI sample. |
| BUG-05 | Sample protected | P2 if reproduced | Specific adjacent HTML span spacing preserved in the current CLI sample. |
| BUG-06 | Targeted fix | P1 if regressed | Multiline CFML source preserved in CLI tests; target CFML runtime value unverified. |
| BUG-07 | Targeted fix | P1 if regressed | Split setting preserves quoted literals in focused tests. |
| BUG-08 | Targeted fix | P1 if regressed | Targeted JavaScript template and continuation runtime values preserved with Deep options disabled. |
| BUG-09 | Targeted fix | P1 if regressed | Tested regex-quote scripts preserve values and allow a following query to format. |
| BUG-10 | Targeted fix | P1 if regressed | Real browser and WASM checks preserve script template values; CFML server behavior unverified. |
| BUG-11 | Targeted fix | P1 if regressed | Real WASM post-pass preserves tested CFScript literal; CFML runtime behavior unverified. |
| BUG-12 | Targeted fix | P1 if regressed | Tested scientific and hex tokens preserved; database execution unverified. |
| BUG-13 | Targeted fix | P1 if regressed | Tested parameter and prefixed-string tokens preserved; database execution unverified. |
| BUG-14 | Targeted fix | P1 if regressed | Dialect-ambiguous quoted suffixes are preserved rather than guessed. |
| BUG-15 | Targeted fix | P1 if regressed | Tested SQL literal retained; validity of the exact tag-like CFML example remains unverified. |
| BUG-16 | Targeted fix | P1 if regressed | Tested multiline SQL value preserved; database execution unverified. |
| BUG-17 | Targeted fix | P1 if regressed | Default output fails when destination exists; explicit output may replace a different file. |
| BUG-18 | Targeted fix | P1 if regressed | Tested default and explicit hard-link aliases cannot overwrite the input; symlink tests skipped on this Windows host. |
| BUG-19 | Targeted fix | P1 if regressed | Pro SQL fallback warnings omit query text and exception messages; targeted CLI and SQL fallback checks passed. |
| BUG-20 | Targeted fix | P1 if regressed | In-flight requests are cancelled when Safe Mode, Deep/Pro SQL or Semantic Indent settings change; browser and UI checks passed. |
| BUG-21 | Targeted fix | P2 if regressed | Outdent clamps a caret or selection inside removed indentation to its own line start; Chromium and UI checks passed. |
| BUG-22 | Targeted fix | P2 if regressed | Indent includes an initial selected empty line and excludes a next line when the selection ends at its start. |
| BUG-23 | Targeted fix | P1 if regressed | HTTP errors remain visible online without replacing a usable cached page; offline reload and recovery from an old poisoned entry passed in Chromium. |
| BUG-24 | Targeted fix | P2 if regressed | Auto routes the reported regex-containing sample to JS; mixed CFML/HTML samples remain on the outer route. Detection remains heuristic. |
| BUG-25 | Targeted fix | P2 if regressed | HTML text apostrophes no longer hide the tested Deep JS, SQL or CSS blocks; quoted attributes and tested opaque regions remain protected. |
| BUG-26 | Sample protected | P2 if reproduced | Specific CSS custom-property close-tag sample is no longer skipped. |
| BUG-27 | Targeted fix | P2 if regressed | Tested CFScript and CFML inputs produce the same semantic indentation with cold and warm parsers; load failure still falls back to the line scanner. |
| BUG-28 | Targeted fix | P2 if regressed | Odd-byte BOM-marked UTF-16 is rejected; valid UTF-16 encoding is preserved in focused CLI tests. |
| BUG-29 | Targeted fix | P2 if regressed | CLI accepts only explicit widths `2`, `4` or `8`; omitted width keeps auto detection and invalid values exit before output. |
| BUG-30 | Targeted fix | P1 if regressed | Safe Mode disables Deep SQL/CSS/JS, Pro SQL and Semantic Indent; recognized standalone SQL/JS is unchanged. CFML/HTML still receives outer formatting. |
| BUG-31 | Targeted fix | P1 if regressed | Chromium preserved an output-only result across a controlled update; older clients must copy output before their first upgrade. |
| BUG-32 | Targeted fix | P1 conditional | Final-save failures postpone automatic reload and attempt to remove stale data; manual navigation relies on browser confirmation. |
| BUG-33 | Open | P2 | A dismissed update prompt cannot be re-opened by the tested update check; failed save actions now remain available for retry. |
| BUG-34 | Open | P2 | A controlled A/B deployment served B HTML with A JavaScript before update consent; real-version incompatibility is unverified. |
| BUG-35 | Targeted fix | P1 if regressed | CI rejects unexpected entries in both sample directories; Pages stages only explicitly listed public assets. Linux CI and live deployment remain unverified locally. |

The review used isolated synthetic CLI files, actual Chromium and real vendored Tree-sitter WASM. Follow-up fixes were checked with CLI, browser and focused regression tests, but not with a CFML engine or database. The working tree contained pre-existing changes; see the detailed observations for original repros and limitations.

## Historical evidence and severity

- **Confirmed:** observed with synthetic inputs against the local CLI, the actual local browser UI, or the actual bundled Tree-sitter parsers. `npm test` passed all seven suites during the preceding review; passing tests do not prove semantic equivalence.
- **P0:** silent source/data corruption or loss of the original file. **P1:** significant loss of safety, functionality, privacy, or availability. **P2:** localized editor, configuration, or invalid-input error.
- CLI reproductions use `node tools/beautify-file.js - --stdout --language cfml` with the displayed input on stdin, unless another mode or option is specified. `\t` in observed text means a tab. All displayed examples are synthetic.
- Real Lucee/Adobe ColdFusion and database execution were not available in this review. CFML and database effects below are identified from changed source or language syntax, not asserted as runtime observations.
- Tracked tests and proposed future fixtures must not contain private source. Preserve originals and review output; Safe Mode does not eliminate the whitespace-sensitive failures listed here.

## Historical observations: source and output corruption

### BUG-01 — Deep CSS inserts a newline inside a string (P0)

- **Location:** `js/deep-format.js:1286-1293,2115-2117`; tracked as `TASK.md` S01.
- **Reproduce:** format the following with default options:

  ```html
  <style>
  .x {
  content: "}b";
  }
  </style>
  ```

- **Observed:** the string becomes `"}\n\t\tb"` in the output, with a physical newline inside the quoted CSS string; the command exits 0 without warning. `--no-deep-css` preserved this specific literal.
- **Cause / impact:** the global `}`-followed-by-selector regex runs without recognizing strings or comments. It can invalidate a declaration or change its value. The same replacement also splits comment text containing `}b`.
- **Acceptance:** keep strings, escapes and comments intact; test CSS token/value preservation through the full route, including mixed CFML.

### BUG-02 — SQL placeholder collision replaces a real identifier (P0)

- **Location:** `js/deep-format.js:1485-1494,1547-1550`; `TASK.md` S02.
- **Reproduce:** default CFML formatting of:

  ```cfml
  <cfquery name="q">
  SELECT __CFTOKEN_0__ FROM foo WHERE id = <cfqueryparam value="#id#" cfsqltype="cf_sql_integer">
  </cfquery>
  ```

- **Observed:** the `__CFTOKEN_0__` identifier in the `SELECT` list is replaced by a copy of the `cfqueryparam`; exit 0, no warning. `--no-deep-sql` preserved the identifier in this sample. A matching identifier inside an SQL comment was also replaced.
- **Cause / impact:** generated names are not checked against user content; global restoration replaces both generated and pre-existing text. SQL or comment content can be silently changed.
- **Acceptance:** collision-proof markers or equivalent exact-position restoration; verify strings, identifiers, comments, token ordering, Pro SQL and fallback routes.

### BUG-03 — Whitespace-sensitive `<pre>` content changes (P0)

- **Location:** `js/beautifier.js:1139-1160,1506-1513`; `TASK.md` S03.
- **Reproduce:** format `<pre>  keep\n   both  \n</pre>` with all three `--no-deep-*` flags.
- **Observed:** the second content line becomes `\tboth`, removing its original leading and trailing spaces. Chromium DOM `textContent` changed from `"  keep\n   both  \n"` to `"  keep\n\tboth\n"`.
- **Impact:** visible preformatted text changes even when deep formatting is disabled. Handle other whitespace-preserving contexts based on their actual semantics, not just tag nesting.

### BUG-04 — `<textarea>` content is treated as markup and modified (P0)

- **Location:** `js/cfml-splitter.js:18-27,214-225,240-279`.
- **Reproduce:** format `<textarea><span>x</span></textarea>` with the default CFML route.
- **Observed:** the formatter inserts newlines and a tab around `<span>x</span>`. Chromium reported textarea `.value` changing from `<span>x</span>` to `\t<span>x</span>\n`.
- **Impact:** form initial values and potentially submitted data change. `<textarea>` is an RCDATA context, not ordinary nested markup.

### BUG-05 — Splitting adjacent inline tags changes rendered text (P0)

- **Location:** `js/cfml-splitter.js:214-225`; `TASK.md` S03.
- **Reproduce:** format `<div><span>A</span><span>B</span></div>`, including with all Deep options disabled.
- **Observed:** a newline is inserted between the spans. Chromium `innerText` changed from `AB` to `A B`; rendered widths also differed.
- **Impact:** visible text and layout can change. Whitespace-only transformations are not inherently HTML-semantic-preserving.

### BUG-06 — Multiline CFML string whitespace changes in the outer pass (P0)

- **Location:** `js/beautifier.js:1139-1160,1204-1243`.
- **Reproduce:** format the following as CFML, including with all Deep options disabled:

  ```cfml
  <cfset x = "a
    b  
  ">
  ```

- **Observed:** the continuation becomes `\t b` and its two trailing spaces disappear; the closing line is reindented. The literal's source characters therefore differ.
- **Impact:** multiline CFML values can change; actual server execution was not tested. Preserve the literal, not merely its indentation after trimming.

### BUG-07 — Split option rewrites `><` inside literals (P0)

- **Location:** `js/beautifier.js:1053-1058`; CLI option `tools/beautify-file.js:65,102-103`.
- **Reproduce:** format `<cfset x = "><">` with `--split-html-tag`. Or format `<script>const x = "><";</script>` with `--split-html-tag --no-deep-js --no-deep-css --no-deep-sql`.
- **Observed:** a physical newline and indentation are inserted inside the quoted value; the JavaScript example becomes a syntax error. With Deep JS enabled, its validation may instead restore the original script and warn, but CFML and other contexts are not protected by that JS fallback.
- **Cause:** a global `replace(/></g, '>\n<')` runs before context-aware scanning. **Acceptance:** only split actual tag boundaries; preserve strings, attributes and comments.

### BUG-08 — Disabling Deep JS still changes JavaScript string values (P0)

- **Location:** `js/beautifier.js:1158-1175,1633-1643,2019-2028`; contradicted by `docs/SAFETY.md:39-44`.
- **Reproduce:** place either `const s = ` followed by a multiline template `` `a\n    b` `` or the JavaScript line-continuation string `"a\\\n    b"` in a `<script>` block; disable all three Deep options. Execute the original and formatted JavaScript with Node and print `JSON.stringify(s)`.
- **Observed:** template value `"a\n    b"` became `"a\n\t    b"`; continuation value `"a    b"` became `"a\t    b"`. Both outputs executed successfully and the formatter emitted no warning.
- **Impact:** the supposedly opaque/safe path changes application data. Disabling Deep JS is not a whole-script byte-preservation guarantee.

### BUG-09 — Regex quote hides a script from Deep JS validation (P0)

- **Location:** `js/deep-format.js:1217-1253,1397-1478`; outer mutation `js/beautifier.js:1163-1175`.
- **Reproduce:** format with default options:

  ```html
  <script>
  const r = /"/;
  const s = `a
   b`;
  console.log(JSON.stringify(s));
  </script>
  ```

- **Observed:** no warning; original script prints `"a\n b"`, formatted script prints `"a\n\t b"`. The closing-tag scanner treats the quote inside the regex as a string opener, so both script collections can be empty and the already-changed region escapes the JS check.
- **Acceptance:** detect script boundaries using JavaScript-aware lexing; validate or restore the final emitted body, not merely a pre-indent candidate.

### BUG-10 — Semantic Indent rewrites a JavaScript template as CFML (P0)

- **Location:** `js/tree-sitter-cfml.js:185-190,236-272`.
- **Reproduce:** in the browser choose CFML/HTML, disable Deep SQL/CSS/JS, and format the following first with Semantic Indent off, then on. The grammar was loaded from the local vendored assets:

  ```html
  <script>
  const value = `
  <cfset x = outer(
  inner()
  )>
  `;
  </script>
  ```

- **Observed:** the enabled pass adds an additional tab before `inner()` inside the JavaScript template. The actual UI route and a direct call to `applySemanticIndentPostPass` with the real parser both reproduced the difference.
- **Impact:** opt-in post-processing treats literal text as executable CFML and changes the string. This HTML/JS example was not executed through a CFML server.

### BUG-11 — Semantic Indent trims unrelated CFScript literal content (P0)

- **Location:** `js/tree-sitter-cfml.js:210-230`.
- **Reproduce:** directly apply `applySemanticIndentPostPass` using the loaded real CFScript parser to:

  ```cfml
  <cfscript>
  result = outer(inner(
  inner()
  ));
  message = "first
      significant indentation
  last";
  </cfscript>
  ```

- **Observed:** once the call indentation map is nonempty, the pass rewrites every line; `    significant indentation` becomes `\tsignificant indentation` and the `last` line is also prefixed. This was observed on the real post-pass, not independently attributed through a CFML runtime.
- **Impact:** unrelated multiline string content changes; the outer formatter may also modify such strings (BUG-06).

### BUG-12 — Built-in SQL tokenizer splits scientific notation and hexadecimal literals (P0)

- **Location:** `js/sql-beautifier.js:307-328,416-448`.
- **Reproduce:** format `SELECT 1e-3` with `--language sql`; format `SELECT 0xFF` similarly.
- **Observed:** `SELECT 1 e - 3` and `SELECT 0 xFF`, respectively, exit 0.
- **Impact:** valid numeric tokens in applicable SQL dialects become different tokens or invalid SQL. Pro SQL failure can fall back to this built-in path.

### BUG-13 — Built-in SQL tokenizer splits parameters and prefixed strings (P0)

- **Location:** `js/sql-beautifier.js:307-316,373-375,416-448`.
- **Reproduce:** `SELECT @x, $1, N'abc'` with `--language sql`.
- **Observed:** `SELECT @ x,\n\t$ 1,\n\tN 'abc'`. SQL Server `@x`/`N'abc'` and PostgreSQL `$1` are no longer their original tokens.
- **Impact:** executable SQL can be broken or interpreted differently. Add dialect-appropriate lexical tests, including fallback behavior.

### BUG-14 — Backslash handling changes standard SQL string tokens (P0)

- **Location:** `js/sql-beautifier.js:260-282`; embedded token protection uses a similar rule at `js/deep-format.js:1499-1518`.
- **Reproduce:** with `--language sql`, use `SELECT 'x\' AS a, 'z' AS b` where the backslash is an ordinary character, as in PostgreSQL with `standard_conforming_strings=on`.
- **Observed:** output is `SELECT 'x\' AS a, ' z ' AS b`; the second literal's value is changed. No database was run.
- **Cause:** the lexer unconditionally treats backslash as escaping the following quote, although SQL string escaping is dialect/settings dependent.

### BUG-15 — SQL post-restoration regex removes whitespace inside a literal (P0)

- **Location:** `js/deep-format.js:1210-1213,1554-1560`.
- **Reproduce:** format a `<cfquery>` body containing `SELECT 'a </cfif>'` with default Deep SQL.
- **Observed:** the quoted text becomes `'a</cfif>'`; `--no-deep-sql` avoids this Deep SQL cleanup in the isolated example.
- **Impact:** the global post-restoration cleanup crosses string boundaries. Whether this exact synthetic tag-like literal is accepted by a particular CFML engine was not tested.

### BUG-16 — Embedded multiline SQL literal gains indentation (P0)

- **Location:** `js/deep-format.js:1210-1213,1661-1704`.
- **Reproduce:** format `<cfquery name="q">` containing `SELECT 'a\nb'` on two lines with default Deep SQL.
- **Observed:** the literal becomes `'a\n\tb'`. `indentEmbeddedBody` adds indentation inside the quoted value.
- **Impact:** multiline literal values or comparisons can change; database execution was not tested.

### BUG-17 — Default output silently overwrites an existing file (P0)

- **Location:** `tools/beautify-file.js:160-163,257-267`.
- **Reproduce:** in a disposable temporary directory create `input.cfm` and an unrelated `input_beutifier.cfm` containing `USER DATA: do not overwrite`; run `node tools/beautify-file.js <temp>/input.cfm`.
- **Observed:** exit 0 and the existing destination is replaced without a prior warning or confirmation. The input remains unchanged in this ordinary-file example.
- **Impact:** loss of an existing output or unrelated file. Different source extensions with the same stem also map to the same default output name.

### BUG-18 — A linked default output overwrites the original input (P0)

- **Location:** `tools/beautify-file.js:160-163,257-267`.
- **Reproduce:** in a disposable directory create `source.cfm`, then create a hard link named `source_beutifier.cfm` to it and run the default file-mode CLI. Do not use a real source file.
- **Observed:** the original input bytes changed; exit 0. The default path and input reference the same underlying file, and `writeFileSync` truncates it.
- **Impact:** violates the stated default separate-output protection. A safe solution must check identity/links as well as destination existence.

## Historical observations: safety, privacy and functional errors

### BUG-19 — Pro SQL failure logs source text to stderr/console (P1)

- **Location:** `js/beautifier.js:2003-2013`, `js/deep-format.js:995-998,1198-1200`, `tools/beautify-file.js:204-211`.
- **Reproduce:** send `SELECT 'SYNTHETIC_MARKER` to `--language sql --pro-sql`.
- **Observed:** exit 0 after fallback; stderr contains `SQL excerpt: SELECT 'SYNTHETIC_MARKER`, and the parser error also contains part of the text.
- **Impact:** source or values can enter local browser console, CI logs or collected stderr. No network exfiltration was tested or inferred. Sanitize both explicit excerpts and third-party exception messages.

### BUG-20 — Safe Mode enabled during async loading does not apply to the pending operation (P1)

- **Location:** `js/beautifier.js:1939-1961,1984-1987,2019-2028,2060-2098`; `js/editor-ui.js:175-195`; `js/app.js:179-204`.
- **Reproduce:** in the real UI, start formatting while an optional grammar load is pending; enable Safe Mode before resolving the load. The review used a controlled deferred loader in the local page and a synthetic CSS string from BUG-01.
- **Observed:** Safe Mode was checked and the Deep CSS control unchecked, but the pending `deepFormatEmbedded` call received `css: true` and corrupted the CSS string.
- **Impact:** displayed safety state disagrees with the operation actually executed. The controlled loader is instrumentation; the UI, option changes and formatting route were real.

### BUG-21 — Outdent moves caret into the preceding line (P1)

- **Location:** `js/editor-ui.js:80-104,110-160`.
- **Reproduce:** in the actual editor enter `xyz\n    abc`, place the caret after the first space on line 2 (offset 5), and press Shift+Tab.
- **Observed:** value becomes `xyz\nabc`, but caret becomes offset 1 on line 1 rather than offset 4 at the start of line 2.
- **Impact:** subsequent typing can modify the wrong line. Clamp positions inside removed indentation to that line's new start.

### BUG-22 — Tab skips the first selected empty line (P2)

- **Location:** `js/editor-ui.js:110-145`.
- **Reproduce:** in the real editor enter `\na`, select all and press Tab.
- **Observed:** output is `\n\ta`, not `\t\n\ta`. `lastIndexOf` finds the first newline when selection starts at offset 0.
- **Impact:** selected lines are inconsistently indented.

### BUG-23 — HTTP error response overwrites the offline home page (P1)

- **Location:** `sw.js:103-119`.
- **Reproduce:** install and control the app via a local service worker; let the home URL return a synthetic 503, wait for the cache entry to be written, then go offline and reload the same URL.
- **Observed:** online response 503; cache entry for the home URL had status 503 and body `SYNTHETIC TEMPORARY ERROR`; offline reload returned the same 503 and body. Test used an isolated local server.
- **Impact:** a temporary server error can replace a working cached offline page. The navigation branch caches responses without checking success.

### BUG-24 — Auto language detection mistakes a regex for HTML (P1)

- **Location:** `js/beautifier.js:1757-1787,1793-1829`.
- **Reproduce:** `function f(){return /<div>/.test("x");}` in Auto mode.
- **Observed:** the browser's `detectLanguage` returned `cfml`; the CLI Auto output remained on one line while `--language js` used the standalone JS formatter. The input is valid JavaScript.
- **Impact:** JS can miss its parser-backed transformation verification. This example demonstrates wrong routing, not a separately observed semantic change.

### BUG-25 — An apostrophe in HTML text hides the following script from Deep JS (P1)

- **Location:** `js/deep-format.js:1217-1245,1300-1315,1351-1394`.
- **Reproduce:** compare default CFML formatting of `<p>Don't</p>` followed by `<script>\nfunction f(){return 1;}\n</script>` with the same sample using `Do not`.
- **Observed:** the first function remains one line with no warning; the second is expanded by Deep JS. An apostrophe in ordinary HTML text is tracked as an open string while searching for `<script>`.
- **Impact:** valid embedded scripts silently skip formatting and associated script verification.

### BUG-26 — CSS custom property can hide a same-line `</style>` (P1)

- **Location:** `js/deep-format.js:1286-1294,1397-1458`.
- **Reproduce:** compare default formatting of `<style>\n:root{--x:red;} </style>` with `<style>\n:root{color:red;} </style>`.
- **Observed:** the first retains its same-line close, while the second is processed into a separate closing line. The scanner treats CSS `--` as an SQL-style line comment and misses the same-line close; no warning is emitted.
- **Impact:** Deep CSS is silently skipped or may pair with a later close; only the skipped example was reproduced.

### BUG-27 — Semantic Indent output depends on whether grammar was already loaded (P1)

- **Location:** `js/tree-sitter-cfml.js:392-410`; `js/beautifier.js:2035-2042,2081-2091`.
- **Reproduce:** on a fresh local browser page, enable Semantic Indent and format:

  ```cfml
  <cfscript>
  result = outer(inner(1,
  inner(2,
  inner(3))));
  </cfscript>
  ```

  Then format another flat chain with lines ending in `(` to load the real CFScript grammar; reformat the original input.
- **Observed:** cold `hasFlatCfscriptBlock` returned false and parser was not loaded; warm run indented nested lines differently. The same input/options produced different output.
- **Impact:** selected functionality and output depend on prior page history. The precheck ignores this fully flat call because its opener lines end in commas.

### BUG-28 — Truncated UTF-16 silently loses a byte (P2)

- **Location:** `tools/source-encoding.js:7-15,18-30`.
- **Reproduce:** use a disposable input with bytes `FE FF 00 41 42` (UTF-16BE BOM plus an odd-length payload), then format it to stdout.
- **Observed:** output bytes were `FE FF 00 41`, exit 0, no warning: the final `42` was discarded.
- **Impact:** malformed input is silently changed rather than rejected or reported. This observation concerns invalid/truncated input, not normal valid UTF-16.

### BUG-29 — Invalid `--indent-width` values are accepted (P2)

- **Location:** `tools/beautify-file.js:71,114-116,135-136`.
- **Reproduce:** format any input with `--indent-width 4garbage` or explicit `--indent-width 0`.
- **Observed:** both exit 0. `parseInt` accepts the first as 4; 0 is also accepted even though help advertises 2, 4 or 8.
- **Impact:** configuration errors go unnoticed. Distinguish the internal auto-width sentinel from explicitly supplied invalid values.

### BUG-30 — Safe Mode's whole-pipeline claim is false for standalone SQL (P1)

- **Location:** `index.html:71-75,97`, `js/app.js:179-204`, `js/beautifier.js:2000-2016`.
- **Reproduce:** in the local browser select SQL, enable Safe Mode, enter `select 1`, and click Beautify.
- **Observed:** output is `SELECT 1`, even though the Safe Mode tooltip says only the CFML whitespace-only pipeline runs and is suitable when no content-shaped change can be tolerated.
- **Impact:** unsafe or misleading promise; this particular change does not prove a SQL semantic change. BUG-12 through BUG-14 demonstrate separate built-in SQL corruption.

## Follow-up candidate verification

The checks below use synthetic inputs and the local working tree. They do not
establish behavior of an existing deployment or a published npm package.

### BUG-31 — PWA update can discard the only output

- **Confirmed in Chromium:** with Auto copy off and Auto clear input on, format
  `select 1`. Input becomes empty and output is `SELECT 1`. On an isolated
  server, install worker A, stage worker B and click **Update now**. After the
  actual reload both input and output were empty and no draft remained.
- `js/pwa.js` saves only the input; browser form restoration is not an
  application-level output backup and can differ between browsers. Loss
  matters when no other copy exists.
- **Current status:** input and output are saved together before controlled
  reloads; the tested Chromium update restored the output-only result. An old
  page cannot save output before its first upgrade to this fix.

### BUG-32 — Final draft-save failure can restore stale input

- **Confirmed with injected failure:** save `draft A` by clicking **Update
  now**, intercept `SKIP_WAITING` to simulate delayed activation, change the
  input to `draft B`, and make `sessionStorage.setItem` throw a synthetic quota
  error. A manual Chromium reload then restored `draft A`, not `draft B`, and
  removed the old snapshot.
- The activation delay and storage failure were controlled instrumentation,
  not observed production conditions. The initial save failure is handled
  separately: it postpones the update. Browser-restored input can also prevent
  the stale snapshot from replacing it.
- **Current status:** automatic reload is postponed when the final snapshot
  fails, and stale-snapshot removal is attempted. Manual `beforeunload` failure
  requests browser confirmation; suppression or explicit departure can still
  lose unsaved data, particularly when storage also blocks removal.

### BUG-33 — Some PWA update prompts cannot be retried

- **Confirmed in Chromium:** dismiss a waiting worker's update toast, then
  call the application's `checkForUpdate()`; the worker still waits but the
  **Update now** action does not return.
- In a real two-tab update, inject a storage failure in the first tab and
  click its **Reload now** action. The action disappears and the failure
  message appears; `checkForUpdate()` does not restore the reload action.
  Input remains in the current page and manual refresh remains possible.
- A controlled source-level probe found a narrower distinction: an initial
  **Update now** save failure resets the prompt state, so a later update check
  can display that action again.
- **Current status:** failed save actions remain visible for retry, but manual
  dismissal of an update toast still leaves the prompt unavailable.

### BUG-34 — HTML and assets can mix before update consent

- **Confirmed in Chromium with isolated synthetic A/B deployments:** worker A
  remained active and worker B was installed/waiting, with **Update now**
  not clicked. A normal reload displayed B HTML together with A JavaScript.
  After background revalidation another reload displayed B HTML and B
  JavaScript while worker A still controlled the page.
- The A/B incompatibility marker was synthetic. Real product breakage depends
  on whether two deployed versions have incompatible contracts; no actual
  deployed version pair or live site was checked.

### BUG-35 — CI sample guard does not cover all uploaded files

- The workflow guard checks only `find sample -name '*.cfm' -type f`; the
  Pages artifact step uploads `path: .`. Synthetic probes passed the guard for
  `sample/synthetic.CFM`, `.cfc` and `.txt`, while lowercase `.cfm` was blocked.
  The case-sensitive probe used Git Unix tools on Windows, not a Linux runner.
- The [upload action's v3 source](https://raw.githubusercontent.com/actions/upload-pages-artifact/v3/action.yml)
  archives the supplied directory excluding `.git` and `.github`, without an
  extension or `.gitignore` filter. Exposure requires a private file to enter
  the checked-out or generated workspace and subsequent workflow steps to
  succeed. Real sample contents, artifacts and deployment were not inspected.
- **Fix:** Both workflows reject unexpected entries in `sample/` and
  `sample_codebase/`, independent of extension; the deployment step stages
  explicitly listed browser assets instead of uploading the repository. The
  staging step repeats the guard and rejects symlinked public assets.
- **Checks:** Synthetic `.cfm`, `.CFM`, `.cfc`, `.txt`, nested-directory and
  `sample_codebase` cases were blocked locally. A staged site formatted CFML,
  CFScript and Pro SQL in Chromium, loaded both Tree-sitter grammars and
  installed its service worker. The Pages regression suite also passed on WSL
  Linux, including symlink checks; actual GitHub CI and live Pages were not run.
  This does not remove private files already committed to Git history.

### SQL comment/JOIN candidate — final output protected in the tested sample

- The actual CLI ran `node tools/beautify-file.js - --stdout --language cfml
  --pro-sql` with this synthetic input:

  ```cfml
  <cfquery name="q">
      select a.id
      from alpha a -- synthetic inner
      join beta b on a.id = b.id
      <cfif enabled>
          where a.id = 1
      </cfif>
  </cfquery>
  ```

  A controlled in-memory probe confirmed the Tier 2 intermediate candidate
  merged `JOIN` into the preceding comment. The SQL data guard detected the
  changed comment and restored the original query; the CLI's final output
  preserved the comment boundary. Non-Pro and Deep SQL-off controls also
  preserved it.
- This confirms an unsafe **intermediate candidate**, not final SQL corruption
  for this sample. No CFML engine or database was run; other cases remain
  unverified.

## Fix and regression priorities

1. Preserve BUG-35 privacy boundaries and BUG-31/32 data-recovery coverage, including first-upgrade and storage-failure boundaries.
2. Address remaining BUG-33 dismissal and BUG-34 mixed-version behavior; verify update consent and offline use.
3. Preserve existing editor, formatter, CLI, Safe Mode and cold/warm Semantic Indent regression coverage.
4. Validate formatted CFML/SQL in target runtimes and keep safety/limitations documents aligned; whitespace-only changes do not prove semantic equivalence.
