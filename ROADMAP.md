# Beautifier Refactor Roadmap

## Current position

```text
R0 Documentation baseline       DONE
R1 Characterization baseline    NEXT
R2 VM harness consolidation     PENDING
R3 Indent utility extraction    PENDING
R4 Lexer convergence            PENDING
R5 Structure extraction         PENDING
R6 CFML state decomposition     PENDING
R7 Core/router separation       PENDING
R8 Cleanup and release          PENDING
```

The current source tree is the behavioral baseline. `js/cfml-comment-utils.js` already exists as a shared depth-aware nested-comment scanner; the other target decomposition modules do not yet exist.

## R0 — Documentation baseline

**Status:** Done

Deliverables:

- design, specification, epic, roadmap, and task records;
- current architecture and recent hardening documented;
- requirements, dependencies, risk, blockers, and acceptance gates aligned;
- stale default/test-count/PWA statements corrected in related docs.

Exit gate: documents agree that the shared comment/encoding hardening is current while the broader decomposition has not started, and code/tests remain authoritative.

## R1 — Characterization baseline

**Status:** Next

Deliverables:

- tracked synthetic fixtures for mixed CFML/HTML, malformed tags, nested CFML comments, structural SQL, deep JS with CFML, regex/division, templates, continuation alignment, LF/CRLF output, and UTF-8/UTF-16 CLI round trips;
- golden outputs for current implementation;
- idempotency and content-preservation checks;
- direct tests for routed line-ending restoration, source encoding/BOM preservation, and markup-comment helpers;
- public-global compatibility checks;
- initial warm performance baseline.

Exit gate:

- `npm test` passes;
- each refactor-critical behavior has an exact-output oracle;
- no private sample data is committed.

## R2 — Node VM harness consolidation

**Status:** Pending; depends on R1

Deliverables:

- one Node-only production script manifest;
- one reusable VM formatter loader for tests/tools where practical;
- shared nested-comment scanner available to host-side diagnostics as well as their formatter VM;
- CLI, formatter tests, Tree-sitter harness, and diagnostics migrated;
- UI Promise test changed from source-regex coupling to runtime behavior.

Exit gate: browser, VM, and CLI execute the same ordered production graph and all existing outputs remain unchanged.

## R3 — Indentation utility extraction

**Status:** Pending; depends on R2

Deliverables:

- `js/format-indent-utils.js`;
- leading-prefix, normalize-indent, continuation classifier, and post-pass functions moved without algorithm changes;
- HTML/SW/VM load lists updated.

Exit gate: exact golden output and all continuation/normalization tests pass.

## R4 — Lexer convergence

**Status:** Pending; depends on R3

Deliverables:

- reuse `scanJSRegexLiteralEnd` and regex-context logic from `js/js-lexer-utils.js` where semantics match;
- coverage for keyword regex contexts, division, character classes, escapes, flags, comments, and templates;
- documented JS-vs-CFScript escape options.

Exit gate: language detection, brace counting, deep JS token protection, and splitter behavior remain byte-compatible.

## R5 — CFML/HTML structure extraction

**Status:** Pending; depends on R4

Deliverables:

- `js/cfml-structure.js`;
- tag close scanners, event lexer, named stack, sibling markers, and optional end-tag logic extracted;
- direct structural unit tests.

Exit gate: malformed hierarchy, packed tags, embedded CF tags, raw blocks, and multi-line tags retain current output.

## R6 — CFML formatter state decomposition

**Status:** Pending; depends on R5

Deliverables:

- `js/cfml-formatter.js`;
- explicit context object introduced first;
- ordered line handlers extracted one at a time;
- unified output emitters for canonical, preserved-prefix, and blank lines.

Exit gate: all golden, idempotency, content, CLI, and Tree-sitter integration tests pass after every handler extraction.

## R7 — Language/core/router separation

**Status:** Pending; depends on R6

Deliverables:

- `js/language-detector.js` with no DOM dependency;
- `js/formatter-core.js` with options-based pure loaded-resource routing;
- `js/beautifier.js` reduced to DOM capture, preloading, stale protection, commit/clear/copy, and compatibility wrappers;
- legacy positional API facade retained.

Exit gate:

- synchronous no-preload output remains immediate;
- all paths return a Promise;
- async stale-request tests pass;
- CLI/browser parity passes.

## R8 — Cleanup, documentation, and release

**Status:** Pending; depends on R7

Deliverables:

- remove only verified dead variables/branches;
- no duplicate script lists in Node harnesses;
- final architecture/file maps and task statuses updated;
- PWA precache complete and cache version bumped for release;
- browser smoke test and performance comparison recorded.

Exit gate: epic definition of done is met.

## Scheduling and priority rules

1. Production data-loss/correctness bugs preempt this roadmap.
2. A bug fix must be separate from module movement.
3. No phase starts before the previous exit gate passes.
4. If a phase causes unexplained output drift, stop and revert rather than updating golden output.
5. R1 is the best next action because it reduces risk for every later phase.

## Deferred opportunities

After this epic, separate proposals may evaluate:

- an internal namespace to reduce global pollution;
- a direct pure API for CLI, removing its DOM double;
- stronger token-aware semantic equivalence checks;
- a build/module migration;
- broader parser-backed formatting.

None are dependencies for the current roadmap.
