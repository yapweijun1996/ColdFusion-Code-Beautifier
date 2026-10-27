# Task Register

## Status summary

- **Current source baseline:** current `main`; full `npm test` passes with the completed nested-comment/encoding hardening.
- **Latest product hardening:** depth-aware nested CFML comments, routed CRLF restoration, UTF-8/BOM-marked UTF-16 CLI encoding preservation, structural SQL fixed-point alignment, whitespace-tolerant raw closes, deep-JS CFML depth, bare-JS fragments in CFML, multi-line templates, and legacy script wrappers are present.
- **Refactor epic:** in progress; a common Node script manifest and JavaScript verification guard are present, while broader formatter extraction remains pending.
- **Next task:** address the P0 mixed-language safety findings below, then complete the `R01`/`R02` characterization and golden baseline.
- **External blockers:** none.
- **Sequencing:** the shared manifest and safety guard were implemented alongside the characterization baseline; broader extraction remains gated on completing it.
- **Known coverage/tooling gaps:** full mixed-language characterization, source mapping and parser-backed indentation remain open.
- **Privacy constraint:** tracked/CI fixtures must be synthetic; private `sample/*.cfm` remains ignored.

Machine-readable status is mirrored in [task.jsonl](task.jsonl).

## Mixed-language safety and maintenance backlog

The following findings were observed against the local CLI on 2026-10-27; they do not establish the behavior of a published package. The original `npm test` did not detect the CSS or SQL corruption. Local fixes and synthetic Chrome and Lucee checks are recorded below; no business page or database was exercised.

| ID | Priority | Task | Status |
|---|:-:|---|---|
| S01 | P0 | Preserve CSS strings and comments during Deep CSS formatting; add semantic regression coverage | in progress — targeted fix and synthetic browser checks; broader CSS/CFML semantics remain unverified |
| S02 | P0 | Prevent CFML-token placeholder collisions in SQL; add collision and restoration regression coverage | in progress — targeted fix and formatter regressions; Lucee/ColdFusion execution remains unverified |
| S03 | P0 | Preserve whitespace-sensitive HTML output, including adjacent inline elements and preformatted text; verify in a real browser | done — synthetic Lucee 6.2.2.91 and Chrome comparisons pass for the covered cases |
| S04 | P1 | Extend mixed-language safety fixtures and real-browser smoke coverage; complete R01/R02 before core extraction | in progress — literal, SQL and filesystem regressions added; full characterization remains pending |
| S05 | P1 | Verify the declared Node support range in CI and establish a supported Node/OS test matrix | pending |
| S06 | P1 | Audit Pro SQL fallback logging for source disclosure and CLI output overwrites; define and test safe behavior | done — SQL fallback warnings omit source/exception text; default and input-alias output protection have focused CLI tests |
| S07 | P1 | Document vendored dependency versions, provenance, integrity verification, and upgrade process | pending |

### Reproduced cases and acceptance criteria

- **S01:** In a `<style>` block, `content: "}b";` is split by a newline inside the string with default Deep CSS enabled. `--no-deep-css` preserved this example. Preserve string/comment contents and CSS semantics across normal and mixed-CFML cases; verify the default and disabled paths.
- **S02:** A `<cfquery>` containing `SELECT __CFTOKEN_0__` and a `<cfqueryparam>` replaced the identifier with the parameter tag under default Deep SQL; the CLI exited successfully. `--no-deep-sql` preserved this example. Preserve user identifiers, literals, comments, CFML tokens and their order across built-in, Pro SQL and fallback paths, including marker-like input.
- **S03:** The browser/CLI pipeline restores original text around recognized HTML/CFML tags. Synthetic Lucee 6.2.2.91 pages were compared in Chrome across true/false CFML branches, `cfinclude`, dynamic values, adjacent text, `<pre>`, `<textarea>` and CSS whitespace. Three formatter configurations preserved server responses for one fixture; a second fixture changed both CSS and JavaScript formatting while preserving browser text, computed color and script result in both branches. Tests do not establish behavior for every template or CFML engine. The guard can leave bare JavaScript fragments inside CFML conditionals unchanged.
- **S04–S07:** Keep private source out of fixtures and logs. Record actual tested environments and update safety guidance when behavior is fixed. Idempotency and whitespace-normalized comparisons alone do not prove semantic equivalence.

Until these are resolved, preserve originals and review output; disabling Deep CSS or Deep SQL only avoids the two specific reproduced examples and does not establish whole-file safety.

## Refactor tasks

| ID | Phase | Priority | Task | Depends on | Status |
|---|---|:-:|---|---|---|
| R00 | Docs | P0 | Align design/spec/epic/roadmap/task and related documentation with current code | — | done |
| R01 | Baseline | P0 | Add synthetic characterization fixtures and locked golden outputs | R00 | in progress — JS/CFML structure contracts added |
| R02 | Baseline | P0 | Add exact output, idempotency, content, public-global, string-break, LF/CRLF, and encoding/BOM gates | R01 | in progress — full gate audit pending |
| R03 | Harness | P1 | Centralize Node VM script loader and import shared comment scanner into host diagnostics | R02 | partial — shared script manifest added; VM loader pending |
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

1. Reproduce and fix S01/S02 with targeted regression tests; investigate and address S03 with browser evidence.
2. Complete the mixed-language characterization and R01/R02 test baseline, including S04.
3. Address S05–S07, then implement R03/R04 harness consolidation.
4. Begin low-risk extraction at R05; stop immediately on unexplained output drift.
