/* Parse and compare JavaScript without regenerating source text.
 * CFML region mapping remains the responsibility of the outer formatter. */
function parseJavaScriptStructure(source, sourceType) {
	if (typeof acorn === 'undefined' || !acorn || typeof acorn.parse !== 'function') {
		return { ok: false, reason: 'parser-unavailable' };
	}
	var types = sourceType ? [sourceType] : ['script', 'module'];
	for (var i = 0; i < types.length; i++) {
		var tokens = [];
		var comments = [];
		try {
			var ast = acorn.parse(source, {
				ecmaVersion: 'latest', sourceType: types[i], allowHashBang: true,
				onToken: tokens, onComment: comments
			});
			return { ok: true, sourceType: types[i], ast: ast, tokens: tokens, comments: comments };
		} catch (error) {
			// Try module syntax only after script syntax fails.
		}
	}
	return { ok: false, reason: 'parse-error' };
}

function javaScriptStructureSignature(parsed) {
	return JSON.stringify(parsed.ast, function(key, value) {
		if (key === 'start' || key === 'end') return undefined;
		return typeof value === 'bigint' ? String(value) + 'n' : value;
	});
}

function javaScriptLexicalSignature(source, parsed) {
	var tokens = parsed.tokens.filter(function(token) { return token.type.label !== 'eof'; });
	var lexemes = tokens.map(function(token) { return source.slice(token.start, token.end); });
	var tokenIndex = 0;
	var commentAnchors = parsed.comments.map(function(comment) {
		while (tokenIndex < tokens.length && tokens[tokenIndex].end <= comment.start) tokenIndex++;
		var lines = source.slice(comment.start, comment.end).replace(/\r\n?/g, '\n').split('\n');
		if (lines.length > 1) {
			var prefix = null;
			for (var i = 1; i < lines.length; i++) {
				if (!lines[i].trim()) continue;
				var leading = (lines[i].match(/^[ \t]*/) || [''])[0];
				if (prefix === null) prefix = leading;
				else {
					var n = 0;
					while (n < prefix.length && n < leading.length && prefix[n] === leading[n]) n++;
					prefix = prefix.slice(0, n);
				}
			}
			if (prefix) {
				for (var j = 1; j < lines.length; j++) {
					if (lines[j].slice(0, prefix.length) === prefix) lines[j] = lines[j].slice(prefix.length);
				}
			}
		}
		return [tokenIndex, lines.join('\n')];
	});
	return JSON.stringify({ tokens: lexemes, comments: commentAnchors });
}

function verifyJavaScriptTransformation(original, formatted) {
	var input = parseJavaScriptStructure(original);
	if (!input.ok) return { ok: false, reason: 'input-' + input.reason };
	var output = parseJavaScriptStructure(formatted, input.sourceType);
	if (!output.ok) return { ok: false, reason: 'output-' + output.reason };
	try {
		if (javaScriptLexicalSignature(original, input) !== javaScriptLexicalSignature(formatted, output)) {
			return { ok: false, reason: 'lexical-mismatch' };
		}
		if (javaScriptStructureSignature(input) !== javaScriptStructureSignature(output)) {
			return { ok: false, reason: 'structure-mismatch' };
		}
	} catch (error) {
		return { ok: false, reason: 'verification-error' };
	}
	return { ok: true, sourceType: input.sourceType };
}

function notifyJavaScriptFallback() {
	var message = 'Some JavaScript could not be formatted safely and was kept unchanged.';
	if (typeof console !== 'undefined' && typeof console.warn === 'function') console.warn(message);
	if (typeof simple_toast_msg === 'function') simple_toast_msg(message);
}

/* A planner may decline incomplete, mixed-language or unsupported syntax.
 * In that case keep the formatter's candidate for normal verification. */
function applyValidatedJavaScriptIndentation(code) {
	if (typeof planJavaScriptIndentation !== 'function' || typeof applyJavaScriptIndentPlan !== 'function') return code;
	try {
		var plan = planJavaScriptIndentation(code);
		var result = plan && applyJavaScriptIndentPlan(code, plan);
		return typeof result === 'string' ? result : code;
	} catch (error) {
		return code;
	}
}
