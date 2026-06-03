/* tree-sitter CFML — semantic indentation for flat (zero-indent) multi-line
 * inline-CF-tag expressions (e.g. a `<cfset x = fAy(fAy(fAy(...)))>` chain
 * pasted with no indentation).
 *
 * WHY THIS EXISTS
 *   The line-scanner in beautifier.js preserves the author's *original*
 *   continuation indentation. When the input is flat there is nothing to
 *   preserve, so deeply-nested function chains all collapse to one level.
 *   Bracket-counting can't fix it without also wrongly indenting struct
 *   literals / SQL-string args. The CST distinguishes them for free: only
 *   `call_expression` nodes carry nesting depth, so keying indentation off
 *   call_expression CST depth indents fAy() chains while leaving structs,
 *   SQL strings and plain args flat — automatically (proven in
 *   tools/spike-tree-sitter.mjs).
 *
 * SHAPE
 *   - computeCallIndentByLine(parser, code)  pure algorithm (parser injected)
 *   - applySemanticIndentPostPass(output, parser)  rewrite cfset/cfparam blocks
 *   - ensureTreeSitterCFML() / isTreeSitterCFMLLoaded() / getCfmlParser()
 *       browser-only lazy loader (dynamic import + WASM fetch from vendor/)
 *
 * The pure functions take an already-initialized tree-sitter `parser` so the
 * SAME code runs in the browser (lazy-loaded parser) and in the Node test
 * suite (parser built directly from the vendored WASM). No environment
 * branching inside the algorithm.
 */

(function (global) {
	'use strict';

	/* ── Pure algorithm ──────────────────────────────────────────────────────
	 * Returns { lineNumber(1-based) : extraTabs } for every line on which the
	 * shallowest call_expression starts deeper than the snippet's minimum call
	 * depth. Lines with no call_expression starting on them (closing-paren
	 * lines, struct bodies, plain args) are ABSENT → caller leaves them at the
	 * block's base indent. Returns {} when there is no nesting to express. */
	function computeCallIndentByLine(parser, code) {
		var tree = parser.parse(code);
		var calls = [];
		(function walk(node, depth) {
			if (node.type === 'call_expression') {
				calls.push({ depth: depth, line: node.startPosition.row + 1 });
			}
			for (var i = 0; i < node.childCount; i++) walk(node.child(i), depth + 1);
		})(tree.rootNode, 0);

		if (calls.length === 0) return {};

		var byLine = {};
		for (var c = 0; c < calls.length; c++) {
			var cur = calls[c];
			if (byLine[cur.line] === undefined || cur.depth < byLine[cur.line]) {
				byLine[cur.line] = cur.depth;
			}
		}

		var allDepths = calls.map(function (x) { return x.depth; });
		var minDepth = Math.min.apply(null, allDepths);

		// factor = smallest positive depth delta = one nesting level in CST terms
		var deltaSet = {};
		for (var d = 0; d < calls.length; d++) {
			var delta = calls[d].depth - minDepth;
			if (delta > 0) deltaSet[delta] = true;
		}
		var deltas = Object.keys(deltaSet).map(Number);
		var factor = deltas.length ? Math.min.apply(null, deltas) : 1;

		var out = {};
		Object.keys(byLine).forEach(function (lineStr) {
			var extra = Math.floor((byLine[lineStr] - minDepth) / factor);
			if (extra > 0) out[Number(lineStr)] = extra;
		});
		return out;
	}

	/* ── Block-aware post-pass ────────────────────────────────────────────────
	 * Scans beautifier OUTPUT for multi-line inline-CF-tag expression blocks
	 * (<cfset ...> / <cfparam ...> whose closing `>` is on a later line) and
	 * re-indents each continuation line by its call_expression CST depth.
	 *
	 * Block detection reuses the beautifier's own hasTagCloseOutsideStrings so
	 * a `>` inside a string/comment never ends the block early. Each block's
	 * base indent is the leading whitespace of its first (<cfset) line; every
	 * continuation line is rewritten as base + extraTabs + trimmedContent.
	 *
	 * Conservative: only fires when a block actually parses (isError false) AND
	 * computeCallIndentByLine returns at least one indented line. Otherwise the
	 * block is left exactly as the line-scanner produced it. */
	function applySemanticIndentPostPass(output, parser) {
		if (!parser) return output;
		var hasClose = (typeof hasTagCloseOutsideStrings === 'function')
			? hasTagCloseOutsideStrings
			: localHasTagClose;

		var lines = output.split('\n');
		var i = 0;
		while (i < lines.length) {
			var trimmed = lines[i].trim();
			var isInlineOpen = /^<(cfset|cfparam)\b/i.test(trimmed);
			if (!isInlineOpen || hasClose(lines[i])) { i++; continue; }

			// Collect the block: from this line until the line whose `>` closes
			// the tag (string/comment-aware via hasTagCloseOutsideStrings).
			var start = i;
			var end = i;
			for (var j = i + 1; j < lines.length; j++) {
				end = j;
				if (hasClose(lines[j])) break;
			}
			if (end === start) { i++; continue; }   // never closed → skip

			var baseIndent = (lines[start].match(/^[ \t]*/) || [''])[0];
			var blockLines = lines.slice(start, end + 1);
			var trimmedBlock = blockLines.map(function (l) { return l.trim(); }).join('\n');

			var tree = parser.parse(trimmedBlock);
			if (!tree.rootNode.isError) {
				var indentMap = computeCallIndentByLine(parser, trimmedBlock);
				if (Object.keys(indentMap).length > 0) {
					for (var k = 0; k < blockLines.length; k++) {
						var extra = indentMap[k + 1] || 0;   // 1-based within block
						lines[start + k] = baseIndent
							+ new Array(extra + 1).join('\t')
							+ blockLines[k].trim();
					}
				}
			}
			i = end + 1;
		}
		return lines.join('\n');
	}

	/* Minimal fallback when the beautifier's helper isn't on the global (e.g.
	 * a unit test loading this file alone). Good enough for plain cfset lines;
	 * the real helper handles string/comment-embedded `>` far more carefully. */
	function localHasTagClose(s) {
		var q = null;
		for (var i = 0; i < s.length; i++) {
			var ch = s[i];
			if (q) { if (ch === q) q = null; continue; }
			if (ch === '"' || ch === "'") { q = ch; continue; }
			if (ch === '>') return true;
		}
		return false;
	}

	/* ── Browser lazy-loader ──────────────────────────────────────────────────
	 * Loads the vendored ESM glue + core runtime WASM + CFML grammar WASM on
	 * first use, so users who never trigger semantic indent fetch zero bytes.
	 * Idempotent: concurrent callers share one in-flight promise. */
	var TS_BASE = './vendor/tree-sitter/';
	var _parser = null;
	var _promise = null;

	function isTreeSitterCFMLLoaded() {
		return _parser !== null;
	}

	function getCfmlParser() {
		return _parser;
	}

	function ensureTreeSitterCFML() {
		if (typeof window === 'undefined') {
			return Promise.reject(new Error('tree-sitter CFML requires a browser environment.'));
		}
		if (_parser) return Promise.resolve(_parser);
		if (_promise) return _promise;

		_promise = (async function () {
			var TS = await import(TS_BASE + 'web-tree-sitter.js');
			var runtimeBytes = await (await fetch(TS_BASE + 'web-tree-sitter.wasm')).arrayBuffer();
			await TS.Parser.init({ wasmBinary: new Uint8Array(runtimeBytes) });
			var grammarBytes = await (await fetch(TS_BASE + 'tree-sitter-cfml.wasm')).arrayBuffer();
			var lang = await TS.Language.load(new Uint8Array(grammarBytes));
			var p = new TS.Parser();
			p.setLanguage(lang);
			_parser = p;
			return p;
		})();
		// On failure, clear the cached promise so a later attempt can retry.
		_promise.catch(function () { _promise = null; });
		return _promise;
	}

	/* Cheap pre-check: is there a multi-line inline-CF-tag block whose
	 * continuation lines look under-indented relative to the opener? Used to
	 * decide whether the 2.6 MB grammar is worth fetching at all. */
	function hasFlatInlineTagBlock(code) {
		var lines = String(code || '').split('\n');
		for (var i = 0; i < lines.length; i++) {
			var t = lines[i].trim();
			if (!/^<(cfset|cfparam)\b/i.test(t)) continue;
			if (/>\s*$/.test(t)) continue;                 // single-line tag
			// Opener has no `>`; look at the next non-blank line's indentation.
			for (var j = i + 1; j < lines.length; j++) {
				if (lines[j].trim() === '') continue;
				var openerIndent = (lines[i].match(/^[ \t]*/) || [''])[0].length;
				var contIndent = (lines[j].match(/^[ \t]*/) || [''])[0].length;
				if (contIndent <= openerIndent) return true;  // flat / under-indented
				break;
			}
		}
		return false;
	}

	// ── Exports ────────────────────────────────────────────────────────────────
	var api = {
		computeCallIndentByLine: computeCallIndentByLine,
		applySemanticIndentPostPass: applySemanticIndentPostPass,
		ensureTreeSitterCFML: ensureTreeSitterCFML,
		isTreeSitterCFMLLoaded: isTreeSitterCFMLLoaded,
		getCfmlParser: getCfmlParser,
		hasFlatInlineTagBlock: hasFlatInlineTagBlock
	};

	// Browser globals (classic <script> usage).
	global.computeCallIndentByLine = computeCallIndentByLine;
	global.applySemanticIndentPostPass = applySemanticIndentPostPass;
	global.ensureTreeSitterCFML = ensureTreeSitterCFML;
	global.isTreeSitterCFMLLoaded = isTreeSitterCFMLLoaded;
	global.getCfmlParser = getCfmlParser;
	global.hasFlatInlineTagBlock = hasFlatInlineTagBlock;

	// Node/CommonJS (test harness).
	if (typeof module !== 'undefined' && module.exports) {
		module.exports = api;
	}
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
