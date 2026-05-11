# Phase 4 — AND-Leaves Hoisting (Phase 3's Dual)

**Status:** DESIGN v2 — algorithm REWRITTEN after corpus reality check
**Branch:** `phase4-split-format-recombine`
**Author:** Claude + yapweijun1996@gmail.com
**Date:** 2026-05-11
**Prior version:** Per-leaf split-format-recombine (over-engineered, replaced)

## Reality check — what the corpus actually contains

Audited 13 real-world `.cfm` files (1.7 MB, 27,612 lines, 103 cfqueries
total). Tier 2 verbatim falls only on **8 cfqueries** that fall into 4
distinct patterns:

### Pattern A — "AND-leaves" (6 of 8 targets, 75%)

The dominant real-world case. Backbone `WHERE base_condition AND base_condition`
is FULLY OUTSIDE the cfif tree. Each cfif/cfelseif/cfelse leaf merely
**appends optional `and xxx`** clauses:

```cfml
WHERE base.col1 = ?
  AND base.col2 = ?
  AND base.date BETWEEN ? AND ?
<cfif filter_a>
  and base.x = '#a#'
</cfif>
<cfif filter_b is "y">
  and base.y = 'y'
<cfelseif filter_b is "n">
  and base.y = 'n'
</cfif>
GROUP BY ...
ORDER BY ...
```

Targets matching this pattern:
- `fr_fg_vari_qty.cfm` #1 (qs_result, 48 lines)
- `fr_fg_vari_qty.cfm` #2 (qs_result_rm_std, 55 lines)
- `fr_fg_vari_qty.cfm` #3 (qs_result_rm_act, 55 lines)
- `fr_fg_vari_qty.cfm` #4 (qs_result_mw, 63 lines)
- `fin_mod_view295_01.cfm` #5 (qs_gst_general, 10 lines)
- `inc_entp_pcertap_view092.cfm` #19 (qs_tab_omis_order, 54 lines)

### Pattern B — "OR-in-paren" (1 of 8)

cfif lives inside a parenthesized OR chain in the WHERE clause:

```cfml
WHERE (uniquenum_pri = ? OR uniquenum_uniq = ?
       <cfif x>
         OR uniquenum_uniq = ?
         OR uniquenum_pri = ?
       </cfif>)
  AND tag_table_usage = ?
```

Targets:
- `inc_entp_pcertap_view092.cfm` #2 (qs_result_revision)

### Pattern D — "UNION cfif" (1 of 8)

Entire second SELECT is conditionally appended via cfif → UNION:

```cfml
SELECT ...
FROM ...
WHERE ...
GROUP BY ...
<cfif x>
union
SELECT ...
FROM ...
WHERE ...
ORDER BY ...
</cfif>
```

Targets:
- `fr_mthly_sales_cust.cfm` #2 (qs_result_00, 152 lines)

### Pattern C (no targets — covered by Tier 1)

Empty in this corpus.

## Phase 4 v2 algorithm — AND-leaves hoisting

**Scope:** Pattern A only. Patterns B and D explicitly fall back to Tier 2.

### Detection precondition (all must hold)

1. cfquery body has structural cfif AND it is NOT in column-list position
   (Tier 1 marker injection didn't fire).
2. There is a contiguous "pre-tree" segment ending in `WHERE [conditions]`
   BEFORE the first structural cfif. The pre-tree must contain `SELECT`,
   `FROM`, AND `WHERE`.
3. **Every non-empty, non-tag, non-comment line inside the cfif tree starts
   with `and ` or `or `** (case-insensitive). This is the "AND-leaves
   precondition" — the cfif tree only contributes appendable boolean
   clauses, never restructures the SQL shape.
4. Optional "post-tree" segment (e.g., `GROUP BY ...`, `ORDER BY ...`,
   trailing `AND ...`) AFTER the last `</cfif>` matching the outermost cfif.

If ANY precondition fails → fall through to existing Tier 2 verbatim
(zero-regression guarantee).

### Algorithm

```
splitBody(body) → { pre, treeLines, post }
  pre       = lines from start to (first '<cfif>' line - 1)
  treeLines = lines from first cfif tag to matching '</cfif>'
  post      = lines after matching '</cfif>' to end of body

phase4Format(body, sqlDialect):
    1. (pre, treeLines, post) = splitBody(body)
    2. checkPrecondition(pre, treeLines) or return null  // null = fall back to Tier 2

    3. preProtected      = protectCFMLTokens(pre)
    4. preFormatted      = formatProSQL(preProtected.code, sqlDialect)
    5. preRestored       = restoreCFMLTokens(preFormatted, preProtected.tokens)

    6. treeFormatted     = formatTreeLines(treeLines)
       // Walk tree: cfif tags re-indented to depth (relative to WHERE block).
       // Body lines (the `and xxx` parts) get protectCFMLTokens →
       // uppercaseSQLKeywordsInProtected → restoreCFMLTokens.

    7. postFormatted = post.trim() === '' ? '' : formatPostFragment(post, sqlDialect)
       // Post-tree often contains GROUP BY / ORDER BY which sql-formatter
       // can re-format if synthesized as `SELECT 1 FROM t WHERE 1=1
       // <postLines>`. Extract just the post-WHERE part.

    8. return assemble(preRestored, treeFormatted, postFormatted, parentIndent)
```

**Why this is much simpler than v1:**
- v1 ran sql-formatter ONCE per leaf with synthetic full SELECT → at most
  N calls per cfquery, each doing duplicate work.
- v2 runs sql-formatter ~2 times per cfquery (pre + post). Tree itself
  doesn't go through sql-formatter at all — only Lite uppercase, because
  the cfif structure must stay intact.

**Why this is safer than v1:**
- Pre-tree is a complete `SELECT ... FROM ... WHERE base...` — sql-formatter
  is well-defined on it.
- Tree is left structurally intact; only string-content of leaf lines is
  touched (token-protect → uppercase → restore).
- Post-tree synthesized into a complete SELECT for safe formatting.

### Visual example

Input:
```
SELECT a, b FROM t WHERE x = 1
<cfif foo>
  and y = 2
<cfelseif bar>
  and y = 3
</cfif>
GROUP BY a
```

After Phase 4:
```
SELECT
  a,
  b
FROM
  t
WHERE
  x = 1
  <cfif foo>
    AND y = 2
  <cfelseif bar>
    AND y = 3
  </cfif>
GROUP BY
  a
```

The cfif tree is preserved bit-for-bit structurally, sitting INSIDE the
WHERE block at depth +1, with each leaf's `and` uppercased.

## Edge cases & risk register (v2)

| # | Edge case | Handling |
|---|-----------|----------|
| 1 | Pre-tree has no WHERE (e.g., simple SELECT FROM with cfif on JOIN) | Precondition fails → Tier 2 |
| 2 | Tree leaf starts with `where ` (Phase 3 territory) | Phase 3 already handles, runs first |
| 3 | Tree leaf starts with neither `and` nor `or` (e.g., raw `union`) | Precondition fails → Tier 2 |
| 4 | Tree contains nested cfif | OK — depth tracking handles arbitrary nesting |
| 5 | Tree leaf is multi-line (e.g., `and (lower(x) LIKE '...'\nor lower(y) LIKE '...')`) | First non-empty line check; subsequent lines must NOT start with `<cf` |
| 6 | Empty cfif body (e.g., `<cfelse>\n</cfif>`) | Skip the empty leaf, allow |
| 7 | Comment lines `<!--- foo --->` inside tree | Treat as transparent |
| 8 | Pre-tree contains hash interpolation `'#x#'` | protectCFMLTokens already handles |
| 9 | Post-tree is just whitespace | Skip, no format call |
| 10 | sql-formatter throws on pre-tree | Catch → return null → Tier 2 |
| 11 | sql-formatter throws on post-tree | Use unformatted post, log warn |
| 12 | parentIndent reconstruction loses tab consistency | Use existing `indentEmbeddedBody` helper |

## Test corpus (build BEFORE implementation)

10 progressive e2e tests. Each test runs through `runRouter(input, 'cfml', true)`
with Pro SQL on (load vendor sql-formatter into vm context).

| # | Pattern | Description |
|---|---------|-------------|
| T1 | A | Single cfif, single `and` leaf |
| T2 | A | cfif/cfelse, both leaves `and ...` |
| T3 | A | cfif/cfelseif/cfelse, all `and ...` |
| T4 | A | Multiple sibling cfif blocks (5+) |
| T5 | A | cfif body has multi-line `and (...)` continuation |
| T6 | A | Tree has `<!--- comment --->` inside |
| T7 | A | post-tree has GROUP BY + ORDER BY |
| T8 | A | Real-world fr_fg_vari_qty #1 shape |
| T9 | B/D | OR-in-paren must FALL BACK to Tier 2 (verify no false dispatch) |
| T10 | safety | sql-formatter throw → output bit-identical to Tier 2 |

## Acceptance criteria

1. All existing 90 tests still pass.
2. T1–T10 all pass.
3. The 6 Pattern-A targets in the corpus produce output where the cfif
   tree sits formatted under the WHERE block, with `and` uppercased.
4. The 1 Pattern-B and 1 Pattern-D targets produce output bit-identical
   to current Tier 2 verbatim (zero regression).
5. Performance: full corpus (103 cfqueries, 27,612 lines) formats in
   <1000ms (current 415ms; budget +140%).
6. Pure additive: any failure path returns to Tier 2 verbatim output.

## Out of scope

- Pattern B (OR-in-paren) — would need recursive WHERE-clause AST splitting.
  Defer to Phase 5 if user demand emerges.
- Pattern D (UNION cfif) — would need treating each UNION arm as an
  independent SELECT. Defer to Phase 6.
- Re-formatting CFML expression conditions (`is`, `eq`, `neq`, etc.) —
  Phase 2 normalization already covers this.
- Auto-fixing user source bugs like missing space around `'#var#'and`.
