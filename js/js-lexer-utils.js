/* Shared lightweight JavaScript lexer helpers.
 * No module system: functions/vars are intentionally global for browser and
 * Node VM harness loading. */
var REGEX_CONTEXT_KEYWORDS = (typeof REGEX_CONTEXT_KEYWORDS !== 'undefined')
	? REGEX_CONTEXT_KEYWORDS
	: {
		'return':1,'typeof':1,'throw':1,'void':1,'delete':1,'new':1,
		'in':1,'of':1,'instanceof':1,'yield':1,'await':1,'case':1
	};

function jsPreviousTokenAllowsRegex(prefix, options) {
	var opts = options || {};
	var j = prefix.length - 1;
	while (j >= 0 && (prefix[j] === ' ' || prefix[j] === '\t' || prefix[j] === '\r')) j--;
	if (j < 0 || prefix[j] === '\n') return true;
	var c = prefix[j];
	if (opts.disallowAfterLt && c === '<') return false;
	if ("([{=,:;!&|?+-*~^%<>".indexOf(c) !== -1) return true;
	if (/[A-Za-z_$]/.test(c)) {
		var end = j + 1;
		while (j >= 0 && /[A-Za-z0-9_$]/.test(prefix[j])) j--;
		var word = prefix.slice(j + 1, end);
		return !!REGEX_CONTEXT_KEYWORDS[word];
	}
	return false;
}

function scanJSRegexLiteralEnd(code, pos, prefix, options) {
	if (code[pos] !== '/' || code[pos + 1] === '/' || code[pos + 1] === '*') return -1;
	if (!jsPreviousTokenAllowsRegex(prefix || '', options)) return -1;
	var scan = pos + 1;
	var inClass = false;
	while (scan < code.length) {
		var rc = code[scan];
		if (rc === '\n' || rc === '\r') return -1;
		if (rc === '\\') { scan += 2; continue; }
		if (rc === '[') { inClass = true; scan++; continue; }
		if (rc === ']') { inClass = false; scan++; continue; }
		if (rc === '/' && !inClass) {
			scan++;
			while (scan < code.length && /[A-Za-z]/.test(code[scan])) scan++;
			return scan;
		}
		scan++;
	}
	return -1;
}
