# CI Test Policy — User Cases as Pinned Regression

## Privacy contract

The `sample/` and `sample_codebase/` directories are gitignored and reserved
for local private material. Do not commit their contents: `.gitignore` does
not prevent a force-add, and a CI guard cannot undo a Git history disclosure.

- Both test and deploy workflows run `node tools/prepare-pages.js --check`
  immediately after checkout. It rejects unexpected files, directories and
  links in either sample directory, regardless of extension, without printing
  private filenames. Only regular `sample/.gitkeep`, `sample/README.md` and
  `sample_codebase/.gitkeep` placeholders are permitted.
- Pages staging repeats the guard and copies only the public browser asset
  allowlist into a new directory. It rejects symlinked assets and never uploads
  the repository root. Other repository files, including documentation and
  both sample directories, are not served by Pages; browse them on GitHub.
  When adding a browser resource, update `tools/prepare-pages.js` and verify
  the staged page and offline resources.
- `tools/diagnose-corpus.js` is a local diagnostic; CI never invokes it.

## The rule

> **Every user-reported bug becomes a sanitized pinned test in `tests/run-tests.js` before the fix lands.**

The pinned test must:
1. Use a **synthetic input** that reproduces the structural bug pattern. Strip proprietary table / column names down to generic placeholders only when they carry business context; structural names (`disp_pym1amt`, `comain_gst_name`, `qs_sr_nums`) that already match the open-source app domain are fine to keep verbatim.
2. Include a **named description** in the first arg to `assertEqual` that calls out the user-reported scenario (so a future reader sees "this exists because user X reported Y").
3. **Live in `tests/run-tests.js`** — no external file deps, no `require('./sample/...')`.

When CI runs (`npm test`):
- All pinned formatter tests, UI contract tests, CLI E2E tests, and Tree-sitter tests run with hard assertions.
- Any failure exits non-zero, blocking the merge / deploy.
- Total runtime is expected to remain < 5 seconds with no network or install.

## Inventory — user case → pinned test

Every entry below is a real user-reported scenario from the issue/feedback history, now permanently pinned.

| # | User scenario | Symptom | Pinned test (description prefix) |
|---|--------------|---------|----------------------------------|
| 1 | Three `<cfset>` glued on one line | Single line of glued executive tags doesn't auto-split | `auto-split: three adjacent cfset on one line` |
| 2 | `<cfset>` / `<!---...---><cfset>` mixed | Comment-wrapped cfset between executives breaks split | `auto-split: cfset / cfml-comment / cfset on one line` |
| 3 | `<cfif><cfinclude></cfif>` on one line | Block tag glued with executive tag | `auto-split: cfif open + cfinclude + cfif close on one line` |
| 4 | Inline `<cfif x>1<cfelse>0</cfif>` | Auto-split must NOT touch true inline cfif | `auto-split does NOT touch inline <cfif x>1<cfelse>0</cfif>` |
| 5 | `<script>` body containing CFML-looking strings | JS string literal must not trigger split | `auto-split skips contents of <script> block` |
| 6 | `<cfquery>` body with inline `<cfqueryparam>` | SQL body must stay verbatim, no internal split | `auto-split skips contents of <cfquery> block` |
| 7 | `<cfparam><cfinclude>` on one line | Two executive tags glued | `auto-split: cfparam + cfinclude on one line` |
| 8 | Nested `<cfif><cfif><cfset></cfif></cfif>` | Multi-level glue requires recursive split | `auto-split: nested cfif with inner cfset gets fully split` |
| 9 | `<td>foo&nbsp;<script>...</script>bar</td>` numberToEnglish pattern | `<script>` mid-line must peel + JS body re-indent | `auto-split: <script> mid-line gets pulled onto own line` |
| 10 | Multi-line JS body inside `<td>...<script>...</script>.</td>` | Block opens own depth, body indents +1, `</script>` aligns with open | `auto-split: <script> with multi-line JS body` |
| 11 | `<tr><td>foo</td><td>bar</td></tr>` | Opens get split, structural closes (`</tr>`) align with opens, `<td>x</td>` stays inline | `auto-split: <tr><td>x</td><td>y</td></tr>` |
| 12 | `<table><tr><td></td>...</tr></table>` | Empty `<td></td>` stays glued (no `>` between) | `auto-split: empty <td></td> stays glued` |
| 13 | `<td>x<cfif y>z</cfif>.</td>` mixed CFML + HTML close | `</td>` must peel when line has `</cfif>` (Rule B) | `auto-split: <td>x<cfif>z</cfif>.</td>` |
| 14 | `<cfscript>// note: <script>foo</script>...</cfscript>` | Opaque cfscript: embedded `<script>` in JS comment must NOT be extracted | `auto-split: <cfscript> opaque` |
| 15 | Real-world numberToEnglish full pattern | `<cfif>\n<td>...&nbsp;<script>JS</script><cfif>x</cfif>.</td>\n</cfif>` | `auto-split: real-world numberToEnglish pattern` |
| 16 | **disp_pym1amt** — badly-indented table glued multi-tag line | Legacy report code with 12-tab indent + `<cfif><tr><td><td>` on one line | `auto-split: real-world disp_pym1amt pattern — badly-indented multi-tag glued line` |
| 17 | **serialnum** — trailing stray `</cfif>` | `<cfif x>Foo</cfif> :&nbsp;</cfif>` — outer `</cfif>` glued to text | `auto-split: real-world serialnum pattern — <cfif set_language is 'english'>Serial Number</cfif> :&nbsp;</cfif>` |
| 18 | **GST** — stray `</b>` after inline cfif | `<b>\n<cfif x>GST<cfelseif y>VAT<cfelse>Sales Tax</cfif></b>` | `auto-split: real-world GST cfif pattern` |
| 19 | Inline `<p>Hello <b>world</b>.</p>` | Rule D must NOT peel `</b>` when matching `<b>` is on same line | `auto-split: inline <p>Hello <b>world</b>.</p> stays intact` |
| 20 | Rule D edge — leading `</cfif>` + inline cfif pair on same line | `</cfif>foo<cfif y>bar</cfif>` — trailing close legitimately matches inline `<cfif y>` and stays glued | `auto-split: inline <cfif x>1<cfelse>0</cfif> stays intact even with Rule D active` |
| 21 | Backslash in CFML string `"C:\path\"` | CFML has no backslash escapes; parser must not swallow closer | `CFML string with backslash before closing quote (Windows path)` |
| 22 | `qs_result_main` with lowercase `as`, `using`, `cast`, `over` | Tier 2 verbatim Lite path must uppercase common SQL keywords | `Lite uppercase covers AS, INNER JOIN, WHERE, FROM, SELECT` |
| 23 | Pro SQL marker injection / Phase 3 hoist (T1–T10) | Various cfif-bearing cfquery shapes (10 tests) — Phase 3 / Phase 4 dispatch | search `phase 3` / `phase 4` in `tests/run-tests.js` |
| 24 | CFML routed without SQL formatting when deep format off | CFML auto-split fires but SQL body stays verbatim | `cfml routed without sql formatting when deep format off` |
| 25 | **memo_transdesc Remarks** — `<font>` wraps multi-line content, `<br>#trim(Replace(..., "<br>", "ALL"))#</font>` jams stray `</font>` after text containing **`<br>` inside a string literal** | `</font>` must peel; the `<br>` inside `Replace(...)` string args must NOT confuse Rule D's tag matching (string literals are opaque to the splitter) | `auto-split: real-world memo_transdesc Remarks pattern — <font> wraps multi-line content, stray </font> after text+string-with-<br>-inside peels` |
| 26 | Bare JS `.cfm` partial with `<cfoutput>` island and HTML strings using JS escaped quotes | Formatter must not insert a raw newline inside `'...'` / `"..."`; browser symptom was `Uncaught SyntaxError: '' string literal contains an unescaped line break` | `js mode — beautifier output has no raw line break inside quoted strings`; `cfml mode — bare JS with cfoutput keeps escaped-quote HTML strings intact`; sample suite `FAIL JS string syntax guard` |

## Additional implementation-hardening coverage

These are CI-pinned implementation cases but are not assigned new user-case numbers without a corresponding issue record:

| Area | Pinned coverage |
|---|---|
| Nested CFML comments | outer close matching; commented tags remain opaque to splitter/indent; Phase 4 treats nested comment as one leaf |
| Source format | CLI UTF-16BE BOM and CRLF round trip |
| Structural SQL stability | multi-line control-tag normalization, whitespace close tags, fallback and CLI Pro SQL idempotency |
| Deep JavaScript + CFML | own-line/nested CFML branch depth combined with JS brace depth |
| Bare JS inside CFML | conservative fragment activation and Allman brace indentation |
| Template literals | multi-line payload indentation/content preserved; no second-pass rewrite |
| Legacy script wrappers | executable `<!--` ... `//-->` wrapper remains format-visible |

## How to add a new user case

1. **Receive the bug report** — usually a screenshot or pasted snippet, plus the user's expected output.
2. **Sanitize the input** — drop genuinely proprietary identifiers (real customer names, real product codes) and keep structural ones. The shape of the bug must survive sanitization.
3. **Write a failing pinned test FIRST** — add an `assertEqual` to `tests/run-tests.js` with a descriptive name. Run `node tests/run-tests.js` and confirm the FAIL message matches the user's report.
4. **Fix the source code** until the test passes and no other test regresses.
5. **Append the case to the inventory table above** — pick the next `#` and document the scenario.
6. **Commit message** must reference the user case (e.g. `fix(beautifier): peel stray </b> — GST cfif/cfelse pattern (case #18)`).

## Running locally

```bash
npm test                         # all CI tests, no install or network
node tests/run-tests.js          # formatter VM suite only
node tests/ui.test.js            # UI contract suite only
node tests/tree-sitter.test.mjs  # real vendored WASM suite only
node tools/diagnose-corpus.js    # corpus audit — needs your private sample/sample_cfm/ files
```

CI runs only the first. The second is a developer-only diagnostic.
