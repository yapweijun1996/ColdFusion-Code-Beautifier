# Testing

## Running the suite

```bash
npm test          # runs BOTH suites (run-tests.js && tree-sitter.test.mjs)
# or individually:
node tests/run-tests.js          # VM-harness suite
node tests/tree-sitter.test.mjs  # standalone Semantic Indent suite
```

`tests/run-tests.js` loads every script in `js/` inside a Node `vm` context with a faked DOM, then runs `assertEqual` cases. On success it prints `All tests passed.`; on failure it prints `FAIL: <name>` with actual vs. expected and sets a non-zero exit code.

## Helper functions

| Helper | What it exercises |
|---|---|
| `runSQL(input)` | `beautifySQL` in isolation, language forced to `sql`. |
| `runRouter(input, language, deepFormat)` | Full `beautifyCodes` pipeline. `deepFormat` flips all three deep checkboxes on or off together. |
| `runRouterWithAutoCopy(input, language, deepFormat)` | Same as above but with `auto_copy` checked. |
| `runRouterWithAutoClears(input, language, deepFormat, copyResult)` | Exercises `auto_clear` and `auto_clear_output` behavior; `copyResult = false` simulates a failed `execCommand('copy')`. |

## Browser smoke test

For UI-level checks that the harness cannot reach (clipboard, language-selector DOM, toast animations):

1. Open `index.html` in a browser.
2. Paste a known-good CFML file.
3. Toggle `Deep SQL`, `Deep CSS`, `Deep JS` individually and verify only the matching embedded language changes.
4. Confirm `Auto copy`, `Auto clear input`, `Auto clear output` behave as named.

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

## Regression-check philosophy

- Every fix commit ships at least one new test covering the pattern the fix targets.
- Existing tests never change expected output without a written justification in the commit message.
- Tests lock behavior, not implementation; rewriting a formatter internal should leave the suite green.
