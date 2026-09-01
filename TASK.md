# Task Register

## Status summary

- **Current source baseline:** current `main`; full `npm test` passes with the completed nested-comment/encoding hardening.
- **Latest product hardening:** depth-aware nested CFML comments, routed CRLF restoration, UTF-8/BOM-marked UTF-16 CLI encoding preservation, structural SQL fixed-point alignment, whitespace-tolerant raw closes, deep-JS CFML depth, bare-JS fragments in CFML, multi-line templates, and legacy script wrappers are present.
- **Refactor epic:** planned; production-code extraction has not started.
- **Next task:** `R01`, characterization/golden baseline.
- **External blockers:** none.
- **Sequencing blocker:** R02+ must not start until R01 passes.
- **Known coverage/tooling gaps:** none in the current hardening matrix. Remaining work is the tracked characterization-fixture and module-extraction sequence.
- **Privacy constraint:** tracked/CI fixtures must be synthetic; private `sample/*.cfm` remains ignored.

Machine-readable status is mirrored in [task.jsonl](task.jsonl).

## Refactor tasks

| ID | Phase | Priority | Task | Depends on | Status |
|---|---|:-:|---|---|---|
| R00 | Docs | P0 | Align design/spec/epic/roadmap/task and related documentation with current code | — | done |
| R01 | Baseline | P0 | Add synthetic characterization fixtures and locked golden outputs | R00 | pending / next |
| R02 | Baseline | P0 | Add exact output, idempotency, content, public-global, string-break, LF/CRLF, and encoding/BOM gates | R01 | pending |
| R03 | Harness | P1 | Centralize Node VM script loader and import shared comment scanner into host diagnostics | R02 | partial — shared comment import done; loader consolidation pending |
| R04 | Harness | P1 | Replace UI source-regex Promise assertion with runtime contract assertion | R03 | pending |
| R05 | Extract | P1 | Move indentation and continuation helpers to `js/format-indent-utils.js` | R03 | pending |
| R06 | Lexer | P1 | Reuse shared regex literal scanner/context without changing output | R05 | pending |
| R07 | Lexer | P1 | Add JS/CFScript escape-boundary tests before further lexer reuse | R06 | pending |
| R08 | Structure | P1 | Move tag scanning and named hierarchy to `js/cfml-structure.js` | R07 | pending |
| R09 | Formatter | P1 | Introduce explicit `beautifyCFML` context without changing control flow | R08 | pending |
| R10 | Formatter | P1 | Extract ordered line handlers one at a time | R09 | pending |
| R11 | Routing | P1 | Move language detection to DOM-free `js/language-detector.js` | R10 | pending |
| R12 | Routing | P1 | Add options-based loaded-resource pipeline in `js/formatter-core.js` | R11 | pending |
| R13 | Routing | P1 | Reduce `js/beautifier.js` to DOM/preload/stale/facade responsibilities | R12 | pending |
| R14 | Cleanup | P2 | Remove only dependency-checked dead variables/branches | R13 | pending |
| R15 | Release | P1 | Update script order, SW precache/cache version, docs, smoke/perf record | R14 | pending |

## R01 required fixture matrix

| Fixture | Required behaviors |
|---|---|
| mixed CFML/HTML | named hierarchy, packed tags, optional end tags |
| malformed markup | unmatched-close neutrality and opener recovery |
| nested CFML comments | outer-close matching; commented tags opaque in splitter/indent/SQL/JS paths |
| multi-line inline tag | quote-state carry and close detection |
| structural `<cfquery>` | normalization, Phase 3/4/fallback fixed point |
| deep `<script>` with CFML | combined CFML and JS brace depths |
| bare JS inside CFML | conservative fragment detection and Allman brace |
| regex/division JS | strings/comments/classes/flags/context |
| multi-line template | payload preservation and no structural leakage |
| continuation chains | ternary, boolean, concat, comma-leading alignment |
| legacy script wrapper | `<!--` / `//-->` executable-body formatting |
| line endings | browser/CLI routed output preserves CRLF or LF source style |
| source encodings | CLI round-trips UTF-8 BOM state and BOM-marked UTF-16LE/BE |

## Completion gates for every refactor task

- `npm test` passes.
- Existing expected output is unchanged unless the task is explicitly a bug fix.
- New production script is present in HTML, SW precache, VM harness, and load-order tests.
- No private sample input is added.
- `ARCHITECTURE.md`, roadmap/task status, and changelog are updated when dependencies or behavior change.

## Completed product work in current baseline

| Area | Status | Evidence |
|---|---|---|
| Shared nested markup-comment scanner | done | `js/cfml-comment-utils.js` + split/indent regression tests |
| Routed output line-ending restoration | done; CRLF covered through CLI UTF-16BE E2E | `normalizeOutputLineEndings` + `tests/cli.test.js` |
| CLI/diagnostic source-encoding preservation | implemented; UTF-8 BOM and UTF-16LE/BE tested | `tools/source-encoding.js` |
| Named CFML/HTML hierarchy | done | formatter structural tests |
| Optional HTML end tags | done | table/list regression tests |
| Multi-line tag quote carry | done | multi-line SQL-string tests |
| Blank-line trailing whitespace fix | done | formatter regressions |
| Structural SQL normalization/fixed point | done | formatter + CLI Pro SQL idempotency |
| Deep JS own-line CFML control tags | done | nested CFML/brace tests |
| Bare JS fragments within CFML | done | CFML conditional JS test |
| Multi-line template payload protection | done | deep JS template regression |
| Legacy script HTML-comment wrapper | done | wrapper regression at HEAD |
| Async UI stale-request protection | done | UI interaction suite |
| CLI browser-pipeline reuse | done | CLI E2E suite |
| Normalize/Semantic Indent | done, opt-in | formatter + real-WASM suites |

## Completed UI/CI backlog archive

The prior SCMC UI audit is complete. IDs are retained for traceability.

| IDs | Scope | Status |
|---|---|---|
| T01–T05 | Accessibility landmarks, names, live status, touch targets, dialect label | done |
| T06, T12–T15 | Responsive and visual improvements | done |
| T07–T11 | Console cleanup, busy state, keyboard editing, safe clear defaults | done |
| T16–T17 | Event delegation and deferred script loading | done |
| T18–T19 | Single `npm test` gate and offline UI tests | done |

Detailed original findings remain in [docs/UI-UX-AUDIT-2026-05-11.md](docs/UI-UX-AUDIT-2026-05-11.md).

## Next-step order

1. Implement R01/R02 only and review the test baseline.
2. Implement R03/R04 harness consolidation.
3. Begin low-risk extraction at R05.
4. Stop immediately on unexplained output drift.
