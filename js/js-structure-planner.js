/*
 * AST-backed JavaScript indentation planner.
 *
 * It consumes the parse/token contract exposed by js/js-structure.js and
 * returns a line plan instead of regenerating JavaScript.  A caller may apply
 * the plan with applyJavaScriptIndentPlan; that helper only rewrites leading
 * whitespace and verifies the result before returning it.
 *
 * Supported owners include blocks, containers, calls, computed keys, expression
 * continuations, switch statements, and switch cases.
 * Multiline control headers are protected and left at their source alignment.
 * The planner is intentionally conservative: an unavailable parser, CFML/HTML
 * markup, unsupported control-body shape, unbalanced delimiter map, stale
 * plan, or failed semantic/lexical verification returns null.
 */
(function(root) {
	'use strict';

	var CLOSE_LABELS = { ')': true, ']': true, '}': true };
	var OPEN_TO_CLOSE = { '(': ')', '[': ']', '{': '}' };
	var CONTROL_BODY_TYPES = {
		ForStatement: true,
		ForInStatement: true,
		ForOfStatement: true,
		WhileStatement: true,
		DoWhileStatement: true,
		WithStatement: true
	};
	var CONTROL_HEADER_TYPES = {
		IfStatement: true,
		ForStatement: true,
		ForInStatement: true,
		ForOfStatement: true,
		WhileStatement: true,
		DoWhileStatement: true,
		WithStatement: true,
		SwitchStatement: true
	};
	var PARAMETER_HEADER_TYPES = {
		FunctionDeclaration: true,
		FunctionExpression: true,
		ArrowFunctionExpression: true,
		CatchClause: true
	};
	var UNSUPPORTED_TYPES = {
		ClassDeclaration: true,
		ClassExpression: true,
		JSXElement: true,
		JSXFragment: true,
		ImportExpression: true,
		MetaProperty: true
	};

	function isNode(value) {
		return value && typeof value === 'object'
			&& typeof value.type === 'string'
			&& typeof value.start === 'number'
			&& typeof value.end === 'number';
	}

	function walk(node, visitor) {
		if (!isNode(node)) return;
		visitor(node);
		for (var key in node) {
			if (!Object.prototype.hasOwnProperty.call(node, key)
					|| key === 'loc' || key === 'tokens' || key === 'comments') continue;
			var value = node[key];
			if (Array.isArray(value)) {
				for (var i = 0; i < value.length; i++) {
					if (isNode(value[i])) walk(value[i], visitor);
				}
			} else if (isNode(value)) {
				walk(value, visitor);
			}
		}
	}

	function buildLineIndex(source) {
		var starts = [0];
		for (var i = 0; i < source.length; i++) {
			if (source[i] === '\r') {
				if (source[i + 1] === '\n') i++;
				starts.push(i + 1);
			} else if (source[i] === '\n') {
				starts.push(i + 1);
			}
		}
		return {
			starts: starts,
			lines: source.split(/\r\n|\r|\n/),
			newline: source.indexOf('\r\n') !== -1 ? '\r\n'
				: (source.indexOf('\r') !== -1 ? '\r' : '\n')
		};
	}

	function lineAt(starts, offset) {
		var low = 0;
		var high = starts.length - 1;
		var target = Math.max(0, Math.min(offset, starts[starts.length - 1]));
		while (low <= high) {
			var middle = Math.floor((low + high) / 2);
			if (starts[middle] <= target) low = middle + 1;
			else high = middle - 1;
		}
		return Math.max(0, high);
	}

	function firstContentOffset(source, index, lineIndex) {
		var start = lineIndex.starts[index];
		var text = lineIndex.lines[index] || '';
		var offset = 0;
		while (offset < text.length && /[ \t]/.test(text[offset])) offset++;
		return start + offset;
	}

	function isOpaqueOffset(ranges, offset) {
		var low = 0;
		var high = ranges.length;
		while (low < high) {
			var middle = Math.floor((low + high) / 2);
			if (ranges[middle].start > offset) high = middle;
			else low = middle + 1;
		}
		return low > 0 && ranges[low - 1].maxEnd > offset;
	}

	function collectOpaqueRanges(parsed, nodes) {
		var ranges = [];
		var comments = parsed.comments || [];
		for (var i = 0; i < comments.length; i++) {
			ranges.push({
				start: comments[i].start,
				end: comments[i].end,
				kind: comments[i].type === 'Block' ? 'block-comment' : 'line-comment'
			});
		}

		var tokens = parsed.tokens || [];
		for (var j = 0; j < tokens.length; j++) {
			var label = tokens[j].type && tokens[j].type.label;
			if (label === 'string' || label === 'regexp') {
				ranges.push({ start: tokens[j].start, end: tokens[j].end, kind: label });
			}
		}

		/* Use parsed TemplateLiteral ranges instead of pairing backticks in the
		 * token stream: nested templates make a flat backtick stack ambiguous. */
		nodes.forEach(function(node) {
			if (node.type === 'TemplateLiteral') {
				ranges.push({ start: node.start, end: node.end, kind: 'template' });
			}
		});
		ranges.sort(function(left, right) {
			return left.start - right.start || left.end - right.end;
		});
		var maxEnd = 0;
		for (var rangeIndex = 0; rangeIndex < ranges.length; rangeIndex++) {
			if (ranges[rangeIndex].end > maxEnd) maxEnd = ranges[rangeIndex].end;
			ranges[rangeIndex].maxEnd = maxEnd;
		}
		return ranges;
	}

	function buildDelimiterPairs(tokens, opaqueRanges) {
		var stacks = { '(': [], '[': [], '{': [] };
		var pairs = {};
		for (var i = 0; i < tokens.length; i++) {
			var token = tokens[i];
			if (isOpaqueOffset(opaqueRanges, token.start)) continue;
			var label = token.type && token.type.label;
			if (OPEN_TO_CLOSE[label]) {
				stacks[label].push(token);
				continue;
			}
			if (!CLOSE_LABELS[label]) continue;
			var opener = label === ')' ? '('
				: (label === ']' ? '[' : '{');
			if (stacks[opener].length === 0) return null;
			opener = stacks[opener].pop();
			pairs[opener.start] = token;
			pairs[token.start] = opener;
		}
		if (stacks['('].length || stacks['['].length || stacks['{'].length) return null;
		return pairs;
	}

	function firstTokenAtOrAfter(tokens, offset) {
		var low = 0;
		var high = tokens.length;
		while (low < high) {
			var middle = Math.floor((low + high) / 2);
			if (tokens[middle].start < offset) low = middle + 1;
			else high = middle;
		}
		return low;
	}

	function findToken(tokens, start, end, label, opaqueRanges) {
		for (var i = firstTokenAtOrAfter(tokens, start); i < tokens.length; i++) {
			var token = tokens[i];
			if (token.start >= end) break;
			if (token.type && token.type.label === label
					&& !isOpaqueOffset(opaqueRanges, token.start)) return token;
		}
		return null;
	}

	function hasMarkupOutsideOpaque(source, opaqueRanges) {
		for (var i = 0; i < source.length - 2; i++) {
			if (source[i] !== '<' || isOpaqueOffset(opaqueRanges, i)) continue;
			var match = source.slice(i).match(/^<\/?[A-Za-z][A-Za-z0-9:.-]*(?:[\s/>]|$)/);
			if (match) return true;
		}
		return false;
	}

	function hasHashOutsideOpaque(source, opaqueRanges) {
		for (var i = 0; i < source.length; i++) {
			if (source[i] === '#' && !isOpaqueOffset(opaqueRanges, i)) return true;
		}
		return false;
	}

	function addFrame(frames, kind, openToken, closeToken, lineIndex, extra) {
		if (!openToken || !closeToken || closeToken.start <= openToken.start) return false;
		var frame = {
			id: frames.length,
			kind: kind,
			open: openToken.start,
			close: closeToken.start,
			openLine: lineAt(lineIndex.starts, openToken.start),
			closeLine: lineAt(lineIndex.starts, closeToken.start),
			opener: openToken.type && openToken.type.label,
			closer: closeToken.type && closeToken.type.label,
			suppressUntil: -1
		};
		if (extra) {
			for (var key in extra) frame[key] = extra[key];
		}
		frames.push(frame);
		return true;
	}

	function validateControlBodies(nodes, lineIndex) {
		var valid = true;
		nodes.forEach(function(node) {
			if (!valid) return;
			if (UNSUPPORTED_TYPES[node.type]) {
				valid = false;
				return;
			}
			if (node.type === 'IfStatement'
					&& (!node.consequent || node.consequent.type !== 'BlockStatement'
						|| (node.alternate && node.alternate.type !== 'BlockStatement'
							&& node.alternate.type !== 'IfStatement'))) {
				valid = false;
				return;
			}
			if (CONTROL_BODY_TYPES[node.type] && (!node.body || node.body.type !== 'BlockStatement')) {
				valid = false;
				return;
			}
			if (node.type === 'SwitchStatement' && !Array.isArray(node.cases)) {
				valid = false;
				return;
			}
		});
		return valid;
	}

	function collectFrames(nodes, parsed, lineIndex, opaqueRanges, pairs) {
		var frames = [];
		var tokens = parsed.tokens || [];
		var switches = [];
		var failed = false;

		function frameForNode(kind, node, label) {
			var open = findToken(tokens, node.start, node.end, label, opaqueRanges);
			if (!open || !pairs[open.start]) {
				failed = true;
				return;
			}
			if (!addFrame(frames, kind, open, pairs[open.start], lineIndex)) failed = true;
		}
		function continuationFrame(kind, anchor, expression) {
			if (!expression || lineAt(lineIndex.starts, anchor) === lineAt(lineIndex.starts, expression.start)) return;
			var open = { start: anchor, type: { label: kind } };
			var close = { start: expression.end, type: { label: 'expression-end' } };
			if (!addFrame(frames, kind, open, close, lineIndex)) failed = true;
		}

		nodes.forEach(function(node) {
			if (failed) return;
			switch (node.type) {
			case 'VariableDeclarator':
				if (node.init) continuationFrame('assignment', node.id.end, node.init);
				break;
			case 'AssignmentExpression':
				continuationFrame('assignment', node.left.end, node.right);
				break;
			case 'ArrowFunctionExpression':
				if (node.body && node.body.type !== 'BlockStatement') {
					var paramEnd = node.params.length ? node.params[node.params.length - 1].end : node.start;
					var arrow = findToken(tokens, paramEnd, node.body.start, '=>', opaqueRanges);
					if (!arrow) { failed = true; break; }
					continuationFrame('arrow-body', arrow.start, node.body);
				}
				break;
			case 'BlockStatement':
				frameForNode('block', node, '{');
				break;
			case 'ObjectExpression':
			case 'ObjectPattern':
				frameForNode('object', node, '{');
				break;
			case 'ArrayExpression':
			case 'ArrayPattern':
				frameForNode('array', node, '[');
				break;
			case 'MemberExpression':
				if (node.computed) {
					var indexOpen = findToken(tokens, node.object.end, node.end, '[', opaqueRanges);
					if (!indexOpen || !pairs[indexOpen.start] ||
							!addFrame(frames, 'index', indexOpen, pairs[indexOpen.start], lineIndex)) failed = true;
				}
				break;
			case 'Property':
				if (node.computed) {
					var keyOpen = findToken(tokens, node.start, node.key.start + 1, '[', opaqueRanges);
					if (!keyOpen || !pairs[keyOpen.start] ||
							!addFrame(frames, 'computed-key', keyOpen, pairs[keyOpen.start], lineIndex)) failed = true;
				}
				break;
			case 'CallExpression':
			case 'NewExpression':
				var calleeEnd = node.callee && typeof node.callee.end === 'number'
					? node.callee.end : node.start;
				var callOpen = findToken(tokens, calleeEnd, node.end, '(', opaqueRanges);
				if (!callOpen || !pairs[callOpen.start]) {
					failed = true;
					break;
				}
				if (!addFrame(frames, 'call', callOpen, pairs[callOpen.start], lineIndex)) failed = true;
				break;
			case 'SwitchStatement':
				switches.push(node);
				break;
			default:
				break;
			}
		});
		if (failed) return null;

		for (var si = 0; si < switches.length; si++) {
			var switchNode = switches[si];
			var cases = switchNode.cases || [];
			var discriminantEnd = switchNode.discriminant && typeof switchNode.discriminant.end === 'number'
				? switchNode.discriminant.end : switchNode.start;
			var switchOpen = findToken(tokens, discriminantEnd, switchNode.end, '{', opaqueRanges);
			var switchClose = switchOpen && pairs[switchOpen.start];
			if (!switchOpen || !switchClose || !addFrame(frames, 'switch', switchOpen, switchClose, lineIndex)) return null;
			for (var ci = 0; ci < cases.length; ci++) {
				var currentCase = cases[ci];
				var testEnd = currentCase.test && typeof currentCase.test.end === 'number'
					? currentCase.test.end : currentCase.start;
				var colon = findToken(tokens, testEnd, switchClose.start, ':', opaqueRanges);
				var nextCase = ci + 1 < cases.length ? cases[ci + 1].start : switchClose.start;
				if (!colon || colon.end > nextCase) return null;
				if (colon.end < nextCase) {
					var syntheticOpen = { start: colon.end, type: { label: ':' } };
					var syntheticClose = { start: nextCase, type: { label: 'case-end' } };
					if (!addFrame(frames, 'switch-case', syntheticOpen, syntheticClose, lineIndex)) return null;
				}
			}
		}

		/* A multiline call shares its visual level with a container that opens
		 * on the call's own line (`call({` / `call(function () {`). The call
		 * continuation resumes after that container closes. */
		buildCallSuppressions(frames);
		return frames;
	}

	/* Build same-line call/container relationships with interval trees. This is
	 * O(F log F), instead of comparing every frame with every other frame. */
	function buildCallSuppressions(frames) {
		var groups = {};
		for (var i = 0; i < frames.length; i++) {
			var line = frames[i].openLine;
			if (!groups[line]) groups[line] = [];
			groups[line].push(frames[i]);
		}
		for (var key in groups) {
			if (!Object.prototype.hasOwnProperty.call(groups, key)) continue;
			var group = groups[key];
			group.sort(function(left, right) {
				return left.open - right.open || right.close - left.close;
			});
			var stack = [];
			for (var j = 0; j < group.length; j++) {
				var frame = group[j];
				while (stack.length && stack[stack.length - 1].close <= frame.open) {
					stack.pop();
				}
				frame._parentFrame = stack.length ? stack[stack.length - 1] : null;
				frame._descendantMax = frame.kind === 'call' ? -1 : frame.close;
				stack.push(frame);
			}
			for (var reverse = group.length - 1; reverse >= 0; reverse--) {
				var child = group[reverse];
				if (child.kind === 'call') child.suppressUntil = child._descendantMax;
				if (child._parentFrame && child._descendantMax > child._parentFrame._descendantMax) {
					child._parentFrame._descendantMax = child._descendantMax;
				}
			}
		}
	}

	function closeTokensAtLine(tokens, tokenIndex, contentOffset, lineNo, lineIndex, opaqueRanges) {
		while (tokenIndex < tokens.length && tokens[tokenIndex].start < contentOffset) tokenIndex++;
		var scan = tokenIndex;
		var result = [];
		while (scan < tokens.length) {
			var token = tokens[scan];
			if (lineAt(lineIndex.starts, token.start) !== lineNo) break;
			if (isOpaqueOffset(opaqueRanges, token.start)) break;
			var label = token.type && token.type.label;
			if (!CLOSE_LABELS[label]) break;
			result.push(token);
			scan++;
		}
		return { tokens: result, nextIndex: scan };
	}

	function buildProtectedLines(nodes, parsed, lineIndex, opaqueRanges, pairs) {
		var intervals = [];
		var continuationLines = {};
		var tokens = parsed.tokens || [];
		function addInterval(startLine, endLine) {
			if (endLine >= startLine) intervals.push({ start: startLine, end: endLine });
		}
		for (var i = 0; i < opaqueRanges.length; i++) {
			var range = opaqueRanges[i];
			if (range.kind !== 'block-comment' && range.kind !== 'template') continue;
			var rangeStartLine = lineAt(lineIndex.starts, range.start);
			var rangeEndLine = lineAt(lineIndex.starts, Math.max(range.start, range.end - 1));
			if (rangeEndLine > rangeStartLine) addInterval(rangeStartLine + 1, rangeEndLine);
		}
		var uncertain = false;
		nodes.forEach(function(node) {
			if (uncertain) return;
			// Expression continuation alignment belongs to a separate overlay.
			// Until that overlay has a syntax-aware plan, keep its original
			// continuation prefixes rather than guessing from block depth.
			if (node.type === 'BinaryExpression' || node.type === 'LogicalExpression' ||
					node.type === 'ConditionalExpression') {
				var expressionStartLine = lineAt(lineIndex.starts, node.start);
				var parts = node.type === 'ConditionalExpression'
					? [node.test, node.consequent, node.alternate] : [node.left, node.right];
				for (var partIndex = 0; partIndex < parts.length; partIndex++) {
					if (!parts[partIndex]) continue;
					var partLine = lineAt(lineIndex.starts, parts[partIndex].start);
					if (partLine > expressionStartLine) continuationLines[partLine] = true;
				}
			}
			if (node.type === 'SwitchCase' && node.test) {
				var caseColon = findToken(tokens, node.test.end, node.end, ':', opaqueRanges);
				if (!caseColon) {
					uncertain = true;
					return;
				}
				var caseStartLine = lineAt(lineIndex.starts, node.start);
				var caseEndLine = lineAt(lineIndex.starts, caseColon.start);
				if (caseEndLine > caseStartLine) addInterval(caseStartLine, caseEndLine);
				return;
			}
			var isControlHeader = !!CONTROL_HEADER_TYPES[node.type];
			if (!isControlHeader && !PARAMETER_HEADER_TYPES[node.type]) return;
			var searchStart = node.start;
			var searchEnd = node.end;
			if (node.type === 'DoWhileStatement') {
				searchStart = node.body && typeof node.body.end === 'number' ? node.body.end : node.start;
			} else if (node.body && typeof node.body.start === 'number') {
				searchEnd = node.body.start;
			}
			var open = findToken(tokens, searchStart, searchEnd, '(', opaqueRanges);
			var close = open && pairs[open.start];
			if (!open || !close) {
				if (isControlHeader) uncertain = true;
				return;
			}
			var openLine = lineAt(lineIndex.starts, open.start);
			var closeLine = lineAt(lineIndex.starts, close.start);
			if (closeLine > openLine) addInterval(openLine, closeLine);
		});
		if (uncertain) return null;
		intervals.sort(function(left, right) {
			return left.start - right.start || left.end - right.end;
		});
		var merged = [];
		for (var j = 0; j < intervals.length; j++) {
			var current = intervals[j];
			var previous = merged[merged.length - 1];
			if (previous && current.start <= previous.end + 1) {
				if (current.end > previous.end) previous.end = current.end;
			} else {
				merged.push({ start: current.start, end: current.end });
			}
		}
		var flags = [];
		for (var line = 0; line < lineIndex.lines.length; line++) {
			flags.push(false);
			var lineText = lineIndex.lines[line].trim();
			if (lineText.slice(0, 3) !== '...' && /^[?:,.+\-&|]/.test(lineText)) {
				continuationLines[line] = true;
			}
		}
		for (var k = 0; k < merged.length; k++) {
			for (var protectedLine = merged[k].start;
					protectedLine <= merged[k].end && protectedLine < flags.length;
					protectedLine++) flags[protectedLine] = true;
		}
		return { opaque: flags, continuation: continuationLines };
	}

	function buildLinePlan(source, parsed, lineIndex, frames, opaqueRanges, protectedLines, indentUnit) {
		var tokens = parsed.tokens || [];
		var byClose = {};
		var opening = frames.slice().sort(function(left, right) { return left.open - right.open; });
		var closing = frames.slice().sort(function(left, right) { return left.close - right.close; });
		for (var i = 0; i < frames.length; i++) {
			var closeKey = frames[i].close;
			if (!byClose[closeKey]) byClose[closeKey] = [];
			byClose[closeKey].push(frames[i]);
			frames[i]._active = false;
			frames[i]._prevActive = null;
			frames[i]._nextActive = null;
		}
		var activeHead = null;
		var activeTail = null;
		var openingIndex = 0;
		var closingIndex = 0;
		var tokenIndex = 0;
		function addActive(frame) {
			if (frame._active) return;
			frame._active = true;
			frame._prevActive = activeTail;
			frame._nextActive = null;
			if (activeTail) activeTail._nextActive = frame;
			else activeHead = frame;
			activeTail = frame;
		}
		function removeActive(frame) {
			if (!frame._active) return;
			if (frame._prevActive) frame._prevActive._nextActive = frame._nextActive;
			else activeHead = frame._nextActive;
			if (frame._nextActive) frame._nextActive._prevActive = frame._prevActive;
			else activeTail = frame._prevActive;
			frame._active = false;
			frame._prevActive = null;
			frame._nextActive = null;
		}
		var levels = [];
		var lines = [];
		for (var lineNo = 0; lineNo < lineIndex.lines.length; lineNo++) {
			var text = lineIndex.lines[lineNo];
			var trimmed = text.trim();
			var contentOffset = firstContentOffset(source, lineNo, lineIndex);
			var excluded = {};
			while (openingIndex < opening.length && opening[openingIndex].open < contentOffset) {
				addActive(opening[openingIndex++]);
			}
			while (closingIndex < closing.length && closing[closingIndex].close < contentOffset) {
				removeActive(closing[closingIndex++]);
			}
			var boundaryFrames = byClose[contentOffset] || [];
			for (var boundaryIndex = 0; boundaryIndex < boundaryFrames.length; boundaryIndex++) {
				excluded[boundaryFrames[boundaryIndex].id] = true;
			}
			var leading = closeTokensAtLine(tokens, tokenIndex, contentOffset, lineNo, lineIndex, opaqueRanges);
			tokenIndex = leading.nextIndex;
			for (var ci = 0; ci < leading.tokens.length; ci++) {
				var closeFrames = byClose[leading.tokens[ci].start] || [];
				for (var closeIndex = 0; closeIndex < closeFrames.length; closeIndex++) {
					excluded[closeFrames[closeIndex].id] = true;
				}
			}

			var ownerKinds = [];
			for (var active = activeHead; active; active = active._nextActive) {
				var suppressed = active.kind === 'call' && active.suppressUntil >= contentOffset;
				if (!excluded[active.id] && !suppressed) ownerKinds.push(active.kind);
			}
			var protectedLine = !!protectedLines.opaque[lineNo];
			var blank = trimmed === '';
			var level = ownerKinds.length;
			var continuationSuffix = '';
			if (!protectedLine && protectedLines.continuation[lineNo]) {
				var prefix = (text.match(/^[ \t]*/) || [''])[0];
				var minimum = new Array(level + 1).join(indentUnit);
				// Preserve extra alignment, but never less than the enclosing
				// structural owners require.
				if (prefix.indexOf(minimum) === 0) protectedLine = true;
				else if (indentUnit === '\t' && /^\t* +$/.test(prefix)) {
					continuationSuffix = prefix.replace(/^\t*/, '');
				}
			}
			var indent = (blank || protectedLine) ? null : level;
			levels.push(indent);
			lines.push({
				line: lineNo + 1,
				indent: indent,
				continuationSuffix: continuationSuffix,
				level: level,
				protected: protectedLine,
				blank: blank,
				owners: ownerKinds
			});
		}
		return { indentLevels: levels, lines: lines };
	}

	function planJavaScriptIndentation(source, options) {
		if (typeof source !== 'string'
				|| typeof root.parseJavaScriptStructure !== 'function'
				|| typeof root.javaScriptLexicalSignature !== 'function'
				|| typeof root.verifyJavaScriptTransformation !== 'function') return null;
		var opts = options || {};
		var indentUnit = typeof opts.indentUnit === 'string' ? opts.indentUnit : '\t';
		if (!/^[ \t]+$/.test(indentUnit)) return null;
		var parsed = root.parseJavaScriptStructure(source, opts.sourceType);
		if (!parsed || !parsed.ok || !parsed.ast) return null;
		var nodes = [];
		walk(parsed.ast, function(node) { nodes.push(node); });
		var lineIndex = buildLineIndex(source);
		var opaqueRanges = collectOpaqueRanges(parsed, nodes);
		if (!opaqueRanges || hasMarkupOutsideOpaque(source, opaqueRanges)
				|| hasHashOutsideOpaque(source, opaqueRanges)) return null;
		if (!validateControlBodies(nodes, lineIndex)) return null;
		var pairs = buildDelimiterPairs(parsed.tokens || [], opaqueRanges);
		if (!pairs) return null;
		var frames = collectFrames(nodes, parsed, lineIndex, opaqueRanges, pairs);
		if (!frames) return null;
		var protectedLines = buildProtectedLines(nodes, parsed, lineIndex, opaqueRanges, pairs);
		if (!protectedLines) return null;
		var planLines = buildLinePlan(source, parsed, lineIndex, frames, opaqueRanges, protectedLines, indentUnit);
		return {
			ok: true,
			sourceType: parsed.sourceType,
			indentUnit: indentUnit,
			lineCount: lineIndex.lines.length,
			indentLevels: planLines.indentLevels,
			lines: planLines.lines,
			frames: frames.map(function(frame) {
				return {
					kind: frame.kind,
					openLine: frame.openLine + 1,
					closeLine: frame.closeLine + 1
				};
			}),
			source: source
		};
	}

	function applyJavaScriptIndentPlan(source, plan) {
		if (typeof source !== 'string' || !plan || plan.ok !== true
				|| source !== plan.source || !Array.isArray(plan.lines)
				|| typeof plan.indentUnit !== 'string') return null;
		if (typeof root.verifyJavaScriptTransformation !== 'function') return null;
		var lineIndex = buildLineIndex(source);
		if (lineIndex.lines.length !== plan.lines.length) return null;
		var output = [];
		for (var i = 0; i < lineIndex.lines.length; i++) {
			var entry = plan.lines[i];
			var line = lineIndex.lines[i];
			if (!entry || entry.indent === null || entry.blank) {
				output.push(line);
				continue;
			}
			if (typeof entry.indent !== 'number' || entry.indent < 0
					|| entry.indent !== Math.floor(entry.indent)) return null;
			output.push(new Array(entry.indent + 1).join(plan.indentUnit) + (entry.continuationSuffix || '')
				+ line.replace(/^[ \t]*/, ''));
		}
		var formatted = output.join(lineIndex.newline);
		if (formatted === source) return source;
		var verified = root.verifyJavaScriptTransformation(source, formatted);
		if (!verified || !verified.ok) return null;
		return formatted;
	}

	root.planJavaScriptIndentation = planJavaScriptIndentation;
	root.applyJavaScriptIndentPlan = applyJavaScriptIndentPlan;
	if (typeof module !== 'undefined' && module.exports) {
		module.exports = {
			planJavaScriptIndentation: planJavaScriptIndentation,
			applyJavaScriptIndentPlan: applyJavaScriptIndentPlan
		};
	}
})(typeof globalThis !== 'undefined' ? globalThis : this);
