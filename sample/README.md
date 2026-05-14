# sample/

Local-only test fixtures. The folder is committed so the idempotency test
in [`tests/run-tests.js`](../tests/run-tests.js) always has a directory to
read from, but the `*.cfm` fixtures inside are **gitignored** — each
developer drops their own real-world inputs here without polluting the
repo or leaking proprietary code.

## What the test does

`tests/run-tests.js` walks `sample/*.cfm`, runs `beautifyCodes()` twice on
each file, and asserts the second pass is byte-identical to the first
(idempotency). This catches regressions like the multi-line JS object
literal indent drift fixed in the 2026-05-14 commit, where each array
entry leaked +1 of indent because the per-line brace counter wasn't
balanced.

If `sample/` is empty, the test logs `SKIP idempotency (no *.cfm in
sample/)` and proceeds — CI stays green without fixtures.

## Adding your own fixture

Drop any `.cfm` file in here. It's ignored by git, so privacy is intact.
The next `node tests/run-tests.js` will pick it up automatically.

## Whitelisted (committed) files

- `.gitkeep` — keeps the folder visible to git
- `README.md` — this file
