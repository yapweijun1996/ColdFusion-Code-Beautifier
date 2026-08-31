# Formatter Refactor Specification

## Status and authority

This specification describes required behavior for the planned formatter refactor. The current working tree (based on HEAD `9206986` and including the shared markup-comment module) and its tests are authoritative. The broader decomposition is **planned, not implemented**.

Normative terms **MUST**, **SHOULD**, and **MAY** have their usual requirements meaning.

## Functional requirements

### FR-01 — Existing languages

The system MUST continue to format:

- CFML and HTML through the outer line-based formatter;
- standalone SQL through built-in SQL or optional Pro SQL;
- standalone JavaScript through `formatBraceCode` with protected text/tokens;
- SQL, JavaScript, and CSS embedded in CFML when their deep-format options are enabled.

### FR-02 — Language routing

Auto detection MUST preserve current routing precedence:

1. SQL-looking prefix -> `sql`;
2. JavaScript-looking body with no real tag outside protected text -> `js`;
3. otherwise -> `cfml`.

Tags inside strings, comments, template literals, and regex literals MUST NOT alone force CFML routing. Leading CFML/HTML markup comments MAY precede standalone JavaScript. JavaScript comments remain in the JS formatter path rather than being peeled and restored as markup banners.

### FR-03 — CFML/HTML structure

The formatter MUST retain the named tag hierarchy semantics:

- matching close returns to its opener;
- malformed descendants above that opener are discarded;
- unmatched close is indentation-neutral;
- `cfelse`/`cfelseif` behave as sibling branch markers;
- supported optional HTML end tags close implicitly;
- inline, middle, void, unknown `cf*`, and known block tags retain current classification.

### FR-04 — Mixed raw-language regions

Brace/bracket state MUST be active only in JavaScript, CFScript, CSS, detected bare-JS fragments, or tag-free input routed through the CFML scanner. SQL and ordinary text braces MUST NOT alter structural indentation.

Recognizable bare JavaScript inside CFML control flow MUST retain brace indentation, including Allman-style headers. Detection MUST remain conservative so SQL/text is not reclassified as JavaScript.

### FR-05 — Multi-line safety

The formatter MUST preserve current handling of:

- nested CFML comments using depth-aware `<!---` / `--->` matching; nested commented-out tags MUST remain opaque to splitting, indentation, SQL dispatch, JS scanning, and language detection;
- quote state across multi-line CFML opening tags;
- blank lines as truly empty output lines;
- multi-line JS template payload indentation and content;
- CFML/HTML comments as opaque to brace counting;
- legacy script wrappers using own-line `<!--` and `//-->`;
- closing tags with whitespace before `>`, such as `</cfquery >`.

### FR-06 — Deep SQL

Structural CFML control-flow tags in `<cfquery>` MUST be normalized before dispatch. Existing marker injection, Phase 3 WHERE hoisting, Phase 4 AND/OR-leaf handling, Tier 2 fallback, and built-in fallback order MUST remain intact.

Fallback output MUST remain a fixed point. CFML structural depth and SQL subquery continuation depth MUST not be conflated. Any Pro SQL error or unsafe marker round trip MUST fall back rather than return partial output.

### FR-07 — Deep JavaScript

Deep JS MUST continue to protect and restore:

- single/double strings;
- comments;
- regex literals;
- template literals;
- balanced parenthesis groups;
- own-line CFML control tags.

CFML control-flow depth and JavaScript brace depth MUST compose. Multi-line template bodies MUST bypass transformations that would alter payload indentation.

### FR-08 — Optional semantic indentation

Semantic Indent MUST remain opt-in and browser-only for current CLI behavior. CFML and CFScript grammars MUST remain independently lazy-loaded. Parse errors, unavailable grammars, and CFScript blocks containing statement blocks MUST leave line-scanner output unchanged.

### FR-09 — Normalize Indent

Normalize Indent MUST remain opt-in and operate only on leading whitespace. Auto and explicit 2/4/8 widths MUST preserve current behavior. Line content MUST not change.

### FR-10 — UI lifecycle

`beautifyCodes()` MUST return a Promise on every path. If no preload is required, formatting MUST remain observable synchronously before the resolved Promise is returned.

An async completion MUST NOT:

- overwrite output for an input edited after request capture;
- clear newer input;
- leave the Beautify UI permanently busy after success/fallback/error.

### FR-11 — CLI

`tools/beautify-file.js` MUST continue to use production formatter scripts, preserve input files, support stdin/stdout, retain the `_beutifier.cfm` compatibility suffix, and support current flags. CLI output MUST match the browser pipeline for equivalent options. Routed browser/CLI output MUST preserve CRLF when the captured input contains CRLF and otherwise emit LF.

CLI and corpus diagnostics MUST decode and re-encode UTF-8 with/without BOM and BOM-marked UTF-16LE/UTF-16BE without changing the detected encoding or BOM state. BOM-less UTF-16 is not required.

### FR-12 — PWA/offline

All production scripts MUST be listed in the service-worker precache. Tree-sitter WASM remains lazy and not precached. The Pro SQL UMD bundle is runtime-lazy but currently included in PWA precache; documentation MUST distinguish runtime execution from service-worker download behavior.

## Compatibility requirements

### CR-01 — Public globals

At minimum these globals MUST remain callable during the epic:

```text
beautifyCodes
beautifyCFML
detectLanguage
formatJsWithLeadingComments
hasTagCloseOutsideStrings
normalizeLeadingSpacesToTabs
```

Helpers used directly by current tests or dependent scripts MUST retain wrappers until callers are migrated.

### CR-02 — Runtime model

The production application MUST remain usable by opening `index.html` without a build. No network dependency may be required for the built-in formatter. Vendored optional assets remain local.

### CR-03 — Output compatibility

Refactor commits MUST preserve locked expected output byte-for-byte. Any intentional output change MUST be isolated as a bug fix with its own failing regression test and documented rationale.

## Quality requirements

### QR-01 — Test gates

Every phase MUST pass:

```bash
npm test
```

This includes formatter VM, UI contract/interaction, CLI E2E, and real-WASM Tree-sitter suites.

### QR-02 — Characterization

Before production extraction, synthetic tracked fixtures MUST cover mixed CFML/HTML, malformed tags, nested CFML comments, structural SQL, deep JS with CFML, regex/division, multi-line templates, continuation alignment, LF/CRLF routed output, UTF-8 BOM, and BOM-marked UTF-16LE/UTF-16BE CLI round trips.

For applicable fixtures the gate MUST include:

- exact expected output;
- pass-2 equals pass-1;
- content/token preservation;
- no newly introduced raw newline in JS string literals.

### QR-03 — Privacy

Private `sample/*.cfm` files MUST remain ignored and absent from CI. New committed regression inputs MUST be sanitized and synthetic.

### QR-04 — Performance

A repeatable warm benchmark SHOULD be captured before state-machine extraction. A reproducible median regression greater than 10% requires investigation and written acceptance.

### QR-05 — Documentation consistency

A module extraction MUST update the architecture map, script order, service-worker precache description, VM harness list, roadmap/task status, and changelog in the same change.

## Planned options object

Pure formatter code SHOULD converge on:

```js
{
  language: 'auto',
  cfml: {
    splitHtmlTag: false,
    normalizeIndent: false,
    normalizeTabWidth: 0
  },
  deep: { sql: true, css: true, js: true },
  javascript: { preserveContinuationAlignment: true },
  sql: { pro: false, dialect: 'sql' },
  semanticIndent: false
}
```

Legacy positional `beautifyCFML` arguments remain supported through a facade during this epic.

## Acceptance criteria

The epic is complete when:

1. all requirements above are met;
2. `npm test` passes from a clean checkout without network/install for the committed test path;
3. browser and CLI outputs match for equivalent options;
4. no unapproved golden output changes exist;
5. `beautifier.js` primarily contains DOM/preload/facade responsibilities;
6. structural, lexical, indentation, language-detection, and core-routing responsibilities are independently testable;
7. docs and service-worker asset metadata match the final file graph.
