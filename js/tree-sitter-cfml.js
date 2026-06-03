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
		/* Depth = number of call_expression ANCESTORS (call-only depth), NOT
		 * raw CST depth. Raw depth counts the intervening assignment_expression
		 * / arguments / member_expression nodes too, so it steps unevenly (a
		 * Tlt(...) argument sits between fAy levels) and the shallowest-per-line
		 * depths are no longer monotonic by nesting level. Counting only
		 * call_expression ancestors makes each function-call nesting level
		 * advance the depth by a fixed amount, so per-line depths are monotonic
		 * and the factor normalizes cleanly to one tab per level. */
		(function walk(node, callDepth) {
			var isCall = node.type === 'call_expression';
			var d = isCall ? callDepth + 1 : callDepth;
			if (isCall) {
				calls.push({ depth: d, startRow: node.startPosition.row, endRow: node.endPosition.row });
			}
			for (var i = 0; i < node.childCount; i++) walk(node.child(i), d);
		})(tree.rootNode, 0);

		if (calls.length === 0) return {};

		/* startByRow: shallowest call STARTING on each row → drives opening-line
		 * indent. endByRow: shallowest call ENDING on each row → drives close-line
		 * indent (a leading `)` aligns to the OUTERMOST call it closes, i.e. the
		 * shallowest, whose opener line indent is the level we return to). */
		var startByRow = {};
		var endByRow = {};
		for (var c = 0; c < calls.length; c++) {
			var cur = calls[c];
			if (startByRow[cur.startRow] === undefined || cur.depth < startByRow[cur.startRow]) {
				startByRow[cur.startRow] = cur.depth;
			}
			if (endByRow[cur.endRow] === undefined || cur.depth < endByRow[cur.endRow].depth) {
				endByRow[cur.endRow] = { depth: cur.depth, startRow: cur.startRow };
			}
		}

		var startDepths = Object.keys(startByRow).map(function (k) { return startByRow[k]; });
		var minDepth = Math.min.apply(null, startDepths);

		/* factor = smallest positive gap between consecutive DISTINCT per-LINE
		 * START depths, so each nesting LEVEL maps to exactly one tab. Derive it
		 * from per-line START depths (not every call node): an argument call like
		 * Tlt(...) sits at an intermediate call depth, so using all nodes would
		 * halve the step and double the indent. */
		var depthSet = {};
		startDepths.forEach(function (d) { depthSet[d] = true; });
		var sortedDepths = Object.keys(depthSet).map(Number).sort(function (a, b) { return a - b; });
		var factor = Infinity;
		for (var s = 1; s < sortedDepths.length; s++) {
			var gap = sortedDepths[s] - sortedDepths[s - 1];
			if (gap > 0 && gap < factor) factor = gap;
		}
		if (!isFinite(factor) || factor < 1) factor = 1;

		/* Opening-line indent per 0-based row. */
		var openingIndent = {};
		Object.keys(startByRow).forEach(function (rowStr) {
			openingIndent[rowStr] = Math.floor((startByRow[rowStr] - minDepth) / factor);
		});

		/* Walk the source lines: a line whose first non-ws char is a closer
		 * (`)` `]` `}`) is a CLOSE line — align it to the opener indent of the
		 * shallowest call ending on it. Otherwise, if a call starts on the line,
		 * it is an OPENING line. A mixed `),fAy(` line is treated as close
		 * (first-char wins) — a documented edge, not built for. Returns a
		 * 1-based { line: extraTabs } map; lines that resolve to 0 are omitted. */
		var lines = String(code).split('\n');
		var out = {};
		for (var idx = 0; idx < lines.length; idx++) {
			var first = lines[idx].replace(/^[ \t]*/, '').charAt(0);
			var extra;
			if (first === ')' || first === ']' || first === '}') {
				var e = endByRow[idx];
				extra = (e && openingIndent[e.startRow] !== undefined) ? openingIndent[e.startRow] : 0;
			} else if (openingIndent[idx] !== undefined) {
				extra = openingIndent[idx];
			} else {
				extra = 0;
			}
			if (extra > 0) out[idx + 1] = extra;
		}
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
			/* Guard on hasError (whole-subtree), NOT isError (this node only).
			 * isError is true only when the node itself is an ERROR node — the
			 * root `program` almost never is, even when the expression is full
			 * of errors. An UNBALANCED block (mid-edit paste: more `(` than `)`)
			 * parses with isError===false but hasError===true; using isError
			 * would sail past this guard and apply collapsed/garbage indent.
			 * hasError is a GETTER in this web-tree-sitter build (not a method)
			 * — accessed as a property, no call. Malformed/incomplete input
			 * therefore falls back to the line-scanner output untouched. */
			if (!tree.rootNode.hasError) {
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

	/* Resolve a vendor path against the DOCUMENT base, not this script's URL.
	 * Critical: a dynamic import() inside a classic <script> resolves relative
	 * specifiers against the SCRIPT's URL (/js/…), turning './vendor/…' into
	 * '/js/vendor/…' (404), while fetch() resolves against document.baseURI
	 * ('/…'). Anchoring both to document.baseURI makes them consistent AND
	 * keeps it correct under a sub-path deploy (e.g. GitHub Pages project page
	 * '/ColdFusion-Code-Beautifier/'). */
	function tsUrl(file) {
		if (typeof document !== 'undefined' && document.baseURI) {
			return new URL(TS_BASE + file, document.baseURI).href;
		}
		return TS_BASE + file;
	}

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
			var TS = await import(tsUrl('web-tree-sitter.js'));
			var runtimeBytes = await (await fetch(tsUrl('web-tree-sitter.wasm'))).arrayBuffer();
			await TS.Parser.init({ wasmBinary: new Uint8Array(runtimeBytes) });
			var grammarBytes = await (await fetch(tsUrl('tree-sitter-cfml.wasm'))).arrayBuffer();
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
