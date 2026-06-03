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
	/* Collect call_expression nodes under `root` as {depth, startRow, endRow},
	 * where depth = number of call_expression ANCESTORS (call-only depth) and
	 * rows are made RELATIVE to `rowBase`. Call-only depth (not raw CST depth)
	 * is essential: raw depth counts intervening assignment/arguments/member
	 * nodes too, so it steps unevenly (a Tlt(...) argument sits between fAy
	 * levels) and per-line depths stop being monotonic by nesting level. */
	function collectCalls(root, rowBase) {
		var calls = [];
		(function walk(node, callDepth) {
			var isCall = node.type === 'call_expression';
			var d = isCall ? callDepth + 1 : callDepth;
			if (isCall) {
				calls.push({
					depth: d,
					startRow: node.startPosition.row - rowBase,
					endRow: node.endPosition.row - rowBase
				});
			}
			for (var i = 0; i < node.childCount; i++) walk(node.child(i), d);
		})(root, 0);
		return calls;
	}

	/* Core: turn a set of calls (rows relative to `lines`) into a 1-based
	 * { line: extraTabs } indent map. minDepth and factor are derived from THIS
	 * call set only — so calling it per-statement gives per-statement factoring
	 * (a deeper sibling statement can't rescale a shallower one's indent).
	 *
	 * Opening lines: indent from the shallowest call STARTING on the line.
	 * Close lines (first non-ws char is `)`/`]`/`}`): align to the opener indent
	 * of the shallowest (= outermost) call ENDING on the line, so a trailing
	 * `))` returns to the OUTER level. A mixed `),fAy(` line is treated as close
	 * (first-char wins) — documented edge, not built for. */
	function _indentFromCalls(calls, lines) {
		if (!calls.length) return {};
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

		/* factor = smallest positive gap between consecutive DISTINCT per-line
		 * START depths → one tab per nesting level. Per-line (not every call
		 * node) so an argument call like Tlt(...) at an intermediate depth does
		 * not halve the step and double the indent. */
		var depthSet = {};
		startDepths.forEach(function (d) { depthSet[d] = true; });
		var sortedDepths = Object.keys(depthSet).map(Number).sort(function (a, b) { return a - b; });
		var factor = Infinity;
		for (var s = 1; s < sortedDepths.length; s++) {
			var gap = sortedDepths[s] - sortedDepths[s - 1];
			if (gap > 0 && gap < factor) factor = gap;
		}
		if (!isFinite(factor) || factor < 1) factor = 1;

		var openingIndent = {};
		Object.keys(startByRow).forEach(function (rowStr) {
			openingIndent[rowStr] = Math.floor((startByRow[rowStr] - minDepth) / factor);
		});

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

	/* cfset/cfparam path: ONE expression → one scope, global factor is correct. */
	function computeCallIndentByLine(parser, code) {
		var tree = parser.parse(code);
		var calls = collectCalls(tree.rootNode, 0);
		return _indentFromCalls(calls, String(code).split('\n'));
	}

	/* cfscript path: MULTIPLE statements → factor MUST be per-statement, or a
	 * deeper sibling statement rescales a shallower one's indent (verified: a
	 * 2-deep and a 3-deep statement share a global factor of 1 and both get
	 * doubled). Walk each top-level statement independently, compute its own
	 * minDepth/factor scoped to its own line slice, then offset back. Guards on
	 * hasError (whole subtree) like the cfset path. */
	function computeCfscriptIndent(cfsParser, content) {
		var tree = cfsParser.parse(content);
		if (tree.rootNode.hasError) return {};
		var lines = content.split('\n');
		var out = {};
		var root = tree.rootNode;
		for (var s = 0; s < root.childCount; s++) {
			var stmt = root.child(s);
			var sr = stmt.startPosition.row;
			var er = stmt.endPosition.row;
			var calls = collectCalls(stmt, sr);          // rows relative to statement
			if (!calls.length) continue;
			var stmtLines = lines.slice(sr, er + 1);
			var localMap = _indentFromCalls(calls, stmtLines);  // 1-based within stmt
			Object.keys(localMap).forEach(function (k) {
				out[sr + Number(k)] = localMap[k];        // → content 1-based
			});
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
	function applySemanticIndentPostPass(output, cfmlParser, cfsParser) {
		if (!cfmlParser && !cfsParser) return output;
		var hasClose = (typeof hasTagCloseOutsideStrings === 'function')
			? hasTagCloseOutsideStrings
			: localHasTagClose;

		var lines = output.split('\n');
		var i = 0;
		while (i < lines.length) {
			var trimmed = lines[i].trim();

			/* ── <cfscript> … </cfscript> block (cfscript grammar) ──────────────
			 * Content between the tags is multiple statements, so indent is
			 * computed PER STATEMENT (computeCfscriptIndent). Content sits one
			 * level inside the <cfscript> tag, so its base indent is the tag's
			 * indent + 1 tab. Tag lines themselves are left untouched. */
			if (cfsParser && /^<cfscript\b/i.test(trimmed) && !/<\/cfscript>/i.test(trimmed)) {
				var csOpen = i;
				var csClose = -1;
				for (var cj = i + 1; cj < lines.length; cj++) {
					if (/<\/cfscript>/i.test(lines[cj])) { csClose = cj; break; }
				}
				if (csClose === -1 || csClose === csOpen + 1) { i = (csClose === -1) ? i + 1 : csClose + 1; continue; }

				var tagIndent = (lines[csOpen].match(/^[ \t]*/) || [''])[0];
				var contentBase = tagIndent + '\t';
				var contentLines = lines.slice(csOpen + 1, csClose);
				var contentTrim = contentLines.map(function (l) { return l.trim(); }).join('\n');

				var cmap = computeCfscriptIndent(cfsParser, contentTrim);  // {} if hasError
				if (Object.keys(cmap).length > 0) {
					for (var ck = 0; ck < contentLines.length; ck++) {
						var cextra = cmap[ck + 1] || 0;   // 1-based within content
						lines[csOpen + 1 + ck] = contentBase
							+ new Array(cextra + 1).join('\t')
							+ contentLines[ck].trim();
					}
				}
				i = csClose + 1;
				continue;
			}

			/* ── <cfset …> / <cfparam …> multi-line block (cfml grammar) ────────*/
			var isInlineOpen = /^<(cfset|cfparam)\b/i.test(trimmed);
			if (!cfmlParser || !isInlineOpen || hasClose(lines[i])) { i++; continue; }

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

			var tree = cfmlParser.parse(trimmedBlock);
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
				var indentMap = computeCallIndentByLine(cfmlParser, trimmedBlock);
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
	 * Loads the vendored ESM glue + core runtime WASM once, then each grammar
	 * (cfml ~2.6 MB, cfscript ~2.1 MB) on first use of its path — so a user who
	 * only ever indents <cfset> blocks never fetches the cfscript grammar, and
	 * vice-versa. Idempotent: concurrent callers share one in-flight promise. */
	var TS_BASE = './vendor/tree-sitter/';
	var _TS = null;              // glue module { Parser, Language }
	var _initPromise = null;     // runtime init (once, shared by both grammars)
	var _cfmlParser = null, _cfmlPromise = null;
	var _cfsParser = null, _cfsPromise = null;

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

	function _ensureRuntime() {
		if (_TS) return Promise.resolve(_TS);
		if (_initPromise) return _initPromise;
		_initPromise = (async function () {
			var TS = await import(tsUrl('web-tree-sitter.js'));
			var runtimeBytes = await (await fetch(tsUrl('web-tree-sitter.wasm'))).arrayBuffer();
			await TS.Parser.init({ wasmBinary: new Uint8Array(runtimeBytes) });
			_TS = TS;
			return TS;
		})();
		_initPromise.catch(function () { _initPromise = null; });
		return _initPromise;
	}

	function _loadGrammar(file) {
		return _ensureRuntime().then(function (TS) {
			return (async function () {
				var bytes = await (await fetch(tsUrl(file))).arrayBuffer();
				var lang = await TS.Language.load(new Uint8Array(bytes));
				var p = new TS.Parser();
				p.setLanguage(lang);
				return p;
			})();
		});
	}

	function isTreeSitterCFMLLoaded() { return _cfmlParser !== null; }
	function getCfmlParser() { return _cfmlParser; }
	function ensureTreeSitterCFML() {
		if (typeof window === 'undefined') {
			return Promise.reject(new Error('tree-sitter CFML requires a browser environment.'));
		}
		if (_cfmlParser) return Promise.resolve(_cfmlParser);
		if (_cfmlPromise) return _cfmlPromise;
		_cfmlPromise = _loadGrammar('tree-sitter-cfml.wasm').then(function (p) { _cfmlParser = p; return p; });
		_cfmlPromise.catch(function () { _cfmlPromise = null; });
		return _cfmlPromise;
	}

	function isTreeSitterCFScriptLoaded() { return _cfsParser !== null; }
	function getCfsParser() { return _cfsParser; }
	function ensureTreeSitterCFScript() {
		if (typeof window === 'undefined') {
			return Promise.reject(new Error('tree-sitter CFScript requires a browser environment.'));
		}
		if (_cfsParser) return Promise.resolve(_cfsParser);
		if (_cfsPromise) return _cfsPromise;
		_cfsPromise = _loadGrammar('tree-sitter-cfscript.wasm').then(function (p) { _cfsParser = p; return p; });
		_cfsPromise.catch(function () { _cfsPromise = null; });
		return _cfsPromise;
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

	/* Cheap pre-check for the cfscript path: is there a <cfscript> block whose
	 * body has a line ending in `(` followed by a non-more-indented line (a flat
	 * multi-line nested call)? Gates the 2.1 MB cfscript grammar fetch. */
	function hasFlatCfscriptBlock(code) {
		var lines = String(code || '').split('\n');
		var inScript = false;
		for (var i = 0; i < lines.length; i++) {
			var t = lines[i].trim();
			if (!inScript) {
				if (/^<cfscript\b/i.test(t) && !/<\/cfscript>/i.test(t)) inScript = true;
				continue;
			}
			if (/<\/cfscript>/i.test(t)) { inScript = false; continue; }
			// Inside cfscript body: a line ending in `(` that opens a call.
			if (/\(\s*$/.test(lines[i])) {
				for (var j = i + 1; j < lines.length; j++) {
					if (lines[j].trim() === '') continue;
					var openIndent = (lines[i].match(/^[ \t]*/) || [''])[0].length;
					var contIndent = (lines[j].match(/^[ \t]*/) || [''])[0].length;
					if (contIndent <= openIndent) return true;
					break;
				}
			}
		}
		return false;
	}

	// ── Exports ────────────────────────────────────────────────────────────────
	var api = {
		computeCallIndentByLine: computeCallIndentByLine,
		computeCfscriptIndent: computeCfscriptIndent,
		applySemanticIndentPostPass: applySemanticIndentPostPass,
		ensureTreeSitterCFML: ensureTreeSitterCFML,
		isTreeSitterCFMLLoaded: isTreeSitterCFMLLoaded,
		getCfmlParser: getCfmlParser,
		ensureTreeSitterCFScript: ensureTreeSitterCFScript,
		isTreeSitterCFScriptLoaded: isTreeSitterCFScriptLoaded,
		getCfsParser: getCfsParser,
		hasFlatInlineTagBlock: hasFlatInlineTagBlock,
		hasFlatCfscriptBlock: hasFlatCfscriptBlock
	};

	// Browser globals (classic <script> usage).
	global.computeCallIndentByLine = computeCallIndentByLine;
	global.computeCfscriptIndent = computeCfscriptIndent;
	global.applySemanticIndentPostPass = applySemanticIndentPostPass;
	global.ensureTreeSitterCFML = ensureTreeSitterCFML;
	global.isTreeSitterCFMLLoaded = isTreeSitterCFMLLoaded;
	global.getCfmlParser = getCfmlParser;
	global.ensureTreeSitterCFScript = ensureTreeSitterCFScript;
	global.isTreeSitterCFScriptLoaded = isTreeSitterCFScriptLoaded;
	global.getCfsParser = getCfsParser;
	global.hasFlatInlineTagBlock = hasFlatInlineTagBlock;
	global.hasFlatCfscriptBlock = hasFlatCfscriptBlock;

	// Node/CommonJS (test harness).
	if (typeof module !== 'undefined' && module.exports) {
		module.exports = api;
	}
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
