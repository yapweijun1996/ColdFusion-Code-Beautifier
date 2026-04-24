# Testing

## Running the suite

```bash
node tests/run-tests.js
```

The harness loads every script in `js/` inside a Node `vm` context with a faked DOM, then runs `assertEqual` cases. On success it prints `All tests passed.`; on failure it prints `FAIL: <name>` with actual vs. expected and sets a non-zero exit code.

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

## Regression-check philosophy

- Every fix commit ships at least one new test covering the pattern the fix targets.
- Existing tests never change expected output without a written justification in the commit message.
- Tests lock behavior, not implementation; rewriting a formatter internal should leave the suite green.
