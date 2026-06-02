# Changelog

## v7 series (2026-06-02)

### Fix: per-line indenter now counts EVERY tag, not just the line-leading one

Real-world repro: `sample/aic_debug_dashboard.cfm` (a 1,758-line engineer
dashboard). Two distinct indent leaks, both rooted in `beautifyCFML`'s per-line
loop only accounting for the SINGLE tag at line start:

- **Bug #1 — glued raw-block close.** The access-denied page's `<head>` block
  has an inline `<style>` whose `</style>` is glued to the end of a CSS content
  line (`h1{…}</style>`). That line starts with content, so it routed to the
  JS/CSS brace branch and the tag-close path never saw the `</style>` — the
  `<style>`'s `+1` leaked to `</head>`, `<body>` and every following sibling
  (lines 68–84 sat one tab too deep) until a coincidental re-balance. Even with
  Deep CSS on (which re-emits `</style>` cleanly) the downstream leak remained,
  because it originates in the outer pass before deep-format runs.

- **Bug #2 — multi-open markup line.** Packed lines such as
  `<h2>Heatmap <span …>(<cfoutput>#x#</cfoutput>; … <span …>` open THREE blocks
  but were scored `+1`; the three `</span>`/`</h2>` closes then arrived on later
  lines and dragged the whole file's indent DOWN. Sibling panels drifted to
  different columns and the trailing `</main></div></div>` collapsed all the
  way to column 0.

Fix:
- Bug #1: track a `pendingRawClose` for the open `<style>`/`<script>`/`<cfquery>`
  block and settle a LITERAL `</tag>` match wherever it appears (mid-line
  included). A literal match can never false-fire on a `<` operator like `i<n`
  the way a generic tag scan would.
- Bug #2: new `tagIndentDelta(line)` computes the NET block-tag delta over every
  tag on a line via a stack-based scan (so a `>` is matched to the correct
  tag). Guardrails: quotes are string delimiters only inside a tag (apostrophes
  in text like `it's` never desync); inside a tag, a `<` is a nested tag ONLY
  when it begins `<cf…` (the CFML conditional-attribute idiom
  `<option …<cfif C> selected</cfif>>`) or `</…` — any other `<` is a less-than
  operator (`<cfset y = a<b>`); `<!doctype>` and comment spans are net-zero. The
  middle-marker (`<cfelse>`/`<cfelseif>`) display dedent is preserved untouched.

Result on the sample: the access page realigns (`</head>`↔`<head>`, `<p>`↔`</p>`,
all closes match their opens) and the dashboard's trailing
`</main></div></div>` go from a collapsed `T0/T0/T0` to a properly staggered
`T4/T3/T2`. Sample stays idempotent under deep-on and deep-off.

Regression coverage (`tests/run-tests.js`):
- "indent leak Bug #1: glued </style> on a CSS content line no longer leaks +1"
- "indent leak Bug #2: line opening h2 + two spans counts all three"
- "indent guard: `<` inside <cfset> is a less-than operator, NOT a <b> tag"
- "indent guard: CFML conditional-attribute <option …<cfif C> …</cfif>> stays balanced"

### Fix: single-line `<cfelse>...</cfif>` no longer leaks indent

Real-world repro: `sample/ai_chatbox_aic_api.cfm` usage_log_append INSERT —
an inline SQL VALUES list with two `<cfelse>NULL</cfif>` branches. Everything
after the `<cfquery>` (the `<cfset _response>`, `<cfcatch>`, `</cftry>`,
`</cfloop>`, `</cfcase>`) drifted +2 tabs deeper than the rebuilt query block.

Root cause: beautifyCFML's middle-tag handler (CF_TAGS.middle: `<cfelse>` /
`<cfelseif>`) emits the tag at `indentLevel - 1` then `continue`s — which skips
the normal `</cfif>` decrement when the close shares the line (`<cfelse>NULL
</cfif>`). The matching `<cfif>`'s +1 was never undone, leaking +1 indent to
every following line (two such lines → +2). Independent of the comment fixes
above; pre-existing.

Fix: the middle-tag handler now applies the net block-close delta on its line
(`</cfif>` count − `<cfif>` count) before `continue`. `<cfif\b` does not match
`<cfelseif`, so the middle tag itself is not miscounted.

Regression coverage:
- "single-line <cfelse>NULL</cfif> does not leak indent to following lines"

Verified file-wide with a stack-based block-tag indent-pairing oracle (every
`<cftag>` open must align with its `</cftag>`): the pre-fix sample had 9 such
mismatches, the fixed sample has 0; sample remains idempotent.

### Fix: multi-line tag close detection ignores `>` inside CFML/HTML comments

Real-world repro: `sample/ai_chatbox_aic_api.cfm` (the `_msg` struct literal
with a trailing `<!--- 20260529 : regenerate versioning meta --->` annotation).

Same bug class as the 2026-05-14 quoted-string fix below, but for the comment
case that fix did not cover: a continuation line of a multi-line `<cfset _msg
= { ... }>` that ends with a `<!--- … --->` comment had the `>` inside `--->`
mistaken for the closing `>` of the `<cfset>` tag. Because `cfset` is an
`inline` tag, `indentLevel` was popped a level early, collapsing every
following struct key and the closing `}>` toward column 0 — cascading
mis-indentation across large regions.

Fix: `hasTagCloseOutsideStrings` (`js/beautifier.js`) now skips over
`<!--- … --->` (CFML) and `<!-- … -->` (HTML) comment spans, so a `>` inside a
comment is no longer treated as a tag close. Contract-correct — a `>` inside a
comment never was a tag close.

### Fix: CFML comment no longer fused onto the following SQL column

Real-world repro: same file, the `WITH ranked AS (…)` column list
(`regen_group_id,` … `<!--- … --->` … `version_no,`).

Pro SQL masks CFML markup comments as opaque identifier placeholders before
handing the body to the vendored sql-formatter. Because a masked comment looks
like a bare identifier, the formatter glued it to the FOLLOWING token, so after
restore the comment was fused onto the next column: `<!--- … ---> version_no,`.
Whether the author wrote the comment as a trailing annotation or on its own
line is unrecoverable post-format (both mask to the identical token stream), so
the fix gives the comment its own line — never fused to code, never wrongly
re-attached to the previous item.

Fix: new `splitMergedSQLComments` pass in `cleanRestoredCFMLTokenSpacing`
(`js/deep-format.js`) splits a `<!--- … ---> code` line into a standalone
comment line + the code line.

Regression coverage:
- "multi-line cfset struct: trailing <!--- ---> comment does not collapse following lines" (new)
- "deep cfquery preserves cfml comment inside sql body" (expected output updated:
  the masked comment keeps its own line instead of being fused onto the next column)

Verified: full sample is idempotent across both fixes; a trimmed-whitespace diff
of the 2790-line sample (pre-fix vs post-fix) shows the comment-split as the only
non-indentation change.

## v7 series (2026-05-14)

### Fix: multi-line `<cfset>` struct alignment with HTML strings

Real-world repro: `sample/ai_dashboard_inventory_render_kpi.cfm`.
A multi-line `<cfset arrayAppend(..., { ... })>` contains CFML string
values with HTML snippets such as `'<span class="ccy">SGD</span>'`.
The CFML formatter treated the `>` inside those strings as the end of
the outer `<cfset ...` tag, so the remaining struct keys drifted left.

Fix: multi-line tag close detection now ignores `>` inside quoted text.
Inline CFML expression tags also align closing `})>` lines with their
opening `<cfset>` and preserve extra continuation whitespace for wrapped
function arguments.

Regression coverage:
- "multi-line cfset struct ignores html tag close chars inside strings"
- "multi-line cfset struct html-string close is stable with deep format enabled"

### v7.0.1 — block comment re-indent + empty `{}` collapse

Two follow-up fixes to v7.0.0 reported on
sample/ai_chatbox_js_runtime_send.cfm:

**Fix 1: multi-line block comments re-indent on restore.** Same bug
class as the paren-token fix in v7.0.0 (commit 9156ba7) — a multi-line
`/* ... */` block comment, captured as a token by `protectBraceCodeText`,
kept its source's outer-wrap `\t` whitespace verbatim during restore.
When formatBraceCode dedented the surrounding code to top level, the
comment stayed at +1 tab. Result: file-header comment at indent 1
above `var x = 1;` at indent 0.

Fix: extended `restoreBraceCodeText` to detect multi-line block
comments (token starts with `/*`) and re-indent their continuation
lines. Strips the longest common leading TAB sequence (structural
indent) from continuation lines, then prepends the placeholder's
host-line baseIndent. Template literals and regex literals are
restored verbatim (their content is syntactically significant).

Also: `splitLeadingCommentBlock` no longer peels JS `/* */` or `//`
comments into the leading region — those now stay in the body so the
new restore-time re-indent fires. CFML markup `<!--- --->` and HTML
`<!-- -->` are still peeled (formatBraceCode doesn't understand them).

**Fix 2: empty `{}` and `[]` literals stay on one line.** Naive
`{` → `{\n` / `}` → `\n}` rewrites turned `var x = {};` into
`var x = {\n};` (two visually-noisy lines). Sentinel pre-pass replaces
`{}` and `[]` with `__BRACECODE_EMPTY_OBJ__` / `__BRACECODE_EMPTY_ARR__`
before the split, then restores at the end.

Updated one existing test expectation (`'deep script preserves regex
literal with semicolon'` — empty `if(x){}` now stays inline). 4 new
regression tests:
- "multi-line block comment re-indents to match dedented code"
- "empty object literal {} stays inline"
- "empty array literal [] stays inline"
- "empty if body if(x){} stays inline"

### v7.0.0 — bare-JS routing fixes (cumulative tag)

### Fix: `formatBraceCode` re-indents multi-line paren-token content on restore

`protectBraceCodeParens` captures balanced `(...)` groups (including
multi-line `(function() { body })` IIFE / callback patterns) into
opaque tokens so the simple `{`/`}`/`;` splitter can't mangle for-loop
heads or argument lists. On restore, single-line tokens reinsert
cleanly — but **multi-line tokens kept their source's original
whitespace verbatim**, which mis-aligned when the file had outer-wrap
indent that got dedented.

Real-world repro: sample/ai_chatbox_js_runtime_send.cfm — source
wrapped everything at +1 tab (CFML include style). formatBraceCode
correctly dedented top-level statements like
`AgentLog.subscribe(function(evt) { … })` from 1 tab to 0, but the
callback body (inside the paren-token) kept its source's 2 tabs.
Result: wrapper at indent 0 with body at indent 2 — off by one tab,
and the closing `});` landed at indent 1 instead of 0.

Fix: rewrote `restoreBraceCodeParens` to walk each multi-line token's
lines tracking brace depth from 0, applying `baseIndent + depth-tabs`
prefix (where `baseIndent` is the indent of the placeholder's host
line in the output). Lines starting with `}` or `]` pre-decrement so
`})` aligns with its opening `(function() {`. The first line stays
inline with the placeholder (its prefix is owned by the main format
loop, not the restorer). Single-line tokens still use the original
substring replace — zero overhead for the common case.

2 new regression tests:
- "multi-line paren body re-indents to match dedented wrapper"
- "nested multi-line parens stay aligned"

Verified on the user fixture: callback bodies now sit one tab inside
their wrapper; closing `});` aligns with the opening line.

### Fix: regex literal awareness in `hasTagsOutsideStrings` — string parity preserved across `/'/g` patterns

Third variant of the same content-corruption bug class. User-supplied
fixture had a real-world JS function with both:
- A regex literal containing a quote char: `src.domain.replace(/'/g, '')`
- Later, a JS string containing HTML: `html += '<a class="...">link</a>'`

`hasTagsOutsideStrings` already skipped strings + JS comments + CFML/HTML
comments, but did NOT skip regex literals. The `'` inside `/'/g` was
mis-treated as a string start → walker exited at the next real `'` →
string-parity off by one → the `<a` chars in subsequent JS strings were
seen as "outside any string" → flagged as real tags → detectLanguage
returned `'cfml'` → CFML mode corrupted the JS strings.

Fix: port the `lastSig` mechanism that `countBracesOutsideStrings` already
uses (commit 83aea8a). `/` in OPERATOR position opens a regex literal —
scan to matching `/` respecting `\` escapes and `[...]` character classes
where `/` is literal, then consume `gimsuy` flags. `/` in VALUE position
is the division operator.

2 new regression tests:
- "regex literal /...'.../ does not poison string parity in detection"
- "regex with character class [/] does not poison parity"

Verified on the user's fixture: detectLanguage='js', content-preserved
PASS, idempotent PASS, all JS strings + regex literals preserved verbatim.

### Fix: comment-banner-aware detection — CFML markup banner over JS body now routes to `'js'`

The previous string-aware detection fix (same commit day) protected
inline HTML-in-strings but missed the most common real-world pattern:
a `.cfm` file with a CFML markup comment banner (`<!--- ... --->`) at
the top followed by **bare procedural JS** (a `.cfm` include intended
to be sourced into another page that owns the `<script>` boundary).

Symptom: same data-loss-class corruption as before. The CFML walker
hit JS `\'` escapes inside strings → lost track of string boundary →
injected newlines into JS strings mid-literal. Visible damage at
sample/ai_chatbox_js_runtime_send.cfm L108-115 where multi-line
HTML-templating strings became syntactically broken.

Fix (two parts):

1. `hasTagsOutsideStrings` now SKIPS entire `<!--- ... --->` and
   `<!-- ... -->` regions (they're comments, not tag openers). Only
   real `<TAG>` (alpha or `/` after `<`) outside strings/comments is
   treated as a CFML/HTML tag signal.

2. `detectLanguage` calls `splitLeadingCommentBlock(code).body` and
   tests the JS-construct prefix against the **post-banner body**,
   not the raw source. So `<!--- doc header --->\nfunction f() {…}`
   now routes to `'js'`. Real CFML tags AFTER the banner
   (`<cfset>`/`<cfif>`/`<cfquery>`) still route to `'cfml'`.

Verified on the user's actual fixture (`messages_render.cfm` 18KB):
detectLanguage now returns `'js'`, content-preservation invariant
holds, all multi-line JS HTML-templating strings preserved verbatim.

3 new regression tests + 1 updated expectation:

- "leading CFML markup comment banner does NOT block js routing"
  (overrides previous test expectation since the previous behavior
  was the bug — `<!--- header --->\nfunction f()` should be `'js'`)
- "real CFML tags after banner DO route to cfml" (locks correct
  behavior — `<!--- banner --->\n<cfset x = 1>` stays `'cfml'`)
- "real HTML tags route to cfml" (locks `<div>` outside strings →
  `'cfml'`)

### Fix: string-aware tag detection in `detectLanguage` — bare JS with HTML inside strings no longer routes to CFML

User report (sample fixture): a bare JS fragment
```js
if (m.role === 'user') {
    var html = '<div class="x">' + name + '</div>';
    var s2 = ' </div>';
}
```
was misclassified as `'cfml'` because the previous `/<[a-zA-Z!\/]/` test
matched `<div` INSIDE the string literal. CFML mode then ran
`splitAdjacentCFMLTags` which doesn't honor JS `\'` escape semantics —
it lost track of the string boundary and injected newlines before
`</div>` and `</span>`, **producing literal newlines inside JS strings
at runtime**. The output looked plausible but executed broken
(`' </div>'` became `'\n\t\t\t\t</div>'`).

Fix: new helper `hasTagsOutsideStrings(code)` walks the source with JS
lexer state (strings, line/block comments, `\\` and `\'` escapes,
template literals) and reports `true` only for `<` chars that are real
tag openers. `detectLanguage()` now requires BOTH a JS-construct prefix
AND `!hasTagsOutsideStrings(code)` to route to `'js'`. The construct
prefix list also expanded to include common keywords (`if`, `for`,
`while`, `do`, `switch`, `return`, `throw`, `try`) and bare `(` so
real-world JS fragments are not missed.

This is content-corruption-class, not just whitespace drift — added 5
new regression tests in `tests/run-tests.js` covering: HTML inside
single/double-quoted strings, HTML inside `/* */` and `//` comments,
escape-sequence-followed-by-tag, real CFML tags (must still detect
true), tag after JS code outside strings, idempotency on the fix, and
character-level content preservation.

### Fix: balanced brace counter — multi-line JS object literals no longer drift indent

Commit `aa7cb4e`. The CFML beautifier's per-line brace logic for non-tag lines
used `includes("{") && !includes("}")` to decide indent increments/decrements.
That heuristic only fired once for a line containing two trailing `}`, so each
multi-line JS object literal in an array leaked **+1 indent per entry**.

Real-world repro: `sample/ai_chatbox_js_runtime_prompt_catalog.cfm` (a CFML
file containing a bare JS `_g3RuntimeToolCallExampleCatalog()` array of object
literals) drifted to 30+ tabs deep before this fix.

Replaced the heuristic with `countBracesOutsideStrings(line)` — string-aware
balanced counting of `{ [` openers vs `} ]` closers — plus `leadingClosersOf`
for pre-decrement before `applyIndent()`. Algebraically the net change is just
`indentLevel += (openers - closers)`, but pre-decrement matters because the
displayed indent of a line like `} },` must reflect the line's visual depth
(parent level), not the carry-over level.

Two new helpers in `js/beautifier.js`:

- `countBracesOutsideStrings(s)` — per-line `{}` `[]` counter that protects
  strings (single/double/template), line comments, block comments, **and
  regex literals** (see next entry).
- `leadingClosersOf(s)` — counts consecutive leading `}`/`]` for pre-decrement.

### Fix: regex literal awareness in `countBracesOutsideStrings`

Commit `83aea8a`. The brace counter above missed `[` inside regex literals.
Real-world repro: `sample/ai_chatbox_js_runtime_send.cfm` had

```js
var markers = [
    /\n\s*\[OBSERVER CRITIC\b[\s\S]*$/i,
    /\n\s*\[HOST EVIDENCE\b[\s\S]*$/i,
    /\n\s*\[HOST CONTINUATION\b[\s\S]*$/i,
    ...
];
```

Each regex contributed 2 `[` (one escaped literal `\[`, one `[\s\S]` character
class) but only 1 `]` — leaking +3 indent across the file. The closing `}` of
the outer `async function sendMessage()` landed at column 3 instead of 0.

Ported the `lastSig` mechanism from `protectBraceCodeText` in
`js/deep-format.js`: track whether the previous significant token was a
VALUE or OPERATOR. `/` in operator position opens a regex; `/` in value
position is the division operator. Inside the regex, scan to matching `/`
respecting `\` escapes and `[...]` character classes (where `/` is literal),
then consume `gimsuy` flags.

### Feat: `'js'` language mode for bare JS without `<script>` wrapper

Commit `aa7cb4e`. Files that are mostly bare JS with leading CFML/JS comment
banners can now route through `formatBraceCode` (`js/deep-format.js`) — the
robust JS formatter that token-protects template literals, regex literals,
strings, and parenthesized groups.

- New dropdown option `<option value="js">JavaScript</option>` in
  `index.html`.
- `detectLanguage()` routes auto-detected JS-only input (no `<` tag chars
  anywhere) to `'js'`. Conservative: any single `<cf*>` / `<html>` / `<!--`
  keeps the file in `cfml` mode (preserves the compact layout style the
  CFML beautifier produces).
- `formatJsWithLeadingComments()` strips leading `<!---...--->` / `<!-- -->`
  / `/* */` / `// ` comment banner, runs `formatBraceCode` on the JS body,
  and re-prepends the banner verbatim.

### Test: `sample/` idempotency suite

Commit `aa7cb4e`. New `tests/run-tests.js` `runSampleIdempotencySuite()` walks
`sample/*.cfm`, runs `beautifyCodes()` twice on each file, and asserts the
second pass is byte-identical to the first.

- Two variants per file: deep-format-OFF and deep-format-ON.
- Cleanly SKIPs when `sample/` has no `*.cfm` — CI stays green without any
  committed fixture.
- `.gitignore` now keeps the folder visible (via `sample/.gitkeep` +
  `sample/README.md`) but ignores `*.cfm` contents — each developer drops
  their own proprietary fixtures without leaking them to the repo.

Caveat: idempotency is **necessary but not sufficient** to prove alignment is
correct. The regex literal bug above produced an idempotent (wrong) output —
both passes equally drifted. Pair the idempotency check with brace-balance
and content-preservation invariants.

### Test: 10 new unit tests in `tests/run-tests.js`

- 4 brace-counter regression cases (multi-line object literals, `} },`
  multi-close, braces inside strings, regex literal `[\s\S]`).
- 6 `'js'` mode cases (auto-detect picks tag-free JS, stays cfml when `<`
  present, template literal protection, regex literal protection, leading
  CFML comment header preserved, idempotency of `formatBraceCode` output).

All 33+ assertions + 22 content-preservation invariants + 2 sample
idempotency pairs pass.

## v6 series (2026-05-11 → 2026-05-12)

### Tooling: `tools/diagnose-corpus.js` — consolidated corpus audit

Three earlier diagnostic scripts that lived under `sample/` (`_corpus_audit.js`, `_corpus_audit2.js`, `_phase4_targets.js`) were merged into a single committed dev tool at `tools/diagnose-corpus.js` with a proper CLI.

`sample/` is gitignored, so anything dropped there was lost to contributors. Moving the diagnostic into `tools/` means any new sample `.cfm` file dropped under `sample/sample_cfm/` can be audited with one command:

```bash
node tools/diagnose-corpus.js              # full audit table + grand totals
node tools/diagnose-corpus.js --targets    # full body of every Tier 2 verbatim cfquery (Phase 4 candidates)
node tools/diagnose-corpus.js --file foo.cfm
node tools/diagnose-corpus.js --dialect mysql --no-write
```

Features:
- Auto-discovers `*.cfm` under `sample/sample_cfm/` (no hard-coded file list)
- Better classifier (recognizes `SELECT DISTINCT` / `UPDATE` / `INSERT INTO` / `DELETE` / `WITH` / `MERGE` / `TRUNCATE` as Pro SQL signatures; `PRESERVED_AS_FORMATTED` verdict for already-formatted input)
- Non-zero exit when any file throws (CI-friendly)
- Gracefully degrades to Lite-only when `vendor/sql-formatter.min.js` is missing

Verdict taxonomy: `IDENTICAL_NOOP`, `FULL_REFORMAT`, `PHASE3_HOIST_OR_MARKER`, `PRESERVED_AS_FORMATTED`, `TIER2_VERBATIM_NOCASE`, `TIER2_VERBATIM_LITE`, `WHITESPACE_ONLY`, `NO_PRO_SQL_BUT_CHANGED`, `COUNT_MISMATCH`.

Current v18 baseline (15 files, 33,716 lines, 126 cfqueries): 76.2% FULL_REFORMAT, 8.7% PRESERVED_AS_FORMATTED, 6.3% PHASE3_HOIST_OR_MARKER, 5.6% WHITESPACE_ONLY, 2.4% Tier 2 verbatim, 0.8% other — 0 warnings, 0 throws.



### Feat: auto-align badly-indented multi-tag-per-line legacy code

User report: legacy CFML reports often have lines like
`<cfif x><tr height="..."><td width="..." #style_padding#>&nbsp;</td><td width="..." align="right">...` with all tags glued onto a single random-indented line. Even after Phase A's auto-split fixed indent, the multi-tag-per-line still defeated proper alignment.

Rule (C) — split before tag at `>` boundary — broadened from cf-prefixed-only to cover ALL tag opens. Three categories of splittables:
- **OPEN tags** (any `<TAG>` except `<cfqueryparam>`/`<cfargument>`) — split when preceded by `>` (so `<cfif><tr><td>` and `</td><td>` get split between).
- **CFML close tags** (`</cfXXX>`) — split when preceded by `>`.
- **Structural HTML close tags** (`</tr>`, `</table>`, `</thead>`, `</tbody>`, `</tfoot>`, `</html>`, `</head>`, `</body>`, `</ul>`, `</ol>`, `</select>`, `</fieldset>`, `</optgroup>`) — split when preceded by `>` so they align with their opens.
- **Inline close tags** (`</td>`, `</li>`, `</p>`, `</span>`, `</a>`, etc.) deliberately NOT in splittable list — preserves `<td>x</td>`, `<td></td>`, `</td></tr>` patterns. Rule (B) handles the "mixed CFML+HTML close" case (`<cfif>x</cfif>.</td>` → split before `</td>` only when line has `</cfif>`).

### Real-world example (user's `disp_pym1amt` table)

```cfml
INPUT (badly indented, multi-tag glued):
<cfif use_split_payment_yn EQ "y">
[12 tabs]<table>
[13 tabs]<tr><td></td></tr>
[13 tabs]<cfif disp_pym1amt GT 0><tr><td #style_padding#>&nbsp;</td><td>...

OUTPUT (auto-aligned, each tag on own line):
<cfif use_split_payment_yn EQ "y">
\t<table>
\t\t<tr>
\t\t\t<td></td>
\t\t</tr>
\t\t<cfif disp_pym1amt GT 0>
\t\t\t<tr>
\t\t\t\t<td #style_padding#>&nbsp;</td>
\t\t\t\t<td>...
```

Empty `<td></td>` stays inline. `</td>` glued to its content stays inline. Only OPEN tags and structural CONTAINER closes get pulled to own lines.

### Validation

- 115 prior tests + 1 new (empty `<td></td>` preservation) = **116 tests, all green**.
- 14-file corpus: 0 warnings, 0 throws, Pro SQL verdict counts unchanged.
- 365 `</td><td>` patterns in corpus — these now split between cells (each `<td>` on own line). Cleaner output.

`sw.js` `CACHE_VERSION` → `v2026-05-12-16`.

### Feat: auto-split now also handles `<script>`/`<style>` mid-line + `</td>` after CFML closes + `<cfscript>` opaque-skip

User feedback on real-world legacy CFML report: the existing auto-split (CFML tags only) didn't catch the very common pattern of `<td>...&nbsp;<script>JS</script><cfif>x</cfif>.</td>` where script and `</td>` should each be on their own line.

Three new split rules added to `splitAdjacentCFMLTags`:

1. **Always-split before `<script>`/`<style>` (and their closers)** when the current output line has any non-whitespace content. No "must follow `>`" requirement — `&nbsp;<script>` correctly splits even though `&nbsp;` ends with `;`.

2. **Split before HTML close-block tags (`</td>`, `</tr>`, `</table>`, `</div>`, `</li>`, `</ul>`, `</ol>`, `</p>`, `</section>`, `</article>`, `</header>`, `</footer>`, `</nav>`, `</main>`, `</aside>`, `</form>`)** ONLY when the current output line already contains a CFML close tag (`</cfif>`, `</cfelse>`, etc.). This is the targeted signal "mixed CFML+HTML content where the HTML close should be visually separated". Preserves inline `<td>x</td>` and `<td>x</td><td>y</td>` patterns (no CFML close → no split).

3. **`<cfscript>...</cfscript>` is now opaque** (like `<script>`, `<style>`, `<cfquery>`). Embedded `<script>`/`<style>` substrings inside JS line comments (`// ...`) inside `<cfscript>` no longer trigger splits.

### Real-world impact

User's `numberToEnglish` pattern now formats correctly:

```cfml
INPUT:
<td...>desc: &nbsp;<script Language="JavaScript">
    document.write(numberToEnglish('#x#'));
</script>
<cfif set_language is 'english'>Only</cfif>.</td>

OUTPUT:
<td...>desc: &nbsp;
    <script Language="JavaScript">
        document.write(numberToEnglish('#x#'));
    </script>
    <cfif set_language is 'english'>Only</cfif>.
</td>
```

JS body indents to script depth +1 naturally because `<td>` opens depth and `<script>` opens deeper.

### Validation

- 109 prior tests + 6 new (script/style/cfscript/HTML-close-block + real-world `numberToEnglish` pattern) = **115 tests, all green**.
- 14-file corpus (1.9 MB, 30,518 lines, 114 cfqueries): zero warnings, zero throws, all Pro SQL verdict counts unchanged.
- 3,729 inline `<td>x</td>` patterns in corpus stay inline (rule (B) only fires when CFML close is in line).

`sw.js` `CACHE_VERSION` → `v2026-05-12-15`.

### Feat (Phase 4): AND-leaves hoisting — Pattern A cfif trees now get full Pro SQL backbone

The dominant real-world pattern in legacy CFML reports: a `<cfquery>` body with a complete `WHERE base AND base AND base` block followed by multiple `<cfif>` tags that each merely append optional `and xxx` / `or xxx` clauses. Phase 3 (WHERE hoisting) couldn't handle this — it requires every leaf to START with `where`. Phase 4 is Phase 3's dual: every leaf STARTS with `and` or `or`.

Real-world impact (validated on 14-file corpus, 1.9 MB, 30,518 lines, 114 cfqueries): **Phase 4 fixed 5 of 8 Tier 2 verbatim cfqueries**, producing properly formatted SELECT/FROM/WHERE/GROUP BY/ORDER BY backbones with the cfif tree preserved as a sub-tree under WHERE, body lines indented +1 with keywords uppercased. The remaining 3 verbatim cfqueries are explicit out-of-scope patterns (Pattern B: cfif inside parens; Pattern D: cfif appends UNION arm).

New helpers in `js/deep-format.js`:
- `splitCfqueryBodyAtCfifTreeMulti` (captures from FIRST cfif to LAST `</cfif>` at depth 0; differs from Phase 3's splitter that stops at FIRST close)
- `detectAllLeavesStartWithAndOr` (precondition checker)
- `formatPhase4PostFragment` (synthesizes `SELECT 1 FROM t WHERE 1=1 + post` for sql-formatter, then slices off the prefix)

Phase 4 dispatch sits between Phase 3 hoist and Tier 2 verbatim. ANY failure → fall back to Tier 2, zero regression possible.

10 progressive e2e tests (T1–T10) pin the dispatch behavior. T1–T8 exercise Phase 4. T9 verifies Phase 3 still fires first. T10 verifies Pattern D (UNION cfif) safely falls back to Tier 2.

### Pre-existing bug fixed: `normalizeCFMLAttributes` truncated unquoted values with internal whitespace

Found while validating Phase 4 on `fr_fg_vari_qty.cfm`. Pattern: `<cfqueryparam value=#TNOdateformat('#fromday#/#frommth#/#fromyear# ')# cfsqltype="cf_sql_date">`. The unquoted attribute value contained a space INSIDE the `#expression#` (between `#fromyear#` and `')#`), and `normalizeCFMLAttributes` walked "until whitespace" — truncating mid-expression and dropping the rest of the tag.

Fix: when scanning unquoted attribute values, track `#...#` interpolation depth, paren depth, and nested quote state. Whitespace inside an expression now correctly stays part of the value. 1 new e2e regression test (T8b) pins this.

### Validation

- 98 prior tests + 11 new (T1–T10 + T8b) = **109 tests, all green**.
- 14-file corpus: zero warnings, zero throws. TIER2_VERBATIM_LITE drops from 7 → 2 (Phase 4 picked up 5 Pattern A targets).
- Phase 4 v2 design doc (`docs/PHASE4-DESIGN.md`) — algorithm matched implementation exactly.

`sw.js` `CACHE_VERSION` → `v2026-05-12-14`.

### Feat: auto-split adjacent CFML tags on the same source line — multi-`<cfset>` + comment-jammed legacy code now formats cleanly

Real-world legacy CFML often has lines like:

```cfml
<cfset layer_pos_top = 858><!---<cfset layer_pos_top = 758>---><cfset layer_pos_top = 849>
<cfset layer_left = "470px"><cfset layer_left = "478px">    <cfset layer_left = "323px">
<cfif x><cfinclude template="foo.cfm"></cfif>
```

The beautifier preserved these as-is — visually noisy and impossible to skim. New `splitAdjacentCFMLTags(code)` runs as the first pass inside `beautifyCFML` and inserts newlines at every tag-to-tag boundary so each CFML tag lives on its own line:

```cfml
<cfset layer_pos_top = 858>
<!---<cfset layer_pos_top = 758>--->
<cfset layer_pos_top = 849>
<cfset layer_left = "470px">
<cfset layer_left = "478px">
<cfset layer_left = "323px">
<cfif x>
    <cfinclude template="foo.cfm">
</cfif>
```

The split is **default-on, no checkbox** — there is no legitimate visual or semantic reason to glue two `<cfset>` tags together on one line.

### Safety rules

Trigger requires BOTH:
1. Next non-whitespace is `<cf...`, `</cf...`, `<!---` or `<!--` (CFML tag, CFML comment, or HTML comment).
2. Last non-whitespace character on the OUTPUT line is `>` (i.e., we're at a tag-to-tag boundary).

Rule (2) is what protects inline patterns from being broken:

```cfml
<cfif x>1<cfelse>0</cfif>          ← stays on one line (between `1` and `<cfelse>` is content, not `>`)
```

### Opaque blocks (parser is fully transparent — no splitting inside)

- CFML markup comments `<!--- ... --->`
- HTML comments `<!-- ... -->`
- `<script>...</script>` (JS strings can contain anything)
- `<style>...</style>` (CSS)
- `<cfquery>...</cfquery>` (SQL body — `<cfqueryparam>` stays inline)
- Single/double-quoted strings (with SQL `''`/`""` doubled-quote escape)

### Excluded tags (legitimately inline)

- `<cfqueryparam>` — designed to live inline inside SQL
- `<cfargument>` — designed to chain inside `<cffunction>` body

### Validation

- All 90 existing tests still pass.
- 8 new e2e tests for the splitter (T1: simple multi-cfset; T2: cfset + comment + cfset; T3: cfif/cfinclude/cfif close; T4: inline cfif preserved; T5: script block opaque; T6: cfquery+cfqueryparam preserved; T7: cfparam+cfinclude; T8: nested cfif fully split).
- 14-file corpus (1.9 MB / 30,518 lines / 114 cfqueries): zero warnings, zero throws, all 11 sal_inv_view185 cfqueries still FULL_REFORMAT, all Pro SQL verdict counts unchanged.
- Performance: 467ms → 1091ms on full corpus (+624ms for splitter pass on 1.9 MB ≈ 3 MB/s — acceptable for offline format).
- Visual inspection of `sal_inv_view185.beautified.cfm` confirms the screenshot's problem lines (`<cfset layer_pos_top = 858>...` and `<cfset layer_left = "470px">...`) are now properly split.

`sw.js` `CACHE_VERSION` → `v2026-05-11-13`. 98 tests total, green.

### Feat: PRO_SQL_KEYWORDS now covers `AS`, `USING`, `CAST`, `OVER`, `INTERSECT`, `EXCEPT`, `WITHIN GROUP`, `NATURAL JOIN`, etc. — Tier 2 Lite uppercase pass is no longer half-applied

When a `<cfquery>` body contains structural CFML control flow (cfif/cfloop), deep-format takes the **Tier 2 verbatim** path: layout is preserved, but SQL keywords still get uppercased via the Lite pass (`uppercaseSQLKeywordsInProtected`). Until now this list was missing several common SQL keywords — most notably `AS`, the column/table aliasing keyword. Real-world cfqueries like

```cfml
<cfquery name="q">
	SELECT scm.uniquenum_uniq as vehicle_unique, scm.tag_others01 as bank_act_yn
	FROM set_cnpj_main as scm
	INNER JOIN set_cnpj_body as scb ON scm.uniquenum_pri = scb.uniquenum_pri
	<cfif x>WHERE ...<cfelse>WHERE ...</cfif>
</cfquery>
```

came out of the beautifier with `as` still lowercase — visually inconsistent with the uppercase `SELECT`/`FROM`/`WHERE` next to it.

Added: `as`, `using`, `cast`, `over`, `intersect`, `except`, `within group`, `natural join`, `natural left join`, `natural right join`. All entries are word-boundary matched (`\bkw\b`) so none of them collide with column names like `cast_id`, `coverage`, or `as_of_date`.

1 new e2e regression test (Tier 2 verbatim path with cfif inside) — fails if any of `as`/`inner join`/`where`/`from`/`select`/`and`/`or` survives lowercase. 90 tests total, green. `sw.js` `CACHE_VERSION` → `v2026-05-11-12`.

### Fix: CFML strings no longer treat `\"` as an escape — Windows-path strings stop swallowing the closing quote

**Root cause of "13 cfqueries in sample/test.cfm — all skipped, no warning":**
`isInsideCommentOrString` and `findClosingTagOutsideText` both treated `\` as a C/JS-style escape character inside `"..."` strings. CFML / HTML strings do **not** use backslash escapes — `\` is a literal character. A real-world line like

```cfml
<cfset p = replace("..\..\..\#mainstorefld#\contentstore\#cookie.cookcfnunique#\","\\", "\\\\", "ALL")>
```

ends its first string with `\"` — the parser swallowed the closing `"` as "escaped", then continued scanning. Parser parity went off-by-one starting at line 478 and stayed off for the remaining **3868 lines** of the file. Every later `<cfquery>` opener was reported "inside a string" by `replaceEmbeddedBlock`, so it was silently skipped — no Pro SQL, no Lite uppercase, no Phase 2 normalization, not even a console.warn (the catch path is never reached because the dispatch never enters).

Diagnosed by walking quote-state across the actual sample file and finding the longest non-normal run started at line 478 and extended to EOF.

Fix: removed the `if (c == '\\') { i++; continue; }` block from both `isInsideCommentOrString` and `findClosingTagOutsideText`. Both already handle the SQL `''` / `""` doubled-quote escape, which is the only escape mechanism used in CFML/HTML/SQL strings.

After the fix the same 4346-line file now formats all 13 cfqueries through full Pro SQL (PostgreSQL dialect) — SELECT/FROM/WHERE on own lines, columns list-broken, `<cfqueryparam>` lowercased + `cfsqltype` values lowercased.

1 new e2e test pinning the Windows-path pattern (`replace("..\\..\\#x#\\", ...)` followed by a cfquery that must still be deep-formatted). 89 tests total, green. `sw.js` `CACHE_VERSION` → `v2026-05-11-11`.

### Fix: SQL doubled-quote escape (`''`) no longer flips isInsideCommentOrString parity for the rest of the file

**Root cause of "cfquery in 4000-line file doesn't get Pro SQL formatted, but same cfquery alone does":**
`isInsideCommentOrString` walks character-by-character to decide whether an embedded cfquery position is inside a SQL string / comment. The check was asymmetric with `findClosingTagOutsideText`: the closing-tag finder correctly skipped `''` SQL-standard escape (doubled quote = literal quote inside string), but the entry-point check did NOT. Result: any earlier `'it''s'` in the file flipped the quote-state parity for everything after — subsequent cfqueries were judged "inside a string" and **completely skipped by `replaceEmbeddedBlock`** → deep-format never saw them → no Pro SQL, no Phase 1/2/3, no fallback warning, just verbatim passthrough.

Fix: extended `isInsideCommentOrString` to skip `''` (and `""`) when inside a string of the same quote type. Now symmetric with `findClosingTagOutsideText`.

Also added a defensive `console.warn` in the `canUsePro=false` else branch (Pro SQL checkbox on, but engine not ready) so users see why fallback occurred instead of silent verbatim.

1 new e2e test: two consecutive cfqueries where the first has SQL doubled-quote escape; without the fix the second wouldn't be formatted. 88 tests total, green. `sw.js` `CACHE_VERSION` → `v2026-05-11-10`.

### Feat (Phase 3): WHERE hoisting + split-format-recombine — full Pro SQL backbone with cfif preserved

When a cfquery body's cfif tree has every leaf branch starting with `where ` keyword, deep-format now hoists the WHERE keyword OUT of the cfif branches and places a single SQL-formatted `WHERE` before the tree. This unlocks full Pro SQL formatting (SELECT/FROM/WHERE keywords each on their own line, columns list-broken) on the OUTER SQL backbone while preserving the cfif structure as a sub-tree under WHERE.

Algorithm:
1. `splitCfqueryBodyAtCfifTree` slices body into `{pre, treeLines, post}` at the outermost structural cfif boundary.
2. `detectAllLeavesStartWithWhere` verifies every non-tag tree line starts with `where ` — precondition for safe hoisting.
3. `stripWhereFromLeaves` strips the `where ` prefix from each leaf.
4. Format `pre + synthesized 'where'` via sql-formatter (produces uppercase `SELECT`/`FROM`/`WHERE` on own lines).
5. `formatStrippedTree` walks the cfif tree with depth tracking; each cfif at WHERE-body depth, each body line at +1 deeper, with keyword uppercase + `=` spacing normalization applied via `protectCFMLTokens` round-trip.
6. Post-cfif `AND` clauses get keyword uppercase + spacing normalization.
7. Assembled output flows through Phase 2 CFML normalization (tag/attr lowercase, operator uppercase, function camelCase).

If hoisting precondition fails (mixed leaves, not all start with where) or sql-formatter throws, falls through cleanly to Tier 1 marker → Tier 2 verbatim — zero regression risk.

New helpers in `js/deep-format.js`:
- `splitCfqueryBodyAtCfifTree`
- `detectAllLeavesStartWithWhere`
- `stripWhereFromLeaves`
- `formatStrippedTree`
- `normalizeSQLEqualsSpacing` (adds ` = ` around standalone `=`, leaves `<=`, `>=`, `!=`, `==` untouched)
- `repeatTab`

Result on the canonical user sample (cfquery with deeply nested cfif chain dispatching different `WHERE uniquenum_pri = ...` per branch + trailing `AND tag_table_usage`):
- SELECT/FROM/WHERE keywords each on own line
- All 4 columns list-broken
- WHERE hoisted out of cfif tree
- 3 levels of cfif/cfelseif/cfelse preserved with body indented +1 per depth
- `=` spaced around all standalone occurrences (`uniquenum_pri = <cfqueryparam ...>`)
- Phase 2 normalization on top: `IS`/`AND`/`OR`/`EQ`/`NEQ`/`isDefined`/etc.

14 new Phase 3 unit tests (split/detect/strip/formatStrippedTree/normEq) + 1 e2e test (WHERE-cfif hoisting on a 3-branch cfif). 87 tests total, green. `sw.js` `CACHE_VERSION` → `v2026-05-11-9`.

Phase 3 completes the 3-phase Pro SQL expansion (Phase 1 = lite verbatim uppercase, Phase 2 = CFML normalization, Phase 3 = WHERE hoisting). Users now get end-to-end Pro SQL formatting on CFML+SQL templates including WHERE-cfif patterns that were previously impossible.

### Feat (Phase 2): CFML normalization layer — tag/attr lowercase, operator uppercase, function camelCase

When Pro SQL is enabled, every cfquery output path runs through a string-aware CFML normalizer that produces consistent CFML style:

- **Tag names lowercased**: `<CFQUERYPARAM>` → `<cfqueryparam>`, `</CFIF>` → `</cfif>`
- **Attribute names lowercased**: `VALUE=` → `value=`, `CFSQLTYPE=` → `cfsqltype=`
- **cfsqltype CF_SQL_* values lowercased**: `CF_SQL_VARCHAR` → `cf_sql_varchar`
- **Multi-space between attrs → single space**: `<cfqueryparam  value=` → `<cfqueryparam value=`
- **CFML operators uppercased in expression tags** (cfif/cfelseif/cfset/cfreturn): `is`/`or`/`and`/`eq`/`neq`/`lt`/`gt`/`lte`/`gte`/`not`/`mod`/`xor`/`eqv`/`imp`/`contains`/`does not contain`/`is not` → `IS`/`OR`/`AND`/...
- **CFML built-in functions camelCased**: `isdefined` → `isDefined`, `arraylen` → `arrayLen`, `structkeyexists` → `structKeyExists`, `findnocase` → `findNoCase`, `dateformat` → `dateFormat`, `preservesinglequotes` → `PreserveSingleQuotes`, etc. (~50 functions in the lookup table; extensible)

Implementation is **string-aware**: a SQL string literal containing literal text like `'<CFIF>'` is NOT normalized — only real CFML tags outside strings/comments get transformed.

New helpers in `js/deep-format.js`:
- `CFML_OPERATORS` array + `CFML_BUILTIN_FUNCS` table
- `protectExpressionStrings` / `restoreProtectedExpressionStrings`
- `uppercaseCFMLOperators`, `camelCaseCFMLFunctions`
- `normalizeCFMLExpression`, `normalizeCFMLAttributes`
- `normalizeCFMLTagInternals` (single-tag transformer)
- `normalizeCFMLTagsInSafeText` (string-aware text walker)
- `maybeNormalizeCFMLTags` (cfquery handler wrapper)

12 new unit tests covering tag/attr/value case, multi-space, operator uppercase, function camelCase, string-aware safety. 73 tests total, green. `sw.js` `CACHE_VERSION` → `v2026-05-11-8`.

Phase 3 (WHERE hoisting + split-format-recombine) to follow.

### Feat (Phase 1): Lite Pro SQL on verbatim path — SQL keyword uppercasing

When Pro SQL is enabled AND a cfquery body falls through to Tier 2 verbatim (typically WHERE-cfif where marker injection can't form valid SQL), deep-format now applies SQL keyword case normalization to the verbatim body — protectCFMLTokens → case-insensitive uppercase of SELECT/FROM/WHERE/AND/OR/JOIN/etc. → restore. Layout completely preserved; only keywords outside CFML tags and SQL string literals are cased.

- New `PRO_SQL_KEYWORDS` array + `uppercaseSQLKeywordsInProtected(text)` helper in `js/deep-format.js`.
- Multi-word keywords (`order by`, `inner join`, etc.) sorted longest-first so they match before shorter prefixes; internal whitespace normalized to single space.
- 1 new e2e test (Pro SQL on, WHERE-cfif → uppercased keywords, layout preserved).
- `sw.js` `CACHE_VERSION` → `v2026-05-11-7`.

This closes the "Pro SQL toggle does nothing visible on WHERE-cfif" UX gap. Phase 2 (CFML tag/attr/operator normalization) and Phase 3 (WHERE hoisting + split-format-recombine) to follow as separate commits.

### Feat: marker injection — full Pro SQL re-format + cfif structure preserved (SELECT-list cfif)

When Pro SQL is enabled and a cfquery body contains structural CFML control-flow tags AND the user has typed hand-crafted indent, deep-format now uses a **marker-injection** strategy:
- Replace each own-line `<cfif>` / `<cfelseif>` / `<cfelse>` / `<cfloop>` / `<cfswitch>` / `<cfcase>` / `<cfdefaultcase>` / corresponding close tags with column-friendly markers (`__cfm_N__,`) that sql-formatter treats as identifiers in a column list.
- Run sql-formatter — produces full Pro SQL output (uppercase keywords, each column on its own line, normalized spacing) with markers cleanly placed at column-list indent.
- Restore markers to their original CFML tags. Body lines between OPEN and CLOSE/SIBLING are indented +1 tab per nesting depth so cfif branches read as nested under cfif.
- Marker round-trip is verified (orphan markers → depth balanced); on any failure, falls through to verbatim path (no regression risk).

User-visible result for SELECT-list cfif:
```cfml
<cfquery>
    SELECT
        creditterm_sales_unique,
        creditterm_sales_desc,
        <cfif x>
            delivmode_sales_unique,
            delivmode_sales_desc,
        </cfif>
        var_25_004
    FROM adm_cnt_main
    WHERE companyfn = <cfqueryparam ...>
</cfquery>
```

WHERE-clause cfif (where markers can't form valid SQL) silently falls through to Tier 2 verbatim — same correct behavior as before.

New helpers in `js/deep-format.js`: `classifyStructuralCFMLTag`, `protectStructuralCFMLAsColumnMarkers`, `restoreStructuralCFMLMarkers`. 8 new unit tests + 1 end-to-end integration test (loads vendored sql-formatter into vm context). 60 tests total, all green. `sw.js` `CACHE_VERSION` → `v2026-05-11-6`. `docs/LIMITATIONS.md` rewritten as four-tier dispatch.

### Fix: preserve user-crafted multi-line subquery indent inside structural cfif

Follow-up to the structural-cfif fix. The previous version trusted `beautifyCFML`'s post-pass body, which line-normalized continuation lines (e.g., multi-line `(SELECT ... FROM ... WHERE ...)` subqueries) to the same depth as the line above them — flattening the user's hand-crafted visual hierarchy.

- New: `deepFormatEmbedded` accepts a 3rd `originalSource` argument; `js/beautifier.js` now passes `rawCode`.
- New helpers in `js/deep-format.js`:
  - `extractAllCfqueryBodies(source)` — collects every cfquery body from the original (pre-beautifyCFML) source via `replaceEmbeddedBlock`'s tag-aware extractor.
  - `bodyHasUserIndent(body)` — true if any non-empty body line has any leading whitespace.
- cfquery handler now branches three ways:
  1. **structural cfif + user indent** → take the original body verbatim, only adjust leading common whitespace.
  2. **structural cfif + flat input** → fall back to `beautifyCFML`'s nested output (auto-derives cfif depth — keeps existing test passing).
  3. **inline cfif or no cfif** → original deep-format path (SQL keyword-casing, list-break, etc.).
- 3 new tests: hand-crafted subquery indent preserved, cfml-comment between cfif siblings stays aligned, plus the existing flat-input test still passes.
- `sw.js` `CACHE_VERSION` → `v2026-05-11-5`.
- `docs/LIMITATIONS.md` rewritten for the three modes.

### Fix: structural CFML control flow inside `<cfquery>` no longer scrambled
- Both `beautifySQL` (tokenizer) and `formatProSQLSync` (AST) treat protected CFML placeholders as plain identifiers and would inline `<cfif>`/`<cfelseif>`/`<cfelse>`/`</cfif>` onto random SQL lines, breaking the conditional layout.
- Added `bodyHasStructuralCFMLControlFlow` in `js/deep-format.js`: detects CFML control-flow tags occupying their own line (line-based regex). When detected in a cfquery body, deep-format **skips the SQL formatter entirely** and returns the body verbatim, trusting `beautifyCFML`'s outer indentation pass which correctly handles CFML conditional nesting.
- Inline cases (e.g., `WHERE x = 1 <cfif y>AND z = 2</cfif>` on one line) are NOT considered structural and continue through deep-format unchanged.
- Same detector also gates direct SQL mode (`Language=SQL` + Pro SQL on) — falls back to built-in `beautifySQL` if structural CFML control flow is pasted as raw SQL.
- Tests: 11 new structural-control-flow detector unit tests + 2 end-to-end router tests covering nested cfif preservation. Total now 51, all green.
- `sw.js` `CACHE_VERSION` bumped to `v2026-05-11-4`.
- `docs/LIMITATIONS.md` rewritten for this case to document the structural vs inline split.

### Pro SQL — opt-in multi-dialect formatter
- Vendored `sql-formatter@15.7.3` (MIT) UMD bundle to `vendor/sql-formatter.min.js` (~312KB). Loaded lazily via dynamic `<script>` injection only when the user ticks "Pro SQL".
- Added `js/pro-sql.js` — `PRO_SQL_DIALECTS` (16 dialects), `ensureProSQL()` (idempotent loader returning a cached Promise), `formatProSQLSync()` (wrapper with sane defaults: keywordCase upper, dataTypeCase upper, useTabs, tabWidth 4).
- `index.html` adds **Pro SQL** checkbox + **dialect** select (Standard, MySQL, MariaDB, PostgreSQL, SQLite, T-SQL, PL/SQL, DB2, Redshift, Snowflake, BigQuery, Hive, Spark, Trino, N1QL, SingleStoreDB).
- `styles.css` uses `:has(#pro_sql:checked)` to reveal the dialect select only when Pro SQL is on.
- `js/beautifier.js` and `js/deep-format.js` route to `formatProSQLSync` when Pro SQL is enabled, falling back to the built-in `beautifySQL` if the bundle fails to load or the dialect parser throws — guarantees zero regression for existing users.
- `sw.js` precaches `./vendor/sql-formatter.min.js` and `./js/pro-sql.js`; `CACHE_VERSION` bumped to `v2026-05-11-2`.
- `tests/run-tests.js` adds 6 Pro SQL smoke tests (dialect count, MySQL select, PostgreSQL order by, unknown-dialect fallback, all 16 dialects accept simple SELECT). All green.

### PWA + iOS safe area + SVG favicon + GitHub Actions
- Added `manifest.webmanifest` (standalone display, theme color `#28a745`, SVG icon).
- Added `sw.js` service worker — network-first for HTML (always latest source), stale-while-revalidate for assets, cache version `v2026-05-11-1`.
- Added `js/pwa.js` — registers SW, auto-updates on `visibilitychange` + hourly, force-reloads page once on `controllerchange` so users never get stuck on stale build.
- Added `favicon.svg` (CF monogram on brand-green tile, scales for any density).
- `index.html`: added `viewport-fit=cover`, `apple-mobile-web-app-*` meta, `theme-color` light/dark, `<link rel="icon" type="image/svg+xml">`, manifest link, SW registration script.
- `styles.css`: full theming via CSS custom properties; `prefers-color-scheme: dark` palette; `prefers-reduced-motion` honored; `env(safe-area-inset-*)` on body + toast container for iOS notch / home-indicator; `--tap: 44px` minimum hit target on buttons & select; mobile textarea font lifted to 16px to suppress iOS zoom; native-themed checkbox via `accent-color`.
- Added `.github/workflows/deploy.yml` — runs `node tests/run-tests.js` then publishes via `actions/deploy-pages@v4`. Requires repo Settings → Pages → Source = "GitHub Actions".

## v5 series (2026-04-24)

### `27aabc7` — Deep JS production upgrade
- Promoted Deep JS from beta to default-on.
- `protectBraceCodeText` rewritten: string line-break safety, regex literal detection (context-aware), template literal with `${…}` nesting, preserved line/block comments.
- Added `protectBraceCodeParens` so `for (i = 0; i < n; i++)` and function argument lists keep their semicolons and commas.
- New tests: HTML strings with `;` and apostrophes, for-loop semicolons, template literals, regex literals.

### `8f4dbae` — Split Deep format into SQL / CSS / JS
- Three independent checkboxes replace the single `deep_format` control.
- SQL and CSS default on; JS initially shipped as beta-off, then promoted in `27aabc7`.

### `437eac4` — CFML comment protection + auto-clear-output
- `protectCFMLTokens` now matches `<!--- … --->` and walks string literals first so `'</cfquery>'` inside a SQL string stays literal.
- Multi-line `<!--- … --->` / `/* … */` keep their indent inside `beautifyCFML`.
- `cleanRestoredCFMLTokenSpacing` normalizes `<cf*>AND(` to `<cf*>AND (`.
- Added `auto_clear_output` checkbox; clearing only happens if the copy succeeded.

### `a5f62df` — Split auto-copy-and-clear
- Previous single `auto_copy_n_clear_bcontent` checkbox split into independent `auto_copy` and `auto_clear` checkboxes (both default on).

### `70ed87b` — CASE-internal AND/OR + token merging
- Major-clause matching skipped inside `caseLevel > 0`, so `WHEN x = 'a' AND y > 1 THEN …` stays inline.
- `protectCFMLTokens` pads placeholders with spaces so `<cfif>AND` does not merge into a single tokenizer word.

### `de4f5f5` — SQL edge cases
- Window functions: major clauses stay inline inside `funcDepth > 0`, so `OVER (PARTITION BY … ORDER BY …)` is one line.
- `needsSpaceBefore('(')` rewritten: no space when preceded by an identifier (function call), space when preceded by a SQL keyword, and `needsLeadingSpace` flag on the token for subquery / `INSERT INTO` column-list parens.
- Tokenizer: unary `+` / `-` followed by a digit merges into a signed number when the previous token is an operator, `(`, `,`, `[`, or a boolean/clause keyword.
- `OVER` and `PARTITION` added to `SQL_UPPERCASE_KEYWORDS`.

### `c082ac9` — list-break, BETWEEN...AND, CASE...END
- SELECT / GROUP BY / ORDER BY / VALUES break on top-level commas with persistent `listItemIndent`.
- `funcDepth` counter tracks non-subquery parens so `COUNT(a, b)` / `CAST(x AS INT)` stay inline.
- `BETWEEN … AND …` no longer split; `inBetween` flag consumes the next `AND`.
- `CASE … WHEN … THEN … ELSE … END` formatted as multi-line block via `caseLevel` counter.
- Subquery scope saves/restores `currentClause`, `caseLevel`, `listItemIndent`, `inBetween`.

### `3c30e92` — Deep format pipeline
- `deepFormatEmbedded` scans `<cfquery>` / `<script>` / `<style>` blocks and runs the matching formatter on each body.
- CFML token protection: `<cfqueryparam>`, `<cf*>` tags, and `#var#` replaced with placeholders during SQL formatting.
- `<script src="…">` and non-JS `type="…"` values skipped.
- Embedded content indented one tab deeper than parent tag.

### `ee0cd9e` — SQL scaffolding (MySQL + PostgreSQL)
- `js/sql-keywords.js` + `js/sql-beautifier.js` built around a character-walking tokenizer.
- Language selector dropdown (Auto / CFML / SQL).
- `beautifyCodes` became a router that dispatches to `beautifyCFML` or `beautifySQL`.
- Base SQL features: major-clause newlines, keyword uppercasing, string / identifier / comment protection, operator normalization (`::`, `->`, `->>`, `<=`, `>=`, `!=`, `<>`).

### `cf124be` — UI fullscreen + CFML tag refactor
- Viewport-filling layout with CSS Grid + flex (input on left, output on right).
- CFML tag classification extracted into `js/cf-tags.js` (inline / block / middle + HTML void tags).
- `cfelse` / `cfelseif` middle-tag handling: decrement then re-increment indent so inner content stays aligned.
- Modularized scripts into `js/` directory.
