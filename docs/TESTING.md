# Testing

## Running the suite

```bash
npm test          # runs formatter, UI-contract, CLI, and Tree-sitter suites
# or individually:
node tests/run-tests.js          # VM-harness formatter suite
node tests/ui.test.js            # static HTML + editor interaction suite
node tests/cli.test.js            # Node CLI end-to-end suite
node tests/tree-sitter.test.mjs  # standalone Semantic Indent suite
```

`tests/run-tests.js` loads production formatter scripts inside a Node `vm` context with a faked DOM. In the current working tree it contains 246 exact `assertEqual` call sites, 22 content-preservation invariants, and 27 Pro SQL token-equivalence cases. `tests/ui.test.js` uses a separate minimal DOM double because the editor event layer is browser-facing. On success the suites print `All ... tests passed.`; on failure they print a named failure and set a non-zero exit code.

## Helper functions

| Helper | What it exercises |
|---|---|
| `runSQL(input)` | `beautifySQL` in isolation, language forced to `sql`. |
| `runRouter(input, language, deepFormat)` | Full `beautifyCodes` pipeline. `deepFormat` flips all three deep checkboxes on or off together. |
| `runRouterWithAutoCopy(input, language, deepFormat)` | Same as above but with `auto_copy` checked. |
| `runRouterWithAutoClears(input, language, deepFormat, copyResult)` | Exercises `auto_clear` and `auto_clear_output` behavior; `copyResult = false` simulates a failed `execCommand('copy')`. |

## UI contract suite

`tests/ui.test.js` verifies the static HTML contract (landmarks, labels, no inline
handlers, deferred dependency order, default options, and service-worker
precache) plus the browser-facing editor behavior (button delegation,
Control/Command+Enter, Tab/Shift-Tab, Escape-to-exit, async busy state, and
user-controlled PWA update/draft recovery). It intentionally has no jsdom or
network dependency.

## Browser smoke test

For UI-level checks that the harness cannot reach (clipboard, language-selector DOM, toast animations):

1. Open `index.html` in a browser.
2. Paste a known-good CFML file.
3. Toggle `Deep SQL`, `Deep CSS`, `Deep JS` individually and verify only the matching embedded language changes.
4. Confirm `Auto copy` is on by default while `Auto clear input` and `Auto clear output` are off by default; enable the latter two and verify their explicit behavior.
5. While Pro SQL or Semantic Indent is loading, verify Beautify is disabled and returns to normal after success or fallback.
6. Verify Tab/Shift-Tab indentation, Escape then Tab focus exit, and Control/Command+Enter.
7. Deploy a changed `sw.js`/`CACHE_VERSION`, wait for the new worker to install, verify **Update now** appears, and confirm input is restored after activation. Test once with another tab accepting the update and verify the other tab offers **Reload now** instead of reloading automatically.

## Adding a test

Append an `assertEqual` block before the final `if (!process.exitCode)`:

```js
assertEqual(
    'short-name-describing-case',
    runSQL('…input…'),
    '…expected output…'
);
```

Use `\n` for line breaks and `\t` for tabs in expected strings. When debugging, tabs print as `->` so differences are visible.

## Sample idempotency suite

`tests/run-tests.js` `runSampleIdempotencySuite()` walks `sample/*.cfm`,
beautifies each file twice (in both deep-OFF and deep-ON modes), and
asserts `pass2 === pass1` byte-by-byte. Logs `PASS sample idempotency: N
file/mode pairs across M fixture(s)` on success, or `FAIL idempotency:
<file> (deep=...)` with a line-level diff on failure.

**Folder convention**:

```
sample/.gitkeep        ← committed, keeps folder visible to git
sample/README.md       ← committed, developer-facing instructions
sample/*.cfm           ← gitignored — drop YOUR proprietary fixtures here
```

Empty `sample/` triggers `SKIP idempotency (no *.cfm in sample/) — drop a
fixture to enable`; CI stays green without any committed fixture. Drop one
`.cfm` locally and the regression catch activates automatically.

**Caveat: idempotency is necessary but not sufficient.** A wrong-but-stable
indent will pass the suite. The regex literal bug fixed in commit `83aea8a`
was idempotent on `sample/ai_chatbox_js_runtime_send.cfm` BUT mis-aligned
the file's final `}` by 3 tabs. To catch alignment bugs that pass through
idempotency, also verify:

- **Brace balance**: count `{` vs `}` (string + comment + regex aware) on
  the output — must equal 0 at EOF.
- **Top-level anchor**: for a file whose source has a known top-level
  `function name() {`, assert its matching `}` lands at column 0.
- **Content preservation**: `normalize(input) === normalize(output)` where
  `normalize` collapses whitespace and lowercases — same invariant used by
  `assertContentPreserved` at the bottom of `run-tests.js`.

## Semantic Indent suite (`tests/tree-sitter.test.mjs`)

The tree-sitter Semantic Indent path **cannot** be tested inside `run-tests.js`:
the VM harness has no `window` / WebAssembly, so the post-pass never fires there.
This standalone ESM suite builds real `cfml` and `cfscript` parsers from the
vendored WASM (`vendor/tree-sitter/`) and exercises the algorithm + post-pass
directly. It self-contains its fixtures (no dependency on the gitignored
`sample/`), so it runs on a fresh clone after `npm install` is **not** even
required — the grammars are committed.

Coverage (grouped):

- **A** — hierarchy fires for nested call chains; struct / SQL-string / plain-arg
  blocks stay flat.
- **B** — per-line tab depths + multi-level single-line close aligns to the
  outermost opener.
- **C** — post-pass on **real beautifier output** (cfif-in-string): parses clean,
  one-tab-per-level, content preserved.
- **D** — `hasError` guard: idempotency across the mechanism switch (D1) and an
  unbalanced block left untouched (D2).
- **E** — full 10-line **branched** sample (close-then-sibling-open): opening
  hierarchy, sibling returns to the right level, idempotent.
- **F** — cfscript: per-statement factor (F1), content base + nested stepping
  (F2/F3), content preserved (F4), untouched when the cfscript parser is absent
  (F5), REPLACE-path idempotency (F6), control-structure block left identical to
  the line-scanner + that skip path idempotent (F7/F7b), and a struct literal in
  cfscript stays flat (F8).

When you change `js/tree-sitter-cfml.js`, add the regression case here, not in
`run-tests.js`. If you refresh a vendored grammar (see
`vendor/tree-sitter/README.md`), re-run this suite — a grammar bump can shift
node names or recovery behavior and these assertions are the guard.

## Current hardening coverage

Recent baseline regressions explicitly cover:

- nested CFML comments consume the outer close and keep commented tags opaque to splitting/outer indentation, while code-looking multiline CFML comments are internally aligned by a separate idempotent pass;
- CLI UTF-16BE BOM preservation together with CRLF formatted output;
- multi-line structural CFML tags normalized before query fallback;
- `<cfquery>` closing tags containing whitespace before `>`;
- Pro SQL structural-query idempotency through the CLI;
- own-line and nested CFML control tags inside deep-formatted JavaScript;
- JavaScript emitted directly inside a CFML conditional;
- multi-line template payload indentation/content preservation;
- executable legacy script wrappers using `<!--` and `//-->`;
- adjacent CFML comments, nested commented code, prose-only comments, and ordinary HTML comments.

## Refactor characterization policy

The planned decomposition in root `ROADMAP.md` starts by adding tracked synthetic golden fixtures. Refactor commits must preserve those outputs byte-for-byte and must not edit expected output unless the change is split into a separately reviewed bug fix.

For each refactor-critical fixture, test exact output plus applicable idempotency, content/token preservation, and JS string-break invariants. Keep private `sample/*.cfm` local; tracked fixtures must be synthetic.

A Node-only shared production-script manifest is planned but not implemented. Until then, adding a production script requires updating every explicit browser/VM/CLI load list described in `docs/ARCHITECTURE.md`. The new comment utility has been added to those lists.

No known gaps remain in this hardening matrix. The broader characterization-fixture and formatter-module extraction tasks remain tracked in root `TASK.md`.

## Regression-check philosophy

- Every fix commit ships at least one new test covering the pattern the fix targets.
- Existing tests never change expected output without a written justification in the commit message.
- Tests lock behavior, not implementation; rewriting a formatter internal should leave the suite green.
- Module movement and behavior changes belong in separate commits.
- Any unexplained golden-output drift blocks the refactor phase; do not normalize it by updating fixtures.
