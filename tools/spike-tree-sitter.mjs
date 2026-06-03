/**
 * Spike / reference implementation: tree-sitter CFML semantic indentation.
 *
 * PURPOSE
 *   Prove that @cfmleditor/tree-sitter-cfml can recover the call-nesting
 *   hierarchy of a FLAT (zero-indent) multi-line <cfset> expression so the
 *   beautifier can indent deeply-nested function chains like
 *       fAy( ..., fAy( ..., fAy( ... ) ) )
 *   that the line-scanner cannot (no original indentation to preserve).
 *
 * WHY THIS WORKS WHERE BRACKET-COUNTING FAILED
 *   The naive "+1 tab per open bracket" approach also indents struct literals
 *   `{ k: v }` and simple function args, breaking 22 existing tests. The CST
 *   distinguishes them for free: only `call_expression` nodes carry nesting
 *   depth; struct `pair` nodes and bare argument strings do not. So keying the
 *   indent off `call_expression` CST depth indents fAy() chains and leaves
 *   structs / SQL strings / simple args flat — automatically.
 *
 * SELF-CONTAINED
 *   Loads the glue + runtime + grammar from vendor/tree-sitter/ (committed),
 *   NOT from node_modules — this mirrors exactly how the browser build will
 *   load them, and lets the spike run after a fresh clone without npm install.
 *
 * RUN:  node tools/spike-tree-sitter.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VENDOR = path.join(__dirname, '..', 'vendor', 'tree-sitter');

// ── Load vendored tree-sitter (browser-identical path) ───────────────────────
const TS = await import(pathToFileURL(path.join(VENDOR, 'web-tree-sitter.js')).href);
const { Parser, Language } = TS;
await Parser.init({ wasmBinary: fs.readFileSync(path.join(VENDOR, 'web-tree-sitter.wasm')) });
const cfmlLang = await Language.load(fs.readFileSync(path.join(VENDOR, 'tree-sitter-cfml.wasm')));
const parser = new Parser();
parser.setLanguage(cfmlLang);

/**
 * Core algorithm. Given a CFML snippet, return a map of
 *   { lineNumber(1-based) : extraTabs }
 * derived from the CST depth of the shallowest `call_expression` that STARTS
 * on each line, normalized against the shallowest call depth in the snippet
 * and divided by the auto-detected per-level increment ("factor").
 *
 * Lines with no call_expression starting on them (closing-paren lines,
 * struct bodies, plain args) are absent from the map → caller leaves them at
 * the base indent. Returns {} when there is no nesting to express.
 */
function computeCallIndentByLine(code) {
  const tree = parser.parse(code);
  const calls = [];
  (function walk(node, depth) {
    if (node.type === 'call_expression') {
      calls.push({ depth, line: node.startPosition.row + 1 });
    }
    for (let i = 0; i < node.childCount; i++) walk(node.child(i), depth + 1);
  })(tree.rootNode, 0);

  if (calls.length === 0) return {};

  // Shallowest call depth per line.
  const byLine = {};
  for (const c of calls) {
    if (byLine[c.line] === undefined || c.depth < byLine[c.line]) byLine[c.line] = c.depth;
  }

  const minDepth = Math.min(...calls.map((c) => c.depth));
  // Factor = smallest positive depth delta seen (one nesting level in CST terms).
  const deltas = [...new Set(calls.map((c) => c.depth - minDepth))].filter((d) => d > 0);
  const factor = deltas.length ? Math.min(...deltas) : 1;

  const out = {};
  for (const [line, depth] of Object.entries(byLine)) {
    const extra = Math.floor((depth - minDepth) / factor);
    if (extra > 0) out[Number(line)] = extra;
  }
  return out;
}

// ── Validation cases ─────────────────────────────────────────────────────────
function show(label, code, expectHierarchy) {
  const map = computeCallIndentByLine(code);
  const hasHierarchy = Object.keys(map).length > 0;
  const verdict = hasHierarchy === expectHierarchy ? 'PASS' : 'FAIL';
  console.log(`\n[${verdict}] ${label}`);
  console.log(`  parse error: ${parser.parse(code).rootNode.isError}`);
  code.split('\n').forEach((l, i) => {
    const n = i + 1;
    const extra = map[n] || 0;
    console.log(`  L${n} +${extra}tab | ${l.slice(0, 52)}`);
  });
}

console.log('='.repeat(64));
console.log('tree-sitter CFML semantic indentation — spike validation');
console.log('='.repeat(64));

// 1. fAy() deep nesting — MUST produce a hierarchy.
show('fAy() nested chain (expect hierarchy)', [
  "<cfset x = fAy(Tlt('Module'),'0',fAy(",
  "fAy(Tlt('Fraud'),'0',fAy(",
  "fAy(Tlt('Process'),'0',fAy(",
  "fAy(Tlt('Analysis'),'1','A','T','y','url','t','Id','')",
  "),'S','y','ns.cfm','t','Pc','')",
  "),'S','y','ns.cfm','a','Fd',''),",
  "fAy(Tlt('Chatbox'),'0',fAy(",
  "fAy(Tlt('Mobile'),'0',fAy(),'S','y','ai.cfm','b','Mb','')",
  "),x,y)",
  "),z,w)>",
].join('\n'), true);

// 2. struct literal — MUST stay flat (no call_expression nodes).
show('struct literal (expect flat)', [
  '<cfset _msg = {',
  '"a": q.a,',
  '"b": q.b',
  '}>',
].join('\n'), false);

// 3. simple SQL arg — MUST stay flat (single call, no nesting).
show('dbgQuery(sql) (expect flat)', [
  '<cfset r = dbgQuery(',
  '"SELECT * FROM t",',
  '_dsn)>',
].join('\n'), false);

// 4. function wrapping a struct — MUST stay flat (struct keys are pairs).
show('arrayAppend(arr, {...}) (expect flat)', [
  '<cfset x = arrayAppend(arr, {',
  '"key1": val1,',
  '"key2": val2',
  '})>',
].join('\n'), false);

console.log('\nSpike complete.');
