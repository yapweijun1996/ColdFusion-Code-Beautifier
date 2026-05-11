# Phase 4 — Split-Format-Recombine for Multi-Level cfif Trees

**Status:** DESIGN (pre-implementation)
**Branch:** `phase4-split-format-recombine`
**Author:** Claude + yapweijun1996@gmail.com
**Date:** 2026-05-11

## Problem statement

Today, `<cfquery>` bodies with **structural CFML control flow** are dispatched
through 4 tiers in `js/deep-format.js`:

| Tier | Trigger | Output quality |
|------|---------|----------------|
| 1 — Marker injection | cfif tags own-line in column-list position | Full Pro SQL re-format ✅ |
| 1.5 — WHERE hoisting (Phase 3) | All cfif leaves start with `where ` AND tree is single-level | Full Pro SQL backbone, cfif preserved as sub-tree under WHERE ✅ |
| 2 — Verbatim with Lite uppercase | Has user indent | Layout preserved, keywords uppercased ⚠️ |
| 3 — Flat fallback | No user indent | Trust beautifyCFML's nested output ⚠️ |

The **canonical pain point** is `qs_result_main` (sample/test.cfm cfquery #2):

```cfml
<cfquery name="qs_result_main">
  SELECT *
  FROM scm_sal_main
  <cfif frommode IS "new">                      ← LEVEL 1
    <cfif prelim_fromsource_yn IS "y">          ← LEVEL 2
      <cfif fromtrans IS "sal_soc" OR ...>      ← LEVEL 3
        WHERE uniquenum_pri = <cfqueryparam value="c#uniquenum_pri#" cfsqltype="cf_sql_varchar">
      <cfelseif fromtrans IS "sal_inv" AND ...>
        WHERE uniquenum_pri = (SELECT uniquenum_pri FROM trans_tab_data WHERE ...)
      <cfelseif fromtrans IS "stk_do" AND ...>
        WHERE uniquenum_pri IN (SELECT DISTINCT scd.uniquenum_pri FROM scm_sal_data scd WHERE ...)
      <cfelse>
        WHERE uniquenum_pri = <cfqueryparam value="#uniquenum_pri#" cfsqltype="cf_sql_varchar">
      </cfif>
    <cfelse>
      <cfif fromtrans IS "sal_soe" AND ...>
        WHERE uniquenum_pri = <cfqueryparam value="#fmi_mainSO_unique#" cfsqltype="cf_sql_varchar">
      <cfelse>
        WHERE uniquenum_pri = <cfqueryparam value="tnosys" cfsqltype="cf_sql_varchar">
      </cfif>
    </cfif>
  <cfelse>
    WHERE uniquenum_pri = <cfqueryparam value="#print_group_uniquenum_pri#" cfsqltype="cf_sql_varchar">
  </cfif>
</cfquery>
```

**Why Phase 3 (WHERE hoisting) doesn't fire:**
- Tree is multi-level (3 levels), not single
- Some leaves have `WHERE x = (SUBQUERY)` not just `WHERE x = ?` — hoisting `WHERE`
  out and putting subquery as the body would create syntactically valid SQL but
  visually confusing output

**Today's behavior:** Tier 2 verbatim — output looks identical to input. SAFE
but doesn't help the user with formatting.

**Phase 4 goal:** Format **the SQL inside each leaf branch independently** so
that each WHERE clause / subquery looks like proper Pro SQL, while preserving
the cfif tree structure exactly.

---

## Algorithm: Split-Format-Recombine (per-leaf)

### Definitions

- **Pre-tree**: tokens before the first structural cfif tag (typically the
  `SELECT cols FROM table [JOINs]` portion).
- **Post-tree**: tokens after the last `</cfif>` matching the outermost cfif
  tag (typically trailing `AND foo = bar` clauses).
- **CFIF tree**: nested `<cfif>...<cfelseif>...<cfelse>...</cfif>` structure.
- **Leaf branch**: a branch (between two consecutive cfif/cfelseif/cfelse
  tags) that contains SQL content but **no nested cfif** inside it.
- **Inner branch**: a branch that contains nested cfif (recurses).

### Steps

```
phase4Format(body):
    1. (pre, treeRoot, post) = parseCfifTree(body)
    2. preFormatted  = formatProSQL(pre)              // SELECT/FROM/JOINs only
    3. tree2         = formatTreeRecursively(treeRoot, preFormatted)
    4. postFormatted = formatPostFragment(post)       // trailing AND clauses
    5. return assemble(preFormatted, tree2, postFormatted)

formatTreeRecursively(branch, pre):
    if branch has nested cfif:
        for each sub-branch in branch.children:
            formatTreeRecursively(sub-branch, pre)
        return  (structure preserved)
    else:                                          // leaf branch
        leafSQL = branch.sqlContent
        if leafSQL.trim() == '':
            return                                  // empty branch, leave alone
        # Synthesize a complete SELECT for the formatter to chew on:
        synthetic = pre + leafSQL                   // pre is a string ending in FROM ...
        formatted = formatProSQL(protectCFMLTokens(synthetic))
        # Extract the WHERE-and-after part from formatted output:
        whereFragment = extractAfterFrom(formatted, preLineCount)
        branch.sqlContent = restoreCFMLTokens(whereFragment)

extractAfterFrom(formattedSql, preLineCount):
    # The formatter outputs SELECT...FROM... on first N lines (predictable
    # layout because we trust sql-formatter's deterministic output).
    # Everything after line N is the WHERE/AND fragment.
    return formattedSql.split('\n').slice(preLineCount).join('\n')
```

### Why this works

1. **Each leaf is a standalone, complete SELECT** when prefixed with `pre` →
   sql-formatter never sees partial SQL → no parse errors.
2. **CFML expression conditions** (`fmi_mainSO_unique NEQ ""`) live in
   `<cfif>`/`<cfelseif>` tags themselves, never in the formatted SQL — they
   pass through untouched.
3. **Subqueries inside WHERE** get full Pro SQL formatting because they're
   part of the synthetic complete SELECT.
4. **Tree structure is preserved** because we only replace leaf-content
   strings, never restructure the cfif tree.

### What this does NOT change

- The cfif tree structure (no flattening, no branch reordering).
- CFML expression tags (cfif conditions, cfqueryparam attributes).
- `<!--- comments --->` in the tree.

---

## Edge cases & risk register

| # | Edge case | Mitigation |
|---|-----------|------------|
| 1 | Leaf is empty (`<cfelse> </cfif>`) | Skip format, leave verbatim. |
| 2 | Leaf has only CFML, no SQL | Skip format. |
| 3 | Leaf SQL parses fail (unbalanced quotes after CFTOKEN replacement) | Catch error, fall back to Tier 2 verbatim for that leaf only. |
| 4 | Pre-tree has no FROM (e.g., `INSERT INTO t (cols) <cfif>VALUES (...)<cfelse>SELECT ...</cfif>`) | Detect: only enable Phase 4 when pre-tree contains FROM. |
| 5 | Trailing `</cfif> AND foo = bar` (post-tree) | Synthesize `pre + 'WHERE 1=1 ' + post` and format separately. |
| 6 | Cfelseif condition contains string with `<cfif>` substring | Use existing `findClosingTagOutsideText` semantics. |
| 7 | Nested cfif inside a leaf's SUBQUERY (very rare) | Defer — fall back to Tier 2 for that leaf. |
| 8 | Pre-tree has CFML expression tags (cfset/cfqueryparam mid-FROM) | Phase 4 declines, falls to Tier 2. |
| 9 | Leaf has trailing `OR clause` instead of `WHERE clause` | Detect leaf-prefix; if not (`where`, `and`, `or`, ` `, `--`), fall back. |
| 10 | sql-formatter throws on synthetic SELECT | Fall back per-leaf to verbatim. |
| 11 | Multiple cfqueryparam tokens collide in protect/restore | Already handled by existing `protectCFMLTokens` — UUID-style numbering. |
| 12 | Indent depth in output doesn't match parent cfif depth | Re-indent output of each leaf to match `parentDepth + 1`. |

**Hard-fail safety:** If ANY step throws or produces empty/null output for the
whole body, return UNCHANGED original body (Tier 2 already runs). Phase 4 is
purely additive — failure must equal "no Phase 4 today".

---

## Test strategy (build BEFORE implementation)

10 progressive e2e tests in `tests/run-tests.js`, each with explicit input
and expected output. **Tests must FAIL on current main** (proves they exercise
new code path) and PASS after Phase 4 lands.

| # | Description | Difficulty |
|---|-------------|------------|
| T1 | Simple cfif with 2 leaves, both `WHERE x = ?` | trivial |
| T2 | cfif/cfelseif/cfelse 3 leaves, each different `WHERE x = ?` | easy |
| T3 | cfif with leaf containing `WHERE x = (SELECT ... FROM ... WHERE ...)` | moderate |
| T4 | 2-level nested cfif, leaves on both levels with WHERE | moderate |
| T5 | cfif tree + post-tree `</cfif> AND tag = 'x'` | moderate |
| T6 | Leaves contain `<cfqueryparam value="#x#" cfsqltype="cf_sql_varchar">` | moderate |
| T7 | 3-level nested cfif (qs_result_main shape, simplified) | hard |
| T8 | Leaf with `WHERE x IN (#PreserveSingleQuotes(arr)#)` | hard |
| T9 | Leaf SQL parse failure → falls back to Tier 2 for that leaf only | safety |
| T10 | Whole body Phase 4 path throws → falls back to Tier 2 entirely | safety |

---

## Out of scope for Phase 4

- `<cfloop>` inside cfquery (loops over data, not control flow on SQL shape).
- `<cfswitch>` inside cfquery.
- Re-formatting the CFML expression conditions themselves
  (those go through `normalizeCFMLExpression` already).
- Auto-fixing user source bugs like `'#var#'and` (missing space).

---

## Acceptance criteria

1. All existing 90 tests still pass (no regression).
2. New T1–T10 all pass.
3. `sample/test.cfm` qs_result_main (cfquery #2) shows
   formatted SQL inside each cfif branch, while cfif tree shape is identical
   to input. (Visual diff review by user.)
4. Performance: full sample/test.cfm (1241 lines, 21 cfqueries) formats in
   <500ms (current is ~140ms; budget +250%).
5. Pure additive: if Phase 4 disabled or fails, output is **bit-identical**
   to current Tier 2 verbatim output.
