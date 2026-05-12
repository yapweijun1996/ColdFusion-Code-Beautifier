# CI Test Policy — User Cases as Pinned Regression

## Privacy contract

The `sample/` directory is **gitignored** and holds private `.cfm` files supplied by users for local diagnosis. **Sample files are never committed, never cloned by CI, never shared.**

- `.github/workflows/test.yml` runs `node tests/run-tests.js` against tracked-only sources. `actions/checkout` cannot pull `sample/` because it isn't in the repo.
- `.github/workflows/test.yml` has an explicit guard step: if any `*.cfm` ever appears under `sample/` in the checked-out tree (e.g. someone forgot to gitignore), the CI fails loudly before tests run.
- `tools/diagnose-corpus.js` reads from `sample/sample_cfm/` **locally only**. CI never invokes it.

## The rule

> **Every user-reported bug becomes a sanitized pinned test in `tests/run-tests.js` before the fix lands.**

The pinned test must:
1. Use a **synthetic input** that reproduces the structural bug pattern. Strip proprietary table / column names down to generic placeholders only when they carry business context; structural names (`disp_pym1amt`, `comain_gst_name`, `qs_sr_nums`) that already match the open-source app domain are fine to keep verbatim.
2. Include a **named description** in the first arg to `assertEqual` that calls out the user-reported scenario (so a future reader sees "this exists because user X reported Y").
3. **Live in `tests/run-tests.js`** — no external file deps, no `require('./sample/...')`.

When CI runs (`node tests/run-tests.js`):
- All pinned tests run with hard assertions.
- Any failure exits non-zero, blocking the merge / deploy.
- Total runtime is < 5 seconds with no network or install.

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

## How to add a new user case

1. **Receive the bug report** — usually a screenshot or pasted snippet, plus the user's expected output.
2. **Sanitize the input** — drop genuinely proprietary identifiers (real customer names, real product codes) and keep structural ones. The shape of the bug must survive sanitization.
3. **Write a failing pinned test FIRST** — add an `assertEqual` to `tests/run-tests.js` with a descriptive name. Run `node tests/run-tests.js` and confirm the FAIL message matches the user's report.
4. **Fix the source code** until the test passes and no other test regresses.
5. **Append the case to the inventory table above** — pick the next `#` and document the scenario.
6. **Commit message** must reference the user case (e.g. `fix(beautifier): peel stray </b> — GST cfif/cfelse pattern (case #18)`).

## Running locally

```bash
node tests/run-tests.js          # all tests, < 5 seconds, no install
node tools/diagnose-corpus.js    # corpus audit — needs your private sample/sample_cfm/ files
```

CI runs only the first. The second is a developer-only diagnostic.
