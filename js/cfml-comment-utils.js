/* Shared CFML/HTML markup-comment scanner.
 *
 * CFML comments use `<!--- ... --->`. Legacy CFML commonly contains
 * commented-out CFML that itself contains comment markers, so a first-close
 * search is not sufficient. This file deliberately has no module wrapper:
 * browser, CLI VM, and test harnesses load it before the other formatters.
 */

function findCFMLCommentEnd(text, startIndex) {
	if (typeof text !== 'string' || text.slice(startIndex, startIndex + 5) !== '<!---') {
		return -1;
	}

	var depth = 1;
	var i = startIndex + 5;
	while (i < text.length) {
		if (text.slice(i, i + 5) === '<!---') {
			depth++;
			i += 5;
			continue;
		}
		if (text.slice(i, i + 4) === '--->') {
			depth--;
			i += 4;
			if (depth === 0) return i;
			continue;
		}
		i++;
	}
	return -1;
}

function findMarkupCommentEnd(text, startIndex) {
	if (typeof text !== 'string') return -1;
	if (text.slice(startIndex, startIndex + 5) === '<!---') {
		return findCFMLCommentEnd(text, startIndex);
	}
	if (text.slice(startIndex, startIndex + 4) === '<!--') {
		for (var i = startIndex + 4; i < text.length; i++) {
			/* `--->` is a CFML close marker embedded in an HTML comment;
			 * its final three characters must not close the HTML region. */
			if (text.slice(i, i + 4) === '--->') {
				i += 3;
				continue;
			}
			if (text.slice(i, i + 3) === '-->') return i + 3;
		}
		return -1;
	}
	return -1;
}

function consumeMarkupComment(text, startIndex) {
	var end = findMarkupCommentEnd(text, startIndex);
	return {
		start: startIndex,
		end: end,
		closed: end !== -1,
		type: text.slice(startIndex, startIndex + 5) === '<!---' ? 'cfml' : 'html'
	};
}

/* Advance a line-oriented scanner through markup comments. `state` is
 * mutated and returned so callers can keep comment depth across physical
 * lines without implementing their own first-close logic.
 *
 * `codeOutsideComment` is conservative: it is true only when non-whitespace
 * text occurs outside a comment on this line. Callers may therefore keep a
 * mixed code/comment line on the safe, opaque path.
 */
function advanceMarkupCommentState(text, state) {
	var current = state || { cfmlDepth: 0, htmlDepth: 0 };
	if (typeof current.cfmlDepth !== 'number') current.cfmlDepth = 0;
	if (typeof current.htmlDepth !== 'number') current.htmlDepth = 0;

	var startsInComment = current.cfmlDepth > 0 || current.htmlDepth > 0;
	var hadComment = startsInComment;
	var codeOutsideComment = false;
	var quote = null;
	var i = 0;

	while (i < text.length) {
		if (current.cfmlDepth > 0) {
			hadComment = true;
			if (text.slice(i, i + 5) === '<!---') {
				current.cfmlDepth++;
				i += 5;
				continue;
			}
			if (text.slice(i, i + 4) === '--->') {
				current.cfmlDepth--;
				i += 4;
				continue;
			}
			i++;
			continue;
		}

		if (current.htmlDepth > 0) {
			hadComment = true;
			if (text.slice(i, i + 4) === '--->') {
				i += 4;
				continue;
			}
			if (text.slice(i, i + 3) === '-->') {
				current.htmlDepth = 0;
				i += 3;
				continue;
			}
			i++;
			continue;
		}

		/* A marker inside an attribute/string is data, not a comment
		 * boundary. CFML escapes quote characters by doubling them; the
		 * backslash rule also keeps JS-style strings safe in mixed files. */
		if (quote) {
			if (text[i] === '\\') {
				i += 2;
				continue;
			}
			if (text[i] === quote) {
				if (text[i + 1] === quote) {
					i += 2;
					continue;
				}
				quote = null;
			}
			i++;
			continue;
		}
		if (text[i] === '"' || text[i] === "'") {
			quote = text[i];
			i++;
			continue;
		}
		if (text.slice(i, i + 5) === '<!---') {
			current.cfmlDepth = 1;
			hadComment = true;
			i += 5;
			continue;
		}
		if (text.slice(i, i + 4) === '<!--') {
			current.htmlDepth = 1;
			hadComment = true;
			i += 4;
			continue;
		}
		if (!/[ \t\r\n]/.test(text[i])) codeOutsideComment = true;
		i++;
	}

	return {
		state: current,
		startsInComment: startsInComment,
		hadComment: hadComment,
		endsInComment: current.cfmlDepth > 0 || current.htmlDepth > 0,
		codeOutsideComment: codeOutsideComment
	};
}

if (typeof module !== 'undefined' && module.exports) {
	module.exports = {
		findCFMLCommentEnd: findCFMLCommentEnd,
		findMarkupCommentEnd: findMarkupCommentEnd,
		consumeMarkupComment: consumeMarkupComment,
		advanceMarkupCommentState: advanceMarkupCommentState
	};
}
