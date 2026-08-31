# Epic: Behavior-Preserving Beautifier Decomposition

## Epic record

| Field | Value |
|---|---|
| Epic ID | `EPIC-REF-001` |
| Status | Planned broader decomposition / documentation complete |
| Code implementation | Existing shared comment utility complete; decomposition phases not started |
| Baseline | Current working tree based on HEAD `9206986` |
| Priority | High engineering health; below production correctness regressions |
| Strategy | Characterization-first, branch-by-abstraction |
| Primary files | `js/beautifier.js`, `js/deep-format.js`, test/tool script loaders |
| Quality gate | `npm test` |

## Problem statement

The formatter is stable and feature-rich, but `js/beautifier.js` combines lexical scanning, CFML/HTML structure, line-state formatting, language detection, DOM routing, optional dependency loading, and async output lifecycle. This concentration increases regression risk and duplicates lexical decisions already present in `js/js-lexer-utils.js` and `js/deep-format.js`.

## Outcome

Deliver focused classic-script modules while retaining current output, global APIs, zero-build browser use, VM-backed tests, CLI behavior, PWA caching, and optional formatter fallbacks.

## Scope

### Included

- characterization and golden-output baseline;
- shared Node VM script manifest/harness;
- indentation/continuation utility extraction;
- conservative lexical primitive reuse;
- CFML/HTML structure extraction;
- explicit CFML formatter context and ordered handlers;
- language detector extraction;
- pure formatter core and DOM adapter separation;
- verified dead-code cleanup;
- documentation and PWA dependency updates.

### Excluded

- formatter output redesign;
- ES Modules/build tooling;
- TypeScript migration;
- replacing the mixed-language line scanner with Tree-sitter;
- enabling Semantic Indent in CLI;
- new user-facing formatting features.

## Workstreams

| Workstream | Status | Dependency | Deliverable |
|---|---|---|---|
| WS0 Documentation baseline | Done | None | `DESIGN.md`, `SPEC.md`, `EPIC.md`, `ROADMAP.md`, `TASK.md`, related docs aligned |
| WS1 Characterization baseline | Pending | WS0 | synthetic fixtures, golden output, behavior/API gates |
| WS2 Harness consolidation | Pending | WS1 | one Node VM script list/runtime helper |
| WS3 Indent utility extraction | Pending | WS2 | `js/format-indent-utils.js` |
| WS4 Lexer convergence | Pending | WS3 | shared regex/context primitives without output change |
| WS5 Structure extraction | Pending | WS4 | `js/cfml-structure.js` |
| WS6 CFML state decomposition | Pending | WS5 | `js/cfml-formatter.js`, explicit context/handlers |
| WS7 Language/core/router split | Pending | WS6 | `js/language-detector.js`, `js/formatter-core.js`, thin facade |
| WS8 Cleanup/release | Pending | WS7 | dead-code proof, docs, cache bump, smoke test |

## Completed work already in the baseline

These are existing product capabilities, not pending refactor tasks:

- shared `js/cfml-comment-utils.js` with depth-aware nested CFML-comment handling across production and harness load graphs;
- routed output line-ending restoration (CRLF source -> CRLF output; otherwise LF);
- shared CLI/diagnostic encoding preservation for UTF-8 BOM state and BOM-marked UTF-16LE/UTF-16BE;
- named CFML/HTML structural hierarchy and optional end-tag handling;
- structural SQL fallback alignment and idempotency hardening;
- Pro SQL Phase 3/4 and token-equivalence safety tests;
- deep JS CFML control-tag preservation;
- bare JS fragment indentation inside CFML control flow;
- multi-line template payload preservation;
- legacy HTML-comment script wrapper support;
- whitespace-tolerant raw closing-tag detection;
- Normalize Indent and optional Semantic Indent;
- async stale-input protection and UI busy lifecycle;
- production CLI using the browser formatter pipeline;
- formatter, UI, CLI, and Tree-sitter test suites passing at baseline.

## Dependencies

### Runtime/code

- `CF_TAGS` / `HTML_VOID_TAGS` from `js/cf-tags.js`;
- SQL globals from `js/sql-keywords.js` and `js/sql-beautifier.js`;
- shared JS helpers from `js/js-lexer-utils.js`;
- embedded formatters and token protection from `js/deep-format.js`;
- `splitAdjacentCFMLTags` and tag utilities;
- optional Pro SQL globals;
- optional Tree-sitter globals;
- clipboard/UI globals.

### Delivery

- explicit `index.html` deferred script order;
- `sw.js` precache list and cache version;
- Node VM script lists in tests/tools;
- GitHub Actions `npm test` gate;
- synthetic-only CI privacy policy.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Handler order changes observable output | High | one-handler extraction commits, golden exact-output gates |
| JS and CFScript escapes conflated | High | option-aware, incremental lexer reuse |
| Multi-line token restoration changes content | High | preserve restoration contract and token/content invariants |
| Global dependency/load order breaks | High | explicit API/order/precache tests and shared Node manifest |
| Async path becomes always deferred | High | retain immediate no-preload execution contract |
| Legacy malformed markup loses recovery | High | structural synthetic fixtures and named-stack tests |
| Refactor hides a behavior change | Medium | separate fix commits; no expected-output edits in refactor commits |
| PWA serves mismatched asset graph | Medium | precache coverage test and release cache bump |

## Blockers and gates

- **External blockers:** none known.
- **Current gate:** production extraction cannot start until WS1 locks current behavior.
- **Known test gaps:** local `sample/` is empty in the tracked repository, so sample idempotency is skipped in CI by design. UTF-16BE plus CRLF is covered by CLI E2E; UTF-8 BOM, UTF-16LE, and unused `isMarkupCommentOnly` still need direct cases.
- **Known tooling blocker:** host-side `tools/diagnose-corpus.js` sanitizer calls `findCFMLCommentEnd`, which is loaded only inside its formatter VM and is not imported into the host scope. R03 must share/import the scanner before that sanitizer path is considered complete.
- **Approval gate:** any intentional output change requires separate review as a bug fix.

## Definition of done

- All workstreams complete.
- Full suite and browser smoke test pass.
- Golden output has no unexplained differences.
- Browser/CLI parity remains intact.
- Public compatibility globals remain available.
- Planned module graph is reflected in HTML, SW, tests, tools, README, and architecture docs.
- No private corpus is committed.

## References

- [DESIGN.md](DESIGN.md)
- [SPEC.md](SPEC.md)
- [ROADMAP.md](ROADMAP.md)
- [TASK.md](TASK.md)
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/TESTING.md](docs/TESTING.md)
- [docs/SAFETY.md](docs/SAFETY.md)
