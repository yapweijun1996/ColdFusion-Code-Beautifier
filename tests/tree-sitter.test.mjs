/**
 * Standalone tree-sitter CFML semantic-indentation tests.
 *
 * Runs OUTSIDE the vm-based tests/run-tests.js harness because that harness
 * has no `window`/WebAssembly and the semantic path can never fire there.
 * This file builds a real tree-sitter parser from the vendored WASM and
 * exercises the pure algorithm + post-pass directly. Self-contained fixtures
 * (no dependency on the gitignored sample/ folder) so it runs on a fresh clone.
 *
 * RUN:  node tests/tree-sitter.test.mjs
 */

import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath, pathToFileURL } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const require = createRequire(import.meta.url);

// ── Build a real parser from vendored WASM ───────────────────────────────────
const VENDOR = path.join(root, 'vendor', 'tree-sitter');
const TS = await import(pathToFileURL(path.join(VENDOR, 'web-tree-sitter.js')).href);
await TS.Parser.init({ wasmBinary: fs.readFileSync(path.join(VENDOR, 'web-tree-sitter.wasm')) });
const cfmlLang = await TS.Language.load(fs.readFileSync(path.join(VENDOR, 'tree-sitter-cfml.wasm')));
const parser = new TS.Parser();
parser.setLanguage(cfmlLang);

// ── Load the algorithm under test (CommonJS) ─────────────────────────────────
const tsCfml = require('../js/tree-sitter-cfml.js');

// ── Load the beautifier into a vm context (for end-to-end output) ────────────
function loadBeautifier() {
	const scripts = [
		'js/cf-tags.js', 'js/sql-keywords.js', 'js/sql-beautifier.js',
		'js/js-lexer-utils.js', 'js/deep-format.js', 'js/tag-utils.js',
		'js/cfml-splitter.js', 'js/toast.js', 'js/clipboard.js', 'js/beautifier.js'
	];
	const code = scripts.map((f) => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
	const ctx = { console: { log() {}, warn() {} } };
	vm.createContext(ctx);
	vm.runInContext(code, ctx);
	return ctx;
}
const bctx = loadBeautifier();

// ── Tiny test runner ─────────────────────────────────────────────────────────
let failures = 0;
function check(name, cond, detail) {
	if (cond) {
		console.log('PASS: ' + name);
	} else {
		failures++;
		console.log('FAIL: ' + name + (detail ? '\n  ' + detail : ''));
	}
}

// ── Part A: spike algorithm (hierarchy vs flat) ──────────────────────────────
function hasHierarchy(code) {
	return Object.keys(tsCfml.computeCallIndentByLine(parser, code)).length > 0;
}

check('A1 fAy() nested chain produces hierarchy', hasHierarchy([
	"<cfset x = fAy(Tlt('Module'),'0',fAy(",
	"fAy(Tlt('Fraud'),'0',fAy(",
	"fAy(Tlt('Process'),'0',fAy(",
	"fAy(Tlt('Analysis'),'1','A','url','Id','')",
	"),'S','y','ns.cfm','Pc','')",
	"),'S','y','ns.cfm','Fd',''),",
	"fAy(Tlt('Chatbox'),'0',fAy(",
	"fAy(Tlt('Mobile'),'0',fAy(),'S','y','ai.cfm','Mb','')",
	"),x,y)",
	"),z,w)>"
].join('\n')) === true);

check('A2 struct literal stays flat', hasHierarchy([
	'<cfset _msg = {', '"a": q.a,', '"b": q.b', '}>'
].join('\n')) === false);

check('A3 dbgQuery(sql) stays flat', hasHierarchy([
	'<cfset r = dbgQuery(', '"SELECT * FROM t",', '_dsn)>'
].join('\n')) === false);

check('A4 arrayAppend(arr,{...}) stays flat', hasHierarchy([
	'<cfset x = arrayAppend(arr, {', '"key1": val1,', '"key2": val2', '})>'
].join('\n')) === false);

// ── Part B: per-line tab depths for the canonical fAy() fixture ──────────────
const fixtureFlat = [
	"<cfset x = fAy(Tlt('Module'),'0',fAy(",
	"fAy(Tlt('Fraud'),'0',fAy(",
	"fAy(Tlt('Analysis'),'1','A','url','Id','')",
	"),'S','y','ns.cfm','Pc','')",
	"),'S','y','','Ai','')>"
].join('\n');
const map = tsCfml.computeCallIndentByLine(parser, fixtureFlat);
check('B1 line2 (Fraud) deeper than line1', (map[2] || 0) > 0, 'map=' + JSON.stringify(map));
check('B2 line3 (Analysis) deepest', (map[3] || 0) > (map[2] || 0), 'map=' + JSON.stringify(map));
// Enh 2: close-paren lines align to the level they return to. L4 closes the
// Fraud-level call (opener L2, indent 1) → L4 indent 1. L5 closes back to the
// outermost (opener L1, indent 0) → omitted (base).
check('B3 close line L4 aligns to Fraud level (1)', (map[4] || 0) === 1, 'map=' + JSON.stringify(map));
check('B3b close line L5 returns to base (0)', !map[5], 'map=' + JSON.stringify(map));

// Enh 2: multi-level close on ONE line must align to the OUTERMOST opener, not
// the innermost. Here a single trailing line closes several levels that opened
// on different lines; the shallowest-ending-call rule picks the outer level.
const multiClose = [
	"<cfset x = fAy(",
	"fAy(",
	"fAy(Tlt('deep'))))",
	""
].join('\n');
const mcMap = tsCfml.computeCallIndentByLine(parser, multiClose);
check('B4 multi-level openers step 0,1,2', (mcMap[2] || 0) === 1 && (mcMap[3] || 0) === 2,
	'mcMap=' + JSON.stringify(mcMap));

// ── Part C: post-pass on REAL beautifier output ──────────────────────────────
// Expose the beautifier's string-aware tag-close helper so the post-pass uses
// the production block detector (not the fallback).
globalThis.hasTagCloseOutsideStrings = bctx.hasTagCloseOutsideStrings;

const realSample = [
	"<cfset myAry1c[ai_ary] = fAy( Tlt(\"<cfif set_language is 'english'>AI Module</cfif>\"),'0',fAy(",
	"fAy( Tlt(\"<cfif set_language is 'english'>Fraud</cfif>\"),'0',fAy(",
	"fAy( Tlt(\"<cfif set_language is 'english'>Analysis</cfif>\"),'1','A','url','Id','')",
	"),'S','y','ns.cfm','Pc','')",
	"),'S','y','','Ai','')>"
].join('\n');

const beautified = bctx.beautifyCFML(realSample, false, true, false, 0);
const afterPostPass = tsCfml.applySemanticIndentPostPass(beautified, parser);
const ppLines = afterPostPass.split('\n');

function leadTabs(s) { return (s.match(/^\t*/) || [''])[0].length; }

check('C1 post-pass output parses cleanly (hasError false on whole subtree)',
	parser.parse(ppLines.map((l) => l.trim()).join('\n')).rootNode.hasError === false);
check('C2 Fraud line indented deeper than cfset opener',
	leadTabs(ppLines[1]) > leadTabs(ppLines[0]),
	'opener=' + leadTabs(ppLines[0]) + ' fraud=' + leadTabs(ppLines[1]));
check('C3 Analysis line deepest',
	leadTabs(ppLines[2]) > leadTabs(ppLines[1]),
	'fraud=' + leadTabs(ppLines[1]) + ' analysis=' + leadTabs(ppLines[2]));
check('C4 content preserved (trim-equal to input lines)',
	ppLines.map((l) => l.trim()).join('\n') === realSample.split('\n').map((l) => l.trim()).join('\n'));
// Exactly one tab per nesting level (locks the call-only-depth + per-line
// factor fix; raw CST depth or all-node factor would give 2/4 here).
check('C5 one tab per level: Fraud=1, Analysis=2',
	leadTabs(ppLines[1]) === 1 && leadTabs(ppLines[2]) === 2,
	'fraud=' + leadTabs(ppLines[1]) + ' analysis=' + leadTabs(ppLines[2]));

// ── Part D: idempotency across the mechanism switch (advisor's key trap) ─────
// beautify(flat) → indented;  post-pass(beautify(that)) must equal the first.
const pass1 = tsCfml.applySemanticIndentPostPass(
	bctx.beautifyCFML(realSample, false, true, false, 0), parser);
const pass2 = tsCfml.applySemanticIndentPostPass(
	bctx.beautifyCFML(pass1, false, true, false, 0), parser);
check('D1 post-pass is idempotent (pass1 === pass2)', pass1 === pass2,
	'pass1 !== pass2 — mechanism-switch drift');

// D2: an UNBALANCED (mid-edit) block — more openers than closers — parses with
// rootNode.isError===false but hasError===true. The hasError guard must leave
// it exactly as the line-scanner produced it (no mis-indent on incomplete code).
const unbalanced = [
	"<cfset x = fAy(Tlt('Module'),'0',fAy(",
	"fAy(Tlt('Fraud'),'0',fAy(",
	"fAy(Tlt('Process'),'0',fAy(",
	"fAy(Tlt('Analysis'),'1','A','url','Id','')",
	"),'S','y','ns.cfm','Pc','')",
	"),'S','y','','Ai','')>"
].join('\n');
const unbBeautified = bctx.beautifyCFML(unbalanced, false, true, false, 0);
const unbAfter = tsCfml.applySemanticIndentPostPass(unbBeautified, parser);
check('D2 unbalanced block left unchanged (hasError guard fires)',
	unbAfter === unbBeautified,
	'post-pass mutated malformed input — guard did not fire');

// ── Part E: full 10-line BRANCHED sample (close-then-sibling-open) ───────────
// This is the structural case the real input hits and the 5-line sample does
// NOT: a close line (L6, end of the AiFd branch) immediately followed by a
// sibling opener (L7, the AiCb branch). Verifies enh-2 close alignment AND that
// a sibling branch after a close returns to the right level.
const tenLine = [
	"<cfset menu = fAy( Tlt('AI Module'),'0',fAy(",
	"fAy( Tlt('Fraud'),'0',fAy(",
	"fAy( Tlt('Process'),'0',fAy(",
	"fAy( Tlt('Analysis'),'1','A','url','AiFdPcAd','')",
	"),'S','y','ns.cfm','top','AiFdPc','')",
	"),'S','y','ns.cfm','app','AiFd',''),",
	"fAy( Tlt('AI Chatbox'),'0',fAy(",
	"fAy( Tlt('Mobile'),'0',fAy(),'S','y','ai.cfm','bot','Mb','')",
	"),'S','y','ns.cfm','app','AiCb','')",
	"),'S','y','','app','Ai','')>"
].join('\n');
const tenBeautified = bctx.beautifyCFML(tenLine, false, true, false, 0);
const tenPP = tsCfml.applySemanticIndentPostPass(tenBeautified, parser).split('\n');
const tenTabs = tenPP.map(leadTabs);
// Opening hierarchy: Module L1=0, Fraud L2=1, Process L3=2, Analysis L4=3,
// and the sibling AI Chatbox L7 back at 1 (same as Fraud), Mobile L8=2.
check('E1 opening hierarchy 0,1,2,3',
	tenTabs[0] === 0 && tenTabs[1] === 1 && tenTabs[2] === 2 && tenTabs[3] === 3,
	'tabs=' + JSON.stringify(tenTabs));
check('E2 sibling branch after close returns to level 1 (Chatbox=1, Mobile=2)',
	tenTabs[6] === 1 && tenTabs[7] === 2,
	'tabs=' + JSON.stringify(tenTabs));
check('E3 content preserved over full sample',
	tenPP.map((l) => l.trim()).join('\n') === tenLine.split('\n').map((l) => l.trim()).join('\n'));
// Idempotency on the branched sample (close lines now move — re-guard D1's class).
const tenPass2 = tsCfml.applySemanticIndentPostPass(
	bctx.beautifyCFML(tenPP.join('\n'), false, true, false, 0), parser).split('\n');
check('E4 idempotent on branched sample (close lines stable)',
	tenPass2.map(leadTabs).join(',') === tenTabs.join(','),
	'p1=' + tenTabs.join(',') + ' p2=' + tenPass2.map(leadTabs).join(','));

// ── Summary ──────────────────────────────────────────────────────────────────
console.log('');
if (failures === 0) {
	console.log('All tree-sitter tests passed.');
} else {
	console.log(failures + ' tree-sitter test(s) FAILED.');
	process.exitCode = 1;
}
