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
check('B3 close-paren lines not indented (MVP)', !map[4] && !map[5], 'map=' + JSON.stringify(map));

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

check('C1 post-pass output parses without error',
	parser.parse(ppLines.map((l) => l.trim()).join('\n')).rootNode.isError === false);
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

// ── Summary ──────────────────────────────────────────────────────────────────
console.log('');
if (failures === 0) {
	console.log('All tree-sitter tests passed.');
} else {
	console.log(failures + ' tree-sitter test(s) FAILED.');
	process.exitCode = 1;
}
