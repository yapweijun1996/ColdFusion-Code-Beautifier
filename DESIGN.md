# Beautifier Refactor Design

## Status

- **Document status:** accepted planning baseline; the shared comment utility exists, while broader formatter decomposition has not started.
- **Code baseline:** current working tree based on HEAD `9206986`, including the shared nested-markup-comment scanner and output line-ending hardening now present in source.
- **Source of truth:** executable code and tests. If this document conflicts with them, update this document rather than changing behavior silently.
- **Compatibility policy:** behavior-preserving refactor first; formatter output changes require a separate bug-fix task and regression test.

## Context

`js/beautifier.js` is currently a 1,849-line classic browser script. It owns JavaScript lexical heuristics, continuation alignment, CFML/HTML structure tracking, the line-based CFML formatter, language detection, DOM option capture, optional-resource loading, routing, stale-request protection, line-ending restoration, copy, and clear behavior. A first focused helper, `js/cfml-comment-utils.js`, already centralizes nested CFML/HTML markup-comment scanning across splitter/formatter/deep-format paths. The broader decomposition remains planned.

The project intentionally has no build step. Production scripts are classic deferred scripts with global APIs, and the browser, Node VM test harness, and CLI execute the same formatter implementation. This constraint remains in force for the refactor.

## Current architecture

```text
index.html / tools/beautify-file.js
  -> beautifyCodes()                         DOM-backed public router
       -> detectLanguage()
       -> standalone SQL: beautifySQL | formatProSQLSync
       -> standalone JS: formatJsWithLeadingComments -> formatBraceCode
       -> CFML: beautifyCFML
            -> normalizeLeadingSpacesToTabs (optional)
            -> splitAdjacentCFMLTags
            -> named CFML/HTML tag hierarchy + JS/CSS/raw-line state
            -> deepFormatEmbedded (optional SQL/CSS/JS)
            -> applySemanticIndentPostPass (optional Tree-sitter)
```

Important current protections:

- shared depth-aware nested CFML comment scanning; commented-out tags stay opaque across split, indent, SQL, JS, and language-detection paths;
- browser/CLI routed output restores CRLF when the captured source uses CRLF;
- CLI/diagnostic file I/O preserves UTF-8 BOM state and BOM-marked UTF-16LE/UTF-16BE encoding through `tools/source-encoding.js`;
- named structural tag stack; unmatched closes are neutral and malformed descendants are discarded;
- optional HTML end-tag handling;
- string/comment/regex-aware tag and brace scanning;
- multi-line CFML tag quote-state carry;
- structural CFML normalization before SQL fallback;
- fixed-point/idempotent structural query fallback;
- CFML control-flow depth inside deep-formatted JavaScript;
- multi-line template payload preservation;
- legacy `<!--` / `//-->` script-wrapper support;
- async input snapshot checks before committing or clearing output.

## Design goals

1. Reduce `js/beautifier.js` to a small DOM adapter and compatibility facade.
2. Separate pure formatting logic from browser I/O and lazy-load orchestration.
3. Make CFML line-state explicit and grouped by concern.
4. Reuse lexical primitives where JavaScript semantics are truly identical.
5. Preserve classic-script, global API, Node VM, CLI, PWA, and offline behavior.
6. Make every extraction independently testable and reversible.

## Non-goals

- No ES Module, TypeScript, bundler, or framework migration.
- No parser-first rewrite of the mixed-language formatter.
- No change to default UI options.
- No redesign of the SQL, CSS, or JavaScript output style.
- No removal of legacy global APIs during this epic.
- No expected-output update mixed into a refactor commit.

## Target modules

```text
js/cfml-comment-utils.js   existing shared nested CFML/HTML markup-comment scanner
js/js-lexer-utils.js       existing shared JS regex/context primitives; extend conservatively
js/format-indent-utils.js  leading-prefix, normalization, continuation classification/alignment
js/cfml-structure.js       tag scanning, events, named stack, implicit HTML closes
js/cfml-formatter.js       CFML line-state machine and beautifyCFML implementation
js/language-detector.js    hasTagsOutsideStrings, detectLanguage, leading markup comments
js/formatter-core.js       source/options routing and already-loaded formatter pipeline
js/beautifier.js           DOM capture, preload orchestration, stale guard, compatibility API
```

The first extraction may leave temporary global wrappers. Namespace cleanup is deferred until all consumers are known and tested.

## Target formatter state

`beautifyCFML` will move its related local variables into one explicit context without changing handler order:

```js
{
  options: {},
  lines: [],
  lineIndex: 0,
  indent: { level: 0, size: 1 },
  structure: { stack: [], pendingRawClose: '' },
  comment: { markup: false, block: false, originalPrefix: '', outputPrefix: '' },
  multilineTag: { active: false, name: '', quote: null, originalPrefix: '', structural: false },
  region: { javascript: false, cfscript: false, style: false, fragment: false },
  javascript: { parenDepth: 0, bracketDepth: 0, previousTerm: '', fragmentBraceDepth: 0 },
  continuation: { anchorActive: false, originalPrefix: '', indentLevel: 0 }
}
```

Planned ordered handlers:

1. template-literal continuation;
2. blank line;
3. multi-line tag continuation;
4. comment continuation/start;
5. multi-line tag start;
6. leading structural tag line;
7. embedded CF tag plus raw JS/CSS/text line;
8. pending raw-block close.

This is an ordered state machine, not a pluggable handler framework. Handler order is observable behavior.

## Core API direction

The current public functions remain available:

```text
beautifyCodes
beautifyCFML
detectLanguage
formatJsWithLeadingComments
hasTagCloseOutsideStrings
normalizeLeadingSpacesToTabs
```

The pure core will add internal APIs conceptually equivalent to:

```js
formatCodeLoaded(source, options)       // synchronous; no DOM access
preloadFormatDependencies(source, options) // Promise; Pro SQL/Tree-sitter only
```

The synchronous no-preload path must continue to write output before `beautifyCodes()` returns its resolved Promise. This preserves current UI and test semantics.

## Lexical reuse boundary

Shared scanning is desirable but JavaScript and CFScript do not have identical escaping rules. Reuse must be option-driven and incremental:

1. unify regex-literal endpoint/context handling first;
2. test division vs regex and keyword contexts;
3. only then consider shared quote/comment/template primitives;
4. preserve token-restoration behavior in `deep-format.js`.

Multi-line template literals and regex tokens remain verbatim because whitespace can be runtime-significant. Multi-line comments and protected parenthesis groups retain host-context-aware restoration.

## Dependency and loading design

Every new production script must be added in dependency order to:

- `index.html`;
- `sw.js` `PRECACHE_URLS`;
- Node VM script lists used by tests and tools.

A planned Node-only formatter script manifest will remove duplicate lists from the CLI and test/diagnostic harnesses. Browser order remains explicit and is checked by `tests/ui.test.js`.

## Failure and rollback design

- Every phase is a separate commit/PR.
- Golden output and behavior tests are the rollback oracle.
- Optional formatter load/parse failures continue to fall back to built-in or line-scanner output.
- A failed extraction is reverted independently; later phases do not depend on unverified output changes.
- Service-worker cache version is bumped only when production assets are released.

## Decisions

| Decision | Outcome |
|---|---|
| Refactor style | characterization-first, branch-by-abstraction |
| Output policy | byte-identical unless handled as a separate fix |
| Runtime model | classic deferred scripts; no build step |
| Parser strategy | Tree-sitter remains optional post-pass, not primary formatter |
| Public API | retained throughout epic |
| First implementation work | test/golden baseline, then shared VM harness |
| Dead-code removal | final phase only, after dependency and mutation checks |

## Open review points

No technical blocker is known. Work is intentionally gated on completing the characterization baseline before production extraction. Performance baseline and the exact internal namespace shape will be finalized during that phase.
