function normalizeStructuralCFMLTags(body) {
	if (typeof body !== 'string') return body;
	var lines = body.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
	var result = [];
	var structuralStart = /^<\/?(?:cfif|cfelseif|cfelse|cfloop|cfswitch|cfcase|cfdefaultcase)\b/i;
	var commentState = { cfmlDepth: 0, htmlDepth: 0 };

	for (var i = 0; i < lines.length; i++) {
		var line = lines[i];
		var trimmed = line.trim();
		var commentScan = advanceMarkupCommentState(trimmed, commentState);
		if (commentScan.startsInComment || (commentScan.hadComment && !commentScan.codeOutsideComment)) {
			result.push(line);
			continue;
		}
		if (!structuralStart.test(trimmed) || findCFMLTagClose(trimmed) !== -1) {
			result.push(line);
			continue;
		}

		var tagPrefix = (line.match(/^[ \t]*/) || [''])[0];
		var combined = trimmed;
		var closeIndex = -1;
		while (i + 1 < lines.length) {
			i++;
			combined += ' ' + lines[i].trim();
			closeIndex = findCFMLTagClose(combined);
			if (closeIndex !== -1) break;
		}
		result.push(tagPrefix + combined);
	}
	return result.join('\n');
}

function findCFMLTagClose(line) {
	var quote = null;
	for (var i = 0; i < line.length; i++) {
		var char = line[i];
		if (quote) {
			if (char === quote) {
				if (line[i + 1] === quote) { i++; continue; }
				quote = null;
			}
			continue;
		}
		if (char === '"' || char === "'") {
			quote = char;
		} else if (char === '>') {
			return i;
		}
	}
	return -1;
}

function bodyHasStructuralCFMLControlFlow(body) {
	body = normalizeStructuralCFMLTags(body);
	// "Structural" = a CFML control-flow tag that occupies its own line
	// in the input. Both built-in beautifySQL (tokenizer-based) and the
	// Pro SQL engine (full AST) cannot understand CFML conditionals,
	// so they treat protected tokens as opaque identifiers and crush
	// the conditional structure when reformatting. When such structural
	// tags are present, the cfquery body is left untouched by deep-format
	// and trusted to beautifyCFML's outer-pass indentation, which already
	// handles cfif/cfloop/cfswitch nesting correctly.
	//
	// Inline cases like  WHERE x = 1 <cfif y>AND z = 2</cfif>  are NOT
	// considered structural and continue to flow through deep-format so
	// the surrounding SQL gets keyword-cased and aligned as before.
	if (typeof body !== 'string') return false;
	var lines = body.split('\n');
	var pattern = /^<\/?(?:cfif|cfelseif|cfelse|cfloop|cfswitch|cfcase|cfdefaultcase)\b[^>]*>$/i;
	for (var i = 0; i < lines.length; i++) {
		if (pattern.test(lines[i].trim())) return true;
	}
	return false;
}

function bodyHasUserIndent(body) {
	// Returns true when the cfquery body shows any non-zero leading
	// whitespace on at least one non-empty line — i.e., the user has
	// hand-crafted indent. Used to decide between two recovery paths
	// for structural CFML control flow:
	//   - hasUserIndent === true  → preserve original body verbatim
	//     (subquery continuations and inline comments keep their
	//     relative indent)
	//   - hasUserIndent === false → trust beautifyCFML's nested output
	//     (auto-derives cfif depth for users who typed flat code)
	if (typeof body !== 'string') return false;
	var lines = body.split('\n');
	for (var i = 0; i < lines.length; i++) {
		if (lines[i].trim() === '') continue;
		var match = lines[i].match(/^[ \t]+/);
		if (match && match[0].length > 0) return true;
	}
	return false;
}

/* Phase 2 — CFML normalization layer.
 *
 * When Pro SQL is enabled, all CFML tags inside the cfquery body get
 * normalized:
 *   - Tag names lowercased (CFQUERYPARAM → cfqueryparam)
 *   - Attribute names lowercased (CFSQLTYPE= → cfsqltype=)
 *   - cfsqltype values lowercased (CF_SQL_VARCHAR → cf_sql_varchar)
 *   - Multi-space between attrs → single space
 *   - CFML expression tags (cfif/cfelseif/cfset/cfreturn) get their
 *     CFML operators uppercased (is → IS, and → AND, eq → EQ, ...)
 *     and built-in functions camelCased (isdefined → isDefined).
 *
 * String content inside expressions is protected so an operator-name
 * substring (e.g., 'is_active') is never touched.
 */
var CFML_OPERATORS = [
	'does not contain', 'contains',
	'is not', 'is',
	'eqv', 'imp', 'xor', 'mod',
	'gte', 'lte', 'neq', 'eq',
	'lt', 'gt',
	'and', 'or', 'not'
];

var CFML_BUILTIN_FUNCS = {
	'isdefined': 'isDefined', 'isnumeric': 'isNumeric', 'isvalid': 'isValid',
	'isarray': 'isArray', 'isstruct': 'isStruct', 'isquery': 'isQuery',
	'isobject': 'isObject', 'isboolean': 'isBoolean', 'isdate': 'isDate',
	'isnull': 'isNull', 'issimplevalue': 'isSimpleValue', 'isstring': 'isString',
	'arraylen': 'arrayLen', 'arrayisempty': 'arrayIsEmpty',
	'arrayappend': 'arrayAppend', 'arrayprepend': 'arrayPrepend',
	'arraydelete': 'arrayDelete', 'arrayfind': 'arrayFind',
	'arraytolist': 'arrayToList', 'listtoarray': 'listToArray',
	'listlen': 'listLen', 'listappend': 'listAppend',
	'listcontains': 'listContains', 'listfind': 'listFind',
	'listfirst': 'listFirst', 'listlast': 'listLast', 'listgetat': 'listGetAt',
	'structkeyexists': 'structKeyExists', 'structnew': 'structNew',
	'structcount': 'structCount', 'structkeylist': 'structKeyList',
	'structkeyarray': 'structKeyArray',
	'ltrim': 'lTrim', 'rtrim': 'rTrim', 'lcase': 'lCase', 'ucase': 'uCase',
	'findnocase': 'findNoCase', 'replacenocase': 'replaceNoCase',
	'dateformat': 'dateFormat', 'timeformat': 'timeFormat',
	'datediff': 'dateDiff', 'dateadd': 'dateAdd', 'numberformat': 'numberFormat',
	'createodbcdate': 'createODBCDate', 'createodbctime': 'createODBCTime',
	'createodbcdatetime': 'createODBCDateTime',
	'serializejson': 'serializeJSON', 'deserializejson': 'deserializeJSON',
	'preservesinglequotes': 'PreserveSingleQuotes',
	'urlencodedformat': 'urlEncodedFormat'
};

// Select a namespace absent from the entire input, including literals and comments.
function createMarkerList(source, basePrefix) {
	var prefix = basePrefix;
	var suffix = 0;
	var upperSource = source.toUpperCase();
	while (upperSource.indexOf(prefix.toUpperCase()) !== -1) {
		prefix = basePrefix + (++suffix) + '_';
	}
	var tokens = [];
	Object.defineProperty(tokens, 'markerPrefix', { value: prefix });
	return tokens;
}

function restoreUniqueMarkers(code, tokens, defaultPrefix) {
	var prefix = tokens.markerPrefix || defaultPrefix;
	var pattern = new RegExp(prefix + '(\\d+)__', 'gi');
	var next = 0;
	var invalid = false;
	var restored = code.replace(pattern, function(match, index) {
		var id = Number(index);
		if (id !== next || id >= tokens.length) {
			invalid = true;
			return match;
		}
		next++;
		return tokens[id];
	});
	return invalid || next !== tokens.length ? null : restored;
}

function protectExpressionStrings(text) {
	var tokens = createMarkerList(text, '__CFEXPSTR_');
	var output = '';
	var i = 0;
	while (i < text.length) {
		var c = text[i];
		if (c === '"' || c === "'") {
			var quote = c;
			var start = i;
			i++;
			while (i < text.length) {
				if (text[i] === '\\') { i += 2; continue; }
				if (text[i] === quote) {
					if (text[i + 1] === quote) { i += 2; continue; }
					i++;
					break;
				}
				i++;
			}
			tokens.push(text.slice(start, i));
			output += tokens.markerPrefix + (tokens.length - 1) + '__';
		} else {
			output += c;
			i++;
		}
	}
	return { code: output, tokens: tokens };
}

function restoreProtectedExpressionStrings(text, tokens) {
	return restoreUniqueMarkers(text, tokens, '__CFEXPSTR_');
}

function uppercaseCFMLOperators(text) {
	var sorted = CFML_OPERATORS.slice().sort(function(a, b) {
		return b.length - a.length;
	});
	var alternatives = sorted.map(function(op) {
		return op.replace(/\s+/g, '\\s+');
	}).join('|');
	var pattern = new RegExp('\\b(' + alternatives + ')\\b', 'gi');
	return text.replace(pattern, function(match) {
		return match.replace(/\s+/g, ' ').toUpperCase();
	});
}

function camelCaseCFMLFunctions(text) {
	var funcNames = Object.keys(CFML_BUILTIN_FUNCS);
	funcNames.sort(function(a, b) { return b.length - a.length; });
	var pattern = new RegExp('\\b(' + funcNames.join('|') + ')\\b', 'gi');
	return text.replace(pattern, function(match) {
		var key = match.toLowerCase();
		return CFML_BUILTIN_FUNCS[key] || match;
	});
}

function normalizeCFMLExpression(content) {
	if (typeof content !== 'string' || content === '') return content;
	var protectedExpr = protectExpressionStrings(content);
	var transformed = uppercaseCFMLOperators(protectedExpr.code);
	transformed = camelCaseCFMLFunctions(transformed);
	// Collapse multi-whitespace to single space, but preserve leading space.
	var leading = (transformed.match(/^\s*/) || [''])[0];
	transformed = (leading.length > 0 ? ' ' : '') + transformed.replace(/\s+/g, ' ').trim();
	var restored = restoreProtectedExpressionStrings(transformed, protectedExpr.tokens);
	return restored === null ? content : restored;
}

function normalizeCFMLAttributes(content) {
	if (typeof content !== 'string' || content === '') return content;
	var result = '';
	var i = 0;
	while (i < content.length) {
		while (i < content.length && /\s/.test(content[i])) i++;
		if (i >= content.length) break;
		var nameStart = i;
		while (i < content.length && /[A-Za-z_0-9]/.test(content[i])) i++;
		if (i === nameStart) break;
		var attrName = content.slice(nameStart, i).toLowerCase();
		while (i < content.length && /\s/.test(content[i])) i++;
		if (content[i] !== '=') {
			result += ' ' + attrName;
			continue;
		}
		i++; // consume =
		while (i < content.length && /\s/.test(content[i])) i++;
		var value = '';
		if (content[i] === '"' || content[i] === "'") {
			var quote = content[i];
			var valStart = i;
			i++;
			while (i < content.length) {
				if (content[i] === '\\') { i += 2; continue; }
				if (content[i] === quote) {
					if (content[i + 1] === quote) { i += 2; continue; }
					i++;
					break;
				}
				i++;
			}
			value = content.slice(valStart, i);
		} else {
			// Unquoted attribute value. Naive "walk until whitespace" breaks
			// for CFML hash-interpolated values like
			//   value=#TNOdateformat('#fromday#/#frommth#/#fromyear# ')#
			// where the space between `#fromyear#` and `')#` is INSIDE the
			// expression. Track `#...#` depth + paren depth + nested quotes
			// so whitespace inside an expression is preserved.
			var valStart = i;
			var inHash = false;
			var parenDepth = 0;
			var quoteIn = '';
			while (i < content.length) {
				var ch = content[i];
				if (quoteIn) {
					if (ch === quoteIn) {
						if (content[i + 1] === quoteIn) { i += 2; continue; }
						quoteIn = '';
					}
					i++;
					continue;
				}
				if (inHash) {
					if (ch === '#' && parenDepth === 0) { inHash = false; i++; continue; }
					if (ch === '(') parenDepth++;
					else if (ch === ')') parenDepth--;
					else if (ch === "'" || ch === '"') quoteIn = ch;
					i++;
					continue;
				}
				if (ch === '#') { inHash = true; i++; continue; }
				if (/\s/.test(ch)) break;
				i++;
			}
			value = content.slice(valStart, i);
		}
		// Lowercase cfsqltype CF_SQL_* values
		if (attrName === 'cfsqltype') {
			value = value.replace(/(["'])(cf_sql_\w+)(["'])/i, function(m, q1, v, q2) {
				return q1 + v.toLowerCase() + q2;
			});
		}
		result += ' ' + attrName + '=' + value;
	}
	return result;
}

function normalizeCFMLTagInternals(tag) {
	if (typeof tag !== 'string') return tag;
	// Skip CFML markup comments
	if (/^<!---/.test(tag)) return tag;
	var match = tag.match(/^(<\/?)(cf\w+)([\s\S]*)$/i);
	if (!match) return tag;
	var slash = match[1];
	var tagName = match[2].toLowerCase();
	var rest = match[3];
	// Find the closing >
	var closeIdx = rest.lastIndexOf('>');
	if (closeIdx === -1) return slash + tagName + rest;
	var content = rest.slice(0, closeIdx);
	var suffix = rest.slice(closeIdx);
	var isExpressionTag = (tagName === 'cfif' || tagName === 'cfelseif' || tagName === 'cfset' || tagName === 'cfreturn');
	if (isExpressionTag) {
		content = normalizeCFMLExpression(content);
	} else {
		content = normalizeCFMLAttributes(content);
	}
	return slash + tagName + content + suffix;
}

function normalizeCFMLTagsInSafeText(text) {
	// Walks the text safely, normalizing CFML tags but skipping over
	// SQL strings (', ", `), SQL block/line comments, and CFML markup
	// comments. This is needed because, post-restore, the text contains
	// both CFML tags AND SQL strings — and a SQL string might contain
	// literal text that looks like a CFML tag.
	if (typeof text !== 'string' || text === '') return text;
	var output = '';
	var i = 0;
	while (i < text.length) {
		var char = text[i];
		// SQL string
		if (char === "'" || char === '"' || char === '`') {
			var quote = char;
			var start = i;
			i++;
			while (i < text.length) {
				if (text[i] === '\\') { i += 2; continue; }
				if (text[i] === quote) {
					if (text[i + 1] === quote) { i += 2; continue; }
					i++;
					break;
				}
				i++;
			}
			output += text.slice(start, i);
			continue;
		}
		// SQL block comment
		if (char === '/' && text[i + 1] === '*') {
			var start = i;
			i += 2;
			while (i < text.length - 1 && !(text[i] === '*' && text[i + 1] === '/')) i++;
			if (i < text.length - 1) i += 2;
			output += text.slice(start, i);
			continue;
		}
		// SQL line comment
		if (char === '-' && text[i + 1] === '-') {
			var start = i;
			while (i < text.length && text[i] !== '\n') i++;
			output += text.slice(start, i);
			continue;
		}
		// CFML markup comment — preserve the complete nested region verbatim.
		if (char === '<' && (text.slice(i, i + 5) === '<!---' || text.slice(i, i + 4) === '<!--')) {
			var commentEnd = findMarkupCommentEnd(text, i);
			if (commentEnd === -1) {
				output += text.slice(i);
				break;
			}
			output += text.slice(i, commentEnd);
			i = commentEnd;
			continue;
		}
		// CFML tag
		if (char === '<' && /^<\/?cf\w/i.test(text.slice(i, i + 12))) {
			var tagMatch = text.slice(i).match(/^<\/?cf\w+\b[^>]*\/?>/i);
			if (tagMatch) {
				output += normalizeCFMLTagInternals(tagMatch[0]);
				i += tagMatch[0].length;
				continue;
			}
		}
		output += char;
		i++;
	}
	return output;
}

/* Phase 3 — WHERE hoisting + split-format-recombine.
 *
 * For cfquery bodies where every leaf branch of the structural cfif tree
 * starts with `where ` keyword, we can hoist the `where` OUT of the cfif
 * branches and place a single WHERE keyword before the tree. This unlocks
 * full Pro SQL formatting (SELECT/FROM/WHERE keywords on their own lines,
 * columns list-broken) on the OUTER SQL backbone while preserving the
 * cfif structure as a sub-tree under WHERE.
 *
 * Algorithm:
 *   1. splitCfqueryBodyAtCfifTree — slice body into {pre, treeLines, post}
 *   2. detectAllLeavesStartWithWhere — verify every non-tag tree line
 *      starts with `where ` keyword
 *   3. stripWhereFromLeaves — strip the `where ` prefix from each leaf
 *   4. Format PRE + synthesized `where` via sql-formatter
 *   5. Format TREE via formatStrippedTree (cfif depth tracking + keyword
 *      uppercase on body lines)
 *   6. Format POST via uppercaseSQLKeywordsInProtected
 *   7. Assemble with correct indent
 *
 * If any precondition fails or sql-formatter throws, falls through to
 * Tier 1 marker → Tier 2 verbatim — zero regression risk.
 */
function splitCfqueryBodyAtCfifTree(body) {
	if (typeof body !== 'string') return null;
	var lines = body.split('\n');
	var commentMask = buildMarkupCommentMask(lines);
	var openIdx = -1;
	var closeIdx = -1;
	var depth = 0;
	var openP = /^<(?:cfif|cfloop|cfswitch)\b[^>]*>$/i;
	var closeP = /^<\/(?:cfif|cfloop|cfswitch)>$/i;
	for (var i = 0; i < lines.length; i++) {
		if (commentMask[i]) continue;
		var t = lines[i].trim();
		if (closeP.test(t)) {
			if (depth > 0) {
				depth--;
				if (depth === 0 && openIdx !== -1) {
					closeIdx = i;
					break;
				}
			}
		} else if (openP.test(t)) {
			if (openIdx === -1) openIdx = i;
			depth++;
		}
	}
	if (openIdx === -1 || closeIdx === -1) return null;
	return {
		pre: lines.slice(0, openIdx).join('\n'),
		treeLines: lines.slice(openIdx, closeIdx + 1),
		post: lines.slice(closeIdx + 1).join('\n')
	};
}

/* Phase 4 helpers — AND-leaves hoisting (Phase 3's dual).
 *
 * Phase 3 catches cfquery bodies where every cfif leaf STARTS WITH `where `
 * — the WHERE keyword gets hoisted out of the branches.
 *
 * Phase 4 catches the much more common dual case: the cfquery body has a
 * complete `WHERE base_condition AND base_condition` block OUTSIDE the cfif
 * tree, and each cfif leaf merely APPENDS optional `and xxx`/`or xxx` clauses.
 * This pattern dominates real-world legacy CFML reports.
 *
 * Three new helpers:
 *   splitCfqueryBodyAtCfifTreeMulti — like splitCfqueryBodyAtCfifTree but
 *     captures from FIRST <cfif> to LAST matching </cfif> at depth 0, so
 *     multiple sibling cfif blocks all become part of the tree segment.
 *     Phase 3's splitter stops at the FIRST close; Phase 4 needs the LAST.
 *
 *   detectAllLeavesStartWithAndOr — verifies precondition for Phase 4.
 *     Markup comments (<!--- ... --->) are transparent and don't disqualify.
 *
 *   formatPhase4PostFragment — for trailing GROUP BY / ORDER BY / HAVING /
 *     LIMIT / UNION clauses. Synthesizes `SELECT 1 FROM t WHERE 1=1 + post`,
 *     formats via sql-formatter, then slices off the synthetic prefix to
 *     return only the formatted post-WHERE fragment.
 */
function splitCfqueryBodyAtCfifTreeMulti(body) {
	if (typeof body !== 'string') return null;
	var lines = body.split('\n');
	var openP = /^<(?:cfif|cfloop|cfswitch)\b[^>]*>$/i;
	var closeP = /^<\/(?:cfif|cfloop|cfswitch)>$/i;
	var commentMask = buildMarkupCommentMask(lines);
	var openIdx = -1;
	var lastCloseIdx = -1;
	var depth = 0;
	for (var i = 0; i < lines.length; i++) {
		if (commentMask[i]) continue;
		var t = lines[i].trim();
		if (openP.test(t)) {
			if (openIdx === -1) openIdx = i;
			depth++;
		} else if (closeP.test(t)) {
			if (depth > 0) {
				depth--;
				if (depth === 0 && openIdx !== -1) {
					lastCloseIdx = i;
				}
			}
		}
	}
	if (openIdx === -1 || lastCloseIdx === -1) return null;
	return {
		pre: lines.slice(0, openIdx).join('\n'),
		treeLines: lines.slice(openIdx, lastCloseIdx + 1),
		post: lines.slice(lastCloseIdx + 1).join('\n')
	};
}

function detectAllLeavesStartWithAndOr(treeLines) {
	var structural = /^<\/?(?:cfif|cfelseif|cfelse|cfloop|cfswitch|cfcase|cfdefaultcase)\b[^>]*>$/i;
	var commentMask = buildMarkupCommentMask(treeLines);
	var seenLeaf = false;
	for (var i = 0; i < treeLines.length; i++) {
		if (commentMask[i]) continue;
		var t = treeLines[i].trim();
		if (t === '' || structural.test(t)) continue;
		if (!/^(and|or)\b/i.test(t)) return false;
		seenLeaf = true;
	}
	return seenLeaf;
}

function formatPhase4PostFragment(post, sqlDialect) {
	if (typeof post !== 'string') return '';
	var trimmed = post.trim();
	if (trimmed === '') return '';
	/* A cfif tree may be followed by ordinary WHERE continuations before a
	 * GROUP/ORDER clause. They are not optional post-WHERE clauses and must
	 * not be discarded when the synthetic formatter slices at GROUP/ORDER. */
	var postLines = trimmed.split('\n');
	var clauseIndex = -1;
	for (var p = 0; p < postLines.length; p++) {
		if (/^(GROUP BY|ORDER BY|HAVING|LIMIT|OFFSET|FETCH|UNION(?: ALL)?|INTERSECT|EXCEPT)\b/i.test(postLines[p].trim())) {
			clauseIndex = p;
			break;
		}
	}
	var leadingContinuation = clauseIndex > 0 ? postLines.slice(0, clauseIndex).join('\n').trim() : '';
	var clausePost = clauseIndex > 0 ? postLines.slice(clauseIndex).join('\n') : trimmed;
	// Synthesize a complete SELECT so sql-formatter has a well-formed input;
	// the output's post-WHERE fragment is what we keep.
	var synthetic = 'SELECT 1\nFROM t\nWHERE 1=1\n' + clausePost;
	try {
		var prot = protectCFMLTokens(synthetic);
		var formatted = formatProSQLSync(prot.code, sqlDialect);
		var restored = restoreCFMLTokens(formatted, prot.tokens);
		var lines = restored.split('\n');
		var postKeywordOwn = /^(GROUP BY|ORDER BY|HAVING|LIMIT|OFFSET|FETCH|UNION|UNION ALL|INTERSECT|EXCEPT)\s*$/;
		for (var i = 0; i < lines.length; i++) {
			if (postKeywordOwn.test(lines[i])) {
				var formattedClause = lines.slice(i).join('\n');
				if (leadingContinuation !== '') {
					var leadingProt = protectCFMLTokens(leadingContinuation);
					var leadingUppered = uppercaseSQLKeywordsInProtected(leadingProt.code);
					var leadingSpaced = normalizeSQLEqualsSpacing(leadingUppered);
					var leadingFormatted = restoreCFMLTokens(leadingSpaced, leadingProt.tokens);
					return leadingFormatted + '\n' + formattedClause;
				}
				return formattedClause;
			}
		}
	} catch (e) {
		if (typeof console !== 'undefined' && console.warn) {
			console.warn('[deep-format] Phase 4 post-tree synthesis failed; using lite uppercase.');
		}
	}
	// Fallback: lite uppercase only.
	try {
		var protPost = protectCFMLTokens(trimmed);
		var upperedPost = uppercaseSQLKeywordsInProtected(protPost.code);
		var spacedPost = normalizeSQLEqualsSpacing(upperedPost);
		return restoreCFMLTokens(spacedPost, protPost.tokens);
	} catch (e2) {
		return trimmed;
	}
}

function detectAllLeavesStartWithWhere(treeLines) {
	var structural = /^<\/?(?:cfif|cfelseif|cfelse|cfloop|cfswitch|cfcase|cfdefaultcase)\b[^>]*>$/i;
	var commentMask = buildMarkupCommentMask(treeLines);
	var seenLeaf = false;
	for (var i = 0; i < treeLines.length; i++) {
		if (commentMask[i]) continue;
		var t = treeLines[i].trim();
		if (t === '' || structural.test(t)) continue;
		if (!/^where\b/i.test(t)) return false;
		seenLeaf = true;
	}
	return seenLeaf;
}

function hasStructuralTreeBody(treeLines) {
	var structural = /^<\/?(?:cfif|cfelseif|cfelse|cfloop|cfswitch|cfcase|cfdefaultcase)\b[^>]*>$/i;
	var commentMask = buildMarkupCommentMask(treeLines);
	for (var i = 0; i < treeLines.length; i++) {
		if (commentMask[i]) continue;
		var t = treeLines[i].trim();
		if (t !== '' && !structural.test(t)) return true;
	}
	return false;
}

function hasStandaloneWhereAtEnd(text) {
	if (typeof text !== 'string') return false;
	var lines = text.trim().split('\n');
	return lines.length > 0 && /^where$/i.test(lines[lines.length - 1].trim());
}

function looksLikeCanonicalProSQLBody(text) {
	if (typeof text !== 'string') return false;
	var hasSelect = false;
	var hasFrom = false;
	var lines = text.split('\n');
	for (var i = 0; i < lines.length; i++) {
		var t = lines[i].trim();
		if (/^(SELECT(?: DISTINCT)?|UPDATE|INSERT(?: INTO)?|DELETE|WITH|MERGE|TRUNCATE)$/i.test(t)) hasSelect = true;
		if (/^FROM$/i.test(t)) hasFrom = true;
	}
	return hasSelect && hasFrom;
}

function stripWhereFromLeaves(treeLines) {
	var structural = /^<\/?(?:cfif|cfelseif|cfelse|cfloop|cfswitch|cfcase|cfdefaultcase)\b[^>]*>$/i;
	var commentMask = buildMarkupCommentMask(treeLines);
	return treeLines.map(function(line, index) {
		var t = line.trim();
		if (commentMask[index] || t === '' || structural.test(t)) return line;
		return line.replace(/^(\s*)where\s+/i, '$1');
	});
}

function repeatTab(n) {
	var s = '';
	for (var i = 0; i < n; i++) s += '\t';
	return s;
}

function normalizeSQLEqualsSpacing(text) {
	// Walks `text` char-by-char inserting space around standalone `=`.
	// Compound operators `<=`, `>=`, `!=`, `:=`, `==`, `<>` are preserved
	// untouched. Called only on protectCFMLTokens-protected text so SQL
	// strings and CFML tag attribute `=` are already opaque placeholders
	// and cannot be matched.
	if (typeof text !== 'string' || text === '') return text;
	var out = '';
	var i = 0;
	while (i < text.length) {
		var c = text[i];
		var prev = i > 0 ? text[i - 1] : '';
		var next = i + 1 < text.length ? text[i + 1] : '';
		if (c === '=' && next !== '=' && '<>!:='.indexOf(prev) === -1) {
			out = out.replace(/\s+$/, '') + ' = ';
			i++;
			while (i < text.length && /[ \t]/.test(text[i])) i++;
		} else {
			out += c;
			i++;
		}
	}
	return out;
}

function formatStrippedTree(treeLines) {
	// Walks treeLines with cfif depth tracking. Each line is output at
	// its semantic depth (cfif at parent's depth, body at depth+1) using
	// pure tab indentation starting at depth 1 (the WHERE body level).
	// Body lines also get SQL keyword uppercased + `=` spacing normalized
	// via Phase 1/3 helpers (token-protection-aware).
	var openP = /^<(?:cfif|cfloop|cfswitch)\b[^>]*>$/i;
	var sibP = /^<(?:cfelseif|cfelse|cfcase|cfdefaultcase)\b[^>]*>$/i;
	var closeP = /^<\/(?:cfif|cfloop|cfswitch)>$/i;
	var result = [];
	var depth = 1;
	var commentState = { cfmlDepth: 0, htmlDepth: 0 };
	var commentOrigPrefix = '';
	var commentNewPrefix = '';
	for (var i = 0; i < treeLines.length; i++) {
		var sourceLine = treeLines[i];
		var trimmed = sourceLine.trim();
		var commentScan = advanceMarkupCommentState(trimmed, commentState);
		if (commentScan.startsInComment || (commentScan.hadComment && !commentScan.codeOutsideComment)) {
			if (commentScan.startsInComment) {
				var sourcePrefix = (sourceLine.match(/^[ \t]*/) || [''])[0];
				var relative = sourcePrefix.indexOf(commentOrigPrefix) === 0
					? sourcePrefix.slice(commentOrigPrefix.length) : '';
				result.push(commentNewPrefix + relative + trimmed);
			} else {
				commentOrigPrefix = (sourceLine.match(/^[ \t]*/) || [''])[0];
				commentNewPrefix = repeatTab(depth);
				result.push(commentNewPrefix + trimmed);
			}
			continue;
		}
		if (trimmed === '') { result.push(''); continue; }
		if (closeP.test(trimmed)) {
			depth--;
			if (depth < 1) depth = 1;
			result.push(repeatTab(depth) + trimmed);
		} else if (sibP.test(trimmed)) {
			depth--;
			if (depth < 1) depth = 1;
			result.push(repeatTab(depth) + trimmed);
			depth++;
		} else if (openP.test(trimmed)) {
			result.push(repeatTab(depth) + trimmed);
			depth++;
		} else {
			// Body line — apply Phase 1 keyword uppercase + `=` spacing
			// normalization via token protection (CFML tags + SQL strings
			// already protected so their internal `=` won't match).
			try {
				var prot = protectCFMLTokens(trimmed);
				var uppered = uppercaseSQLKeywordsInProtected(prot.code);
				var spaced = normalizeSQLEqualsSpacing(uppered);
				var rest = restoreCFMLTokens(spaced, prot.tokens);
				result.push(repeatTab(depth) + rest);
			} catch (e) {
				result.push(repeatTab(depth) + trimmed);
				if (typeof console !== 'undefined' && console.warn) {
					console.warn('[deep-format] Phase 3 tree-body normalization failed; keeping line verbatim.');
				}
			}
		}
	}
	return result.join('\n');
}

/* Phase 1 — Lite Pro SQL on verbatim path.
 *
 * uppercaseSQLKeywordsInProtected runs on text where protectCFMLTokens has
 * already replaced strings, CFML tags, #vars#, and comments with opaque
 * __CFTOKEN_N__ placeholders. That makes case-insensitive keyword regex
 * safe — we cannot accidentally uppercase `where` inside a SQL string
 * literal like 'select all where match' because the entire string is
 * already hidden behind a placeholder.
 *
 * Multi-word keywords (`order by`, `inner join`, etc.) are matched with
 * \s+ between tokens so any amount of whitespace is normalized to a
 * single space when uppercased.
 */
var PRO_SQL_KEYWORDS = [
	'inner join', 'left outer join', 'right outer join', 'full outer join',
	'left join', 'right join', 'full join', 'cross join', 'outer join',
	'natural join', 'natural left join', 'natural right join',
	'group by', 'order by', 'union all', 'partition by', 'within group',
	'select', 'distinct', 'from', 'where', 'and', 'or', 'not',
	'insert into', 'insert', 'into', 'values', 'update', 'set', 'delete', 'truncate',
	'join', 'on', 'having', 'union', 'intersect', 'except', 'with', 'using',
	'case', 'when', 'then', 'else', 'end',
	'in', 'between', 'like', 'is', 'null', 'exists',
	'as', 'asc', 'desc', 'limit', 'offset', 'returning',
	'cast', 'over',
	'create', 'table', 'view', 'index', 'drop', 'alter', 'add', 'column',
	'primary', 'key', 'foreign', 'references', 'constraint', 'default', 'unique',
	'top', 'fetch', 'next', 'rows', 'only'
];

function uppercaseSQLKeywordsInProtected(text) {
	if (typeof text !== 'string' || text === '') return text;
	// Sort longest first so multi-word keywords (e.g. "left outer join")
	// match before shorter prefixes (e.g. "left", "outer", "join").
	var sorted = PRO_SQL_KEYWORDS.slice().sort(function(a, b) {
		return b.length - a.length;
	});
	var alternatives = sorted.map(function(kw) {
		return kw.replace(/\s+/g, '\\s+');
	}).join('|');
	var pattern = new RegExp('\\b(' + alternatives + ')\\b', 'gi');
	return text.replace(pattern, function(match) {
		// Normalize internal whitespace to a single space then uppercase.
		return match.replace(/\s+/g, ' ').toUpperCase();
	});
}

function classifyStructuralCFMLTag(tag) {
	if (/^<cfif\b/i.test(tag))             return 'OPEN';
	if (/^<cfloop\b/i.test(tag))           return 'OPEN';
	if (/^<cfswitch\b/i.test(tag))         return 'OPEN';
	if (/^<cfelseif\b/i.test(tag))         return 'SIBLING';
	if (/^<cfelse\b/i.test(tag))           return 'SIBLING';
	if (/^<cfcase\b/i.test(tag))           return 'SIBLING';
	if (/^<cfdefaultcase\b/i.test(tag))    return 'SIBLING';
	if (/^<\/cfif\b/i.test(tag))           return 'CLOSE';
	if (/^<\/cfloop\b/i.test(tag))         return 'CLOSE';
	if (/^<\/cfswitch\b/i.test(tag))       return 'CLOSE';
	return 'UNKNOWN';
}

function protectStructuralCFMLAsColumnMarkers(body) {
	// Replaces own-line CFML control-flow tags with column-friendly markers
	// (`__cfm_N__,`) that sql-formatter happily treats as identifiers in a
	// column list. After formatting, restoreStructuralCFMLMarkers swaps them
	// back to their original tags and adds +1 tab to body lines so cfif
	// branches read as nested under the cfif itself.
	var lines = body.split('\n');
	var markers = createMarkerList(body, '__cfm_');
	var processed = [];
	var pattern = /^<\/?(?:cfif|cfelseif|cfelse|cfloop|cfswitch|cfcase|cfdefaultcase)\b[^>]*>$/i;
	for (var i = 0; i < lines.length; i++) {
		var trimmed = lines[i].trim();
		if (pattern.test(trimmed)) {
			var idx = markers.length;
			markers.push({ tag: trimmed, kind: classifyStructuralCFMLTag(trimmed) });
			processed.push(markers.markerPrefix + idx + '__,');
		} else {
			processed.push(lines[i]);
		}
	}
	return { code: processed.join('\n'), markers: markers };
}

function restoreStructuralCFMLMarkers(formatted, markers) {
	// Walks the sql-formatter output line-by-line. Each `__cfm_N__,?` line
	// is replaced with the original CFML tag (no trailing comma). Body lines
	// between an OPEN marker and its matching CLOSE are indented +1 tab per
	// open-depth so the SQL inside reads as nested inside the cfif.
	//
	// SIBLING markers (cfelseif, cfelse, cfcase, cfdefaultcase) sit at the
	// parent OPEN's depth, then resume +1-tab body for the next branch.
	//
	// Returns null if any marker is orphaned, an unknown kind appears, or
	// the depth tracker doesn't return to zero — the caller falls back to
	// the verbatim path.
	var lines = formatted.split('\n');
	var bodyDepth = 0;
	var result = [];
	var consumed = [];
	for (var i = 0; i < markers.length; i++) consumed.push(false);
	var markerLine = new RegExp('^(\\s*)' + (markers.markerPrefix || '__cfm_') + '(\\d+)__,?\\s*$', 'i');
	var markerAnywhere = new RegExp((markers.markerPrefix || '__cfm_') + '\\d+__', 'i');
	var nextMarker = 0;

	for (var i = 0; i < lines.length; i++) {
		var line = lines[i];
		var match = line.match(markerLine);
		if (match) {
			var indent = match[1];
			var idx = parseInt(match[2], 10);
			if (idx !== nextMarker || idx >= markers.length) return null;
			nextMarker++;
			consumed[idx] = true;
			var marker = markers[idx];
			if (marker.kind === 'OPEN') {
				result.push(indent + marker.tag);
				bodyDepth++;
			} else if (marker.kind === 'SIBLING') {
				bodyDepth--;
				if (bodyDepth < 0) return null;
				result.push(indent + marker.tag);
				bodyDepth++;
			} else if (marker.kind === 'CLOSE') {
				bodyDepth--;
				if (bodyDepth < 0) return null;
				result.push(indent + marker.tag);
			} else {
				return null;
			}
		} else {
			if (markerAnywhere.test(line)) return null;
			if (bodyDepth > 0) {
				var pad = '';
				for (var p = 0; p < bodyDepth; p++) pad += '\t';
				result.push(pad + line);
			} else {
				result.push(line);
			}
		}
	}
	for (var c = 0; c < consumed.length; c++) {
		if (!consumed[c]) return null;
	}
	if (bodyDepth !== 0) return null;
	return result.join('\n');
}

function extractAllCfqueryBodies(source) {
	// Walks the original (pre-beautifyCFML) source and collects each
	// <cfquery>'s body verbatim. Uses replaceEmbeddedBlock for tag-finding
	// (which already skips <cfquery> inside comments / strings) but discards
	// the rebuilt string — only the side-effect collection matters.
	var bodies = [];
	if (typeof source !== 'string') return bodies;
	replaceEmbeddedBlock(source, 'cfquery', function(parentIndent, openTag, body, closeTag) {
		bodies.push(body);
		return parentIndent + openTag + body + closeTag;
	});
	return bodies;
}

function deepFormatEmbedded(cfmlCode, opts, originalSource) {
	var out = cfmlCode;
	var options = opts || {};
	var doSql = options.sql !== false;
	var doCss = options.css !== false;
	var doJs = options.js === true;
	var sqlPro = options.sqlPro === true;
	var sqlDialect = options.sqlDialect || 'sql';
	var originalBodies = extractAllCfqueryBodies(originalSource);
	var cfqueryIndex = 0;

	function maybeNormalizeCFMLTags(text) {
		// Apply Phase 2 CFML normalization when Pro SQL is enabled.
		// String-aware walker so a SQL string containing literal '<cfif>'
		// text is not touched.
		if (!sqlPro) return text;
		try {
			return normalizeCFMLTagsInSafeText(text);
		} catch (err) {
			if (typeof console !== 'undefined' && console.warn) {
				console.warn('[deep-format] Phase 2 CFML normalization failed; leaving text unchanged.');
			}
			return text;
		}
	}

	if (doSql) {
		out = replaceEmbeddedBlock(out, 'cfquery', function(parentIndent, openTag, body, closeTag) {
			var currentIndex = cfqueryIndex++;
			function formatQueryBody() {

			// Structural CFML control flow inside <cfquery> is incompatible
			// with SQL formatters that normalize whitespace around tokens.
			// Use the ORIGINAL (pre-beautifyCFML) body verbatim — only adjust
			// the leading common whitespace to match the new parent depth.
			// This preserves the user's hand-crafted relative indent for
			// multi-line subqueries and inline CFML comments, which the
			// outer beautifyCFML pass would otherwise flatten.
			if (bodyHasStructuralCFMLControlFlow(body)) {
				var structuralBody = normalizeStructuralCFMLTags(body);
				var verbatimSource = (originalBodies[currentIndex] !== undefined)
					? normalizeStructuralCFMLTags(originalBodies[currentIndex])
					: structuralBody;
				var hasComplexComments = hasComplexMarkupComments(verbatimSource)
					|| hasCFMLInsideSQLBlockComment(verbatimSource);
				var canonicalSQLBody = looksLikeCanonicalProSQLBody(verbatimSource);

				/* A multiline/nested CFML comment or a CFML-looking SQL block
				 * comment is not safe input for the Pro SQL grammar. Keep the
				 * outer pass's canonical SQL/CFML hierarchy instead of preserving
				 * the source's legacy alignment, which can be interpreted as a
				 * new nesting level on the next pass. */
				if (hasComplexComments) {
					var safeBody = normalizeSafeStructuralBody(normalizeStructuralCFMLTags(body));
					return maybeNormalizeCFMLTags(
						parentIndent + openTag + '\n'
						+ indentSQLBody(safeBody, parentIndent) + '\n'
						+ parentIndent + closeTag
					);
				}

				/* A fully formatted Pro SQL body is already canonical. The outer
				 * CFML pass cannot know that a CFML branch belongs below a SQL
				 * clause, so rebuilding this body from structuralBody would
				 * flatten that branch on the next invocation. Preserve the exact
				 * canonical body, including its SQL continuation indentation. */
				if (sqlPro && canonicalSQLBody) {
					return maybeNormalizeCFMLTags(parentIndent + openTag + verbatimSource + closeTag);
				}

				/* If the outer beautifier already produced exactly the same
				 * structural body as the current source, keep that canonical
				 * layout. This is important for a previously formatted flat
				 * query: the first pass uses Tier 3 and the next pass must not
				 * reinterpret the generated indentation as fresh user indent and
				 * add another tab to every CFML branch. */
				if (structuralBody === verbatimSource && (!sqlPro || canonicalSQLBody)) {
					return maybeNormalizeCFMLTags(parentIndent + openTag + structuralBody + closeTag);
				}

				// Tier 1 — Marker-injection: when Pro SQL is enabled, replace
				// own-line CFML control-flow tags with column-friendly markers,
				// run sql-formatter, then restore. Produces full SQL re-format
				// (uppercase keywords, list-broken columns) WITH cfif structure
				// preserved AND body indented +1 inside cfif. Falls through
				// to verbatim if marker round-trip can't be verified.
				if (bodyHasUserIndent(verbatimSource)
						&& !hasComplexComments
						&& !canonicalSQLBody
						&& sqlPro
						&& typeof formatProSQLSync === 'function'
						&& typeof isProSQLLoaded === 'function'
						&& isProSQLLoaded()) {
					try {
						var verbatimCleanedForMarker = cleanEmbeddedBody(verbatimSource);
						if (verbatimCleanedForMarker !== '') {
							/* SQL formatter indentation is not semantic here: marker
							 * restoration adds the CFML branch depth afterwards. Strip
							 * every line prefix before formatting so a second pass cannot
							 * re-add the previous restoration indentation. */
							var markerInput = verbatimCleanedForMarker.split('\n').map(function(line) {
								return line.replace(/^[ \t]*/, '');
							}).join('\n');
							var marked = protectStructuralCFMLAsColumnMarkers(markerInput);
							var protectedSQLM = protectCFMLTokens(marked.code);
							var formattedSQLM = formatProSQLSync(protectedSQLM.code, sqlDialect);
							var restoredCFMLM = restoreCFMLTokens(formattedSQLM, protectedSQLM.tokens);
							restoredCFMLM = cleanRestoredCFMLTokenSpacing(restoredCFMLM);
							var markerRestored = restoreStructuralCFMLMarkers(restoredCFMLM, marked.markers);
							if (markerRestored !== null) {
								return maybeNormalizeCFMLTags(
									parentIndent + openTag + '\n'
									+ indentSQLBody(markerRestored, parentIndent) + '\n'
									+ parentIndent + closeTag
								);
							}
						}
					} catch (markerErr) {
						// Marker approach threw — fall through to verbatim
						if (typeof console !== 'undefined' && console.warn) {
							console.warn('[deep-format] Tier 1 marker injection failed (cfquery #' + currentIndex + '), falling back to next tier.');
						}
					}
				}

				// Phase 3 — WHERE hoisting + split-format-recombine.
				// When every leaf in the cfif tree starts with `where`, hoist
				// the WHERE keyword out of the branches, format the SELECT/FROM
				// + synthesized WHERE prefix with sql-formatter, then append the
				// cfif tree (with `where` stripped from leaves + body keyword
				// uppercased) and any trailing AND clauses. Achieves full Pro
				// SQL backbone formatting with cfif structure preserved as a
				// sub-tree under the (now hoisted) WHERE keyword.
				if (bodyHasUserIndent(verbatimSource)
						&& !hasComplexComments
						&& !canonicalSQLBody
						&& sqlPro
						&& typeof formatProSQLSync === 'function'
						&& typeof isProSQLLoaded === 'function'
						&& isProSQLLoaded()) {
					try {
						var cleanedForHoist = cleanEmbeddedBody(verbatimSource);
						var split = splitCfqueryBodyAtCfifTree(cleanedForHoist);
						var leavesStartWithWhere = split && detectAllLeavesStartWithWhere(split.treeLines);
						var alreadyHoistedWhere = split
							&& hasStandaloneWhereAtEnd(split.pre)
							&& hasStructuralTreeBody(split.treeLines)
							&& !leavesStartWithWhere;
						var postHasPredicateContinuation = split
							&& /^(?:and|or)\b/i.test(split.post.trim());
						var preContainsJoin = split
							&& /\b(?:inner|left(?:\s+outer)?|right(?:\s+outer)?|full(?:\s+outer)?|cross|natural)?\s*join\b/i.test(split.pre);
						if (split && (alreadyHoistedWhere
							|| (leavesStartWithWhere && postHasPredicateContinuation && !preContainsJoin))) {
							var strippedTree = leavesStartWithWhere
								? stripWhereFromLeaves(split.treeLines) : split.treeLines;
							var preTrimmed = split.pre.replace(/\s+$/, '');
							var preToFormat = hasStandaloneWhereAtEnd(preTrimmed)
								? preTrimmed
								: preTrimmed + (preTrimmed ? '\n' : '') + 'where';
							var protectedPre = protectCFMLTokens(preToFormat);
							var formattedPre = formatProSQLSync(protectedPre.code, sqlDialect);
							var restoredPre = restoreCFMLTokens(formattedPre, protectedPre.tokens);
							restoredPre = cleanRestoredCFMLTokenSpacing(restoredPre);
							restoredPre = restoredPre.replace(/\s+$/, '');

							var treeFormatted = formatStrippedTree(strippedTree);

							var postTrimmed = split.post.trim();
							var postInput = postTrimmed.split('\n').map(function(line) {
								return line.replace(/^[ \t]*/, '');
							}).join('\n');
							var formattedPost = '';
							if (postInput !== '') {
								try {
									var postProt = protectCFMLTokens(postInput);
									var postUppered = uppercaseSQLKeywordsInProtected(postProt.code);
									var postSpaced = normalizeSQLEqualsSpacing(postUppered);
									formattedPost = restoreCFMLTokens(postSpaced, postProt.tokens);
									formattedPost = '\t' + formattedPost.replace(/\n/g, '\n\t');
								} catch (postErr) {
									formattedPost = '\t' + postInput;
									if (typeof console !== 'undefined' && console.warn) {
										console.warn('[deep-format] Phase 3 post-cfif clause uppercase failed (cfquery #' + currentIndex + '); keeping verbatim.');
									}
								}
							}

							var assembled = restoredPre + '\n' + treeFormatted;
							if (formattedPost !== '') {
								assembled += '\n' + formattedPost;
							}

							return maybeNormalizeCFMLTags(
								parentIndent + openTag + '\n'
								+ indentSQLBody(assembled, parentIndent) + '\n'
								+ parentIndent + closeTag
							);
						}
					} catch (hoistErr) {
						// Phase 3 failed — fall through to Tier 2
						if (typeof console !== 'undefined' && console.warn) {
							console.warn('[deep-format] Phase 3 WHERE hoisting failed (cfquery #' + currentIndex + '); falling back to Tier 2 verbatim.');
						}
					}
				}

				// Phase 4 — AND-leaves hoisting (Phase 3's dual). Fires when
				// the cfquery body has a complete `WHERE base AND base` block
				// OUTSIDE the cfif tree, and every cfif leaf merely appends
				// optional `and xxx` / `or xxx` clauses. Format the SELECT/
				// FROM/WHERE backbone via sql-formatter, leave the cfif tree
				// structurally intact (just lite-uppercase keywords inside
				// each leaf), and synthesize-format the post-tree (GROUP BY /
				// ORDER BY / HAVING / LIMIT / UNION).
				//
				// Unlike Tier 1 / Phase 3, Phase 4 does NOT require user indent
				// — the AND-leaves precondition is specific enough. This means
				// flat-input AND-leaves cases now produce nicely-formatted
				// output instead of falling to Tier 3 verbatim.
				if (!hasComplexComments
						&& !canonicalSQLBody
						&& sqlPro
						&& typeof formatProSQLSync === 'function'
						&& typeof isProSQLLoaded === 'function'
						&& isProSQLLoaded()) {
					try {
						var cleanedForP4 = cleanEmbeddedBody(verbatimSource);
						var splitP4 = splitCfqueryBodyAtCfifTreeMulti(cleanedForP4);
						if (splitP4
								&& /\bselect\b[\s\S]*\bfrom\b[\s\S]*\bwhere\b/i.test(splitP4.pre)
								&& detectAllLeavesStartWithAndOr(splitP4.treeLines)) {
							var preTrimmedP4 = splitP4.pre.replace(/\s+$/, '');
							var preProtP4 = protectCFMLTokens(preTrimmedP4);
							var preFormattedP4 = formatProSQLSync(preProtP4.code, sqlDialect);
							var preRestoredP4 = restoreCFMLTokens(preFormattedP4, preProtP4.tokens);
							preRestoredP4 = cleanRestoredCFMLTokenSpacing(preRestoredP4);
							preRestoredP4 = preRestoredP4.replace(/\s+$/, '');

							// formatStrippedTree is the right helper here even
							// though we don't strip anything: it walks the tree
							// with depth tracking and applies keyword uppercase
							// + `=` spacing to body lines (which for Phase 4 are
							// the `and ...` / `or ...` clauses).
							var treeFormattedP4 = formatStrippedTree(splitP4.treeLines);

							var postFormattedP4 = formatPhase4PostFragment(splitP4.post, sqlDialect);

							var assembledP4 = preRestoredP4 + '\n' + treeFormattedP4;
							if (postFormattedP4 !== '') {
								assembledP4 += '\n' + postFormattedP4;
							}

							return maybeNormalizeCFMLTags(
								parentIndent + openTag + '\n'
								+ indentSQLBody(assembledP4, parentIndent) + '\n'
								+ parentIndent + closeTag
							);
						}
					} catch (p4Err) {
						if (typeof console !== 'undefined' && console.warn) {
							console.warn('[deep-format] Phase 4 AND-leaves hoisting failed (cfquery #' + currentIndex + '); falling back to Tier 2 verbatim.');
						}
					}
				}

				// Tier 2 — Verbatim with user indent: preserve original layout.
				// When Pro SQL is enabled, also apply SQL keyword uppercasing
				// to the verbatim body via protectCFMLTokens → uppercase →
				// restore. Layout is unchanged; only SQL keywords outside
				// CFML tags and SQL strings get cased.
				if (bodyHasUserIndent(verbatimSource)) {
					var verbatimCleaned = cleanEmbeddedBody(verbatimSource);
					if (verbatimCleaned !== '') {
						var canonicalStructuralBody = cleanEmbeddedBody(structuralBody);
						var verbatimFinal = alignStructuralControlFlowIndent(
							canonicalStructuralBody,
							verbatimCleaned
						);
						/* The first merge may change line prefixes used by the
						 * following structural match. Reconcile once more against the
						 * same canonical body so a fallback query is a fixed point in
						 * the same invocation, not only after reformatting the file. */
						verbatimFinal = alignStructuralControlFlowIndent(
							canonicalStructuralBody,
							verbatimFinal
						);
						if (sqlPro) {
							try {
								var protectedV = protectCFMLTokens(verbatimFinal);
								var upperedV = uppercaseSQLKeywordsInProtected(protectedV.code);
								verbatimFinal = restoreCFMLTokens(upperedV, protectedV.tokens);
							} catch (upperErr) {
								verbatimFinal = verbatimCleaned;
								if (typeof console !== 'undefined' && console.warn) {
									console.warn('[deep-format] Tier 2 keyword uppercase failed (cfquery #' + currentIndex + '); leaving body verbatim.');
								}
							}
						}
						return maybeNormalizeCFMLTags(
							parentIndent + openTag + '\n'
							+ indentSQLBody(verbatimFinal, parentIndent) + '\n'
							+ parentIndent + closeTag
						);
					}
				}

				// Tier 3 — Flat input: trust beautifyCFML's nested output.
				return maybeNormalizeCFMLTags(parentIndent + openTag + body + closeTag);
			}

			var protectedSQL = protectCFMLTokens(cleanEmbeddedBody(body));
			var formattedSQL;
			var canUsePro = sqlPro
				&& typeof formatProSQLSync === 'function'
				&& typeof isProSQLLoaded === 'function'
				&& isProSQLLoaded();
			if (canUsePro) {
				try {
					formattedSQL = formatProSQLSync(protectedSQL.code, sqlDialect);
				} catch (err) {
					if (typeof console !== 'undefined' && console.warn) {
						console.warn('[deep-format] Pro SQL formatter failed on cfquery #' + currentIndex + ', falling back to built-in beautifySQL.');
					}
					formattedSQL = beautifySQL(protectedSQL.code);
				}
			} else {
				if (sqlPro && typeof console !== 'undefined' && console.warn) {
					console.warn('[deep-format] Pro SQL checkbox is ON but engine not ready (cfquery #' + currentIndex + '), falling back to built-in beautifySQL. isProSQLLoaded():', (typeof isProSQLLoaded === 'function' && isProSQLLoaded()), 'formatProSQLSync:', typeof formatProSQLSync);
				}
				formattedSQL = beautifySQL(protectedSQL.code);
			}
			var restoredSQL;
			try {
				restoredSQL = restoreCFMLTokens(formattedSQL, protectedSQL.tokens);
			} catch (restoreErr) {
				if (typeof console !== 'undefined' && console.warn) {
					console.warn('[deep-format] SQL token restoration failed; preserving original query.');
				}
				return parentIndent + openTag
					+ (originalBodies[currentIndex] !== undefined ? originalBodies[currentIndex] : body) + closeTag;
			}
			restoredSQL = cleanRestoredCFMLTokenSpacing(restoredSQL);

			return maybeNormalizeCFMLTags(parentIndent + openTag + '\n' + indentSQLBody(restoredSQL, parentIndent) + '\n' + parentIndent + closeTag);
			}
			var candidate = formatQueryBody();
			var originalBody = originalBodies[currentIndex] !== undefined ? originalBodies[currentIndex] : body;
			var expectedData = protectSQLData(originalBody);
			var candidateClose = findClosingTagOutsideText(candidate, 'cfquery', candidate.indexOf(openTag) + openTag.length);
			var candidateBody = candidateClose && candidate.slice(candidate.indexOf(openTag) + openTag.length, candidateClose.start);
			var actualData = candidateBody === null || candidateBody === false ? null : protectSQLData(candidateBody);
			if (!expectedData.safe || !actualData || !actualData.safe ||
					JSON.stringify(expectedData.tokens) !== JSON.stringify(actualData.tokens)) {
				return parentIndent + openTag + originalBody + closeTag;
			}
			return candidate;
		});
	}

	if (doJs) {
		var originalScripts = [];
		var formattedScripts = [];
		function collectScriptBodies(code, target) {
			replaceEmbeddedBlock(code, 'script', function(indent, open, body, close) {
				target.push({ open: open, body: body });
				return indent + open + body + close;
			});
		}
		function normalizeScriptOpenIndent(tag) {
			var text = tag.replace(/\r\n?/g, '\n');
			var quote = null;
			var normalized = '';
			for (var i = 0; i < text.length; i++) {
				var character = text[i];
				normalized += character;
				if (quote) {
					if (character === quote) quote = null;
				} else if (character === '"' || character === "'") {
					quote = character;
				} else if (character === '\n') {
					while (text[i + 1] === ' ' || text[i + 1] === '\t') i++;
				}
			}
			return normalized;
		}
		collectScriptBodies(typeof originalSource === 'string' ? originalSource : cfmlCode, originalScripts);
		collectScriptBodies(out, formattedScripts);
		var scriptMappingValid = originalScripts.length === formattedScripts.length;
		for (var scriptMapIndex = 0; scriptMappingValid && scriptMapIndex < originalScripts.length; scriptMapIndex++) {
			if (normalizeScriptOpenIndent(originalScripts[scriptMapIndex].open) !==
					normalizeScriptOpenIndent(formattedScripts[scriptMapIndex].open)) scriptMappingValid = false;
		}
		if (!scriptMappingValid) {
			if (typeof notifyJavaScriptFallback === 'function') notifyJavaScriptFallback();
			return typeof originalSource === 'string' ? originalSource : cfmlCode;
		}
		var scriptIndex = 0;
		out = replaceEmbeddedBlock(out, 'script', function(parentIndent, openTag, body, closeTag) {
			var originalScript = originalScripts[scriptIndex++];
			if (!shouldFormatScript(openTag) || body.trim() == "") {
				return parentIndent + openTag + body + closeTag;
			}

			/* Template-literal payloads can contain HTML, CFML, and whitespace
			 * that is part of the rendered string. The outer CFML pass now keeps
			 * that payload relative to its opener; do not run a second JS pass
			 * that would rewrite its absolute content indentation. */
			if (hasMultilineBraceCodeTemplate(body)
					|| hasCFMLTagInsideBraceString(body)) {
				if (!verifyMixedJavaScriptTransformation(originalScript.body, body)) {
					if (typeof notifyJavaScriptFallback === 'function') notifyJavaScriptFallback();
					return parentIndent + openTag + originalScript.body + closeTag;
				}
				return parentIndent + openTag + body + closeTag;
			}

			var formattedJS = formatBraceCodeWithCFML(cleanEmbeddedBody(body));
			if (typeof applyValidatedJavaScriptIndentation === 'function') {
				formattedJS = applyValidatedJavaScriptIndentation(formattedJS);
			}
			var emittedJS = '\n' + indentEmbeddedBody(formattedJS, parentIndent) + '\n' + parentIndent;
			if (!verifyMixedJavaScriptTransformation(originalScript.body, emittedJS)) {
				if (typeof notifyJavaScriptFallback === 'function') notifyJavaScriptFallback();
				return parentIndent + openTag + originalScript.body + closeTag;
			}
			return parentIndent + openTag + emittedJS + closeTag;
		});
	}

	if (doCss) {
		var originalStyleBodies = extractCSSStyleBodies(originalSource);
		var styleIndex = 0;
		out = replaceEmbeddedBlock(out, 'style', function(parentIndent, openTag, body, closeTag) {
			var originalBody = originalStyleBodies[styleIndex++];
			var hasOriginalBody = typeof originalBody === 'string';
			var cssBody = body;
			var originalProtected = hasOriginalBody ? collectCSSProtectedSegments(originalBody) : null;
			var currentProtected = collectCSSProtectedSegments(body);
			if (hasOriginalBody && !sameCSSProtectedSegments(originalProtected, currentProtected)) {
				/* beautifyCFML runs before this pass and may rewrite indentation
				 * inside escaped CSS strings, comments, CFML tags, or #expressions.
				 * Those bytes belong to the style body, so use the pre-outer-pass
				 * body instead of trying to recover from the already changed one. */
				cssBody = originalBody;
				if (typeof console !== 'undefined' && console.warn) {
					console.warn('[deep-format] CSS protected content changed by outer formatting; using original <style> body.');
				}
			}

			if (cssBody.trim() == "") {
				return parentIndent + openTag + body + closeTag;
			}

			var normalizedCSSBody = cleanEmbeddedBody(cssBody);
			var formattedCSS = formatCSSCode(normalizedCSSBody);
			if (hasOriginalBody && originalProtected && originalProtected.safe) {
				var normalizedOriginal = cleanEmbeddedBody(originalBody);
				var candidateProtected = collectCSSProtectedSegments(formattedCSS);
				var expectedProtected = collectCSSProtectedSegments(normalizedOriginal);
				if (!sameCSSProtectedSegments(expectedProtected, candidateProtected)) {
					/* The formatter is intentionally conservative: if a future CSS
					 * branch changes an opaque span, emit the normalized original body
					 * rather than returning a damaged candidate. */
					formattedCSS = normalizedOriginal;
					if (typeof console !== 'undefined' && console.warn) {
						console.warn('[deep-format] CSS candidate changed protected content; preserving original <style> body.');
					}
				}
			}
			var candidateBody = '\n' + indentEmbeddedBody(formattedCSS, parentIndent) + '\n' + parentIndent;
			// Indentation itself can alter a continuation inside a string or comment.
			// Compare after every formatting pass, against the original opaque spans.
			if (hasOriginalBody && !sameCSSProtectedSegments(originalProtected, collectCSSProtectedSegments(candidateBody))) {
				if (typeof console !== 'undefined' && console.warn) {
					console.warn('[deep-format] CSS content cannot be safely formatted; preserving original <style> body.');
				}
				candidateBody = originalBody;
			}
			return parentIndent + openTag + candidateBody + closeTag;
		});
	}

	return out;
}

function replaceEmbeddedBlock(code, tagName, formatter) {
	var output = "";
	var index = 0;
	var openRegex = new RegExp('<' + tagName + '\\b', 'gi');

	while (true) {
		var openStart = -1;
		var openEnd = -1;
		var openMatch = null;
		openRegex.lastIndex = index;
		while (true) {
			var candidate = openRegex.exec(code);
			if (!candidate) break;
			if (isInsideCommentOrString(code.slice(index), candidate.index - index)) {
				continue;
			}
			openMatch = candidate;
			openStart = candidate.index;
			var tagClose = findCFMLTagClose(code.slice(openStart));
			if (tagClose === -1) {
				output += code.slice(index);
				return output;
			}
			openEnd = openStart + tagClose + 1;
			openMatch[0] = code.slice(openStart, openEnd);
			break;
		}
		if (!openMatch) {
			output += code.slice(index);
			break;
		}
		var lineStart = code.lastIndexOf('\n', openStart) + 1;
		var prefix = code.slice(lineStart, openStart);
		var parentIndent = /^[ \t]*$/.test(prefix) ? prefix : "";
		var blockStart = openStart - parentIndent.length;
		var contentStart = openEnd;
		var closing = findClosingTagOutsideText(code, tagName, contentStart);

		output += code.slice(index, blockStart);
		if (!closing) {
			output += code.slice(blockStart);
			break;
		}

		output += formatter(parentIndent, openMatch[0], code.slice(contentStart, closing.start), code.slice(closing.start, closing.end));
		index = closing.end;
	}

	return output;
}

function isInsideCommentOrString(code, pos) {
	for (var i = 0; i < pos; i++) {
		var c = code[i], n = code[i + 1];
		if (c === '#' && n === '#') { i++; continue; }
		if (c === '#') {
			// A tag-looking string inside a CFML interpolation is not markup.
			var hashQuote = "", hashEnd = -1;
			for (var h = i + 1; h < code.length; h++) {
				if (hashQuote) {
					if (code[h] === hashQuote) {
						if (code[h + 1] === hashQuote) h++;
						else hashQuote = "";
					}
				} else if (code[h] === "'" || code[h] === '"') {
					hashQuote = code[h];
				} else if (code[h] === '#') {
					if (code[h + 1] === '#') h++;
					else { hashEnd = h; break; }
				}
			}
			if (hashEnd !== -1) {
				if (hashEnd >= pos) return true;
				i = hashEnd;
				continue;
			}
		}
		if (c !== '<') continue; // Quotes and slashes in HTML text are literal.
		if (n === '!' && code[i + 2] === '-' && code[i + 3] === '-') {
			var markupEnd = findMarkupCommentEnd(code, i);
			if (markupEnd === -1 || markupEnd > pos) return true;
			i = markupEnd - 1;
			continue;
		}
		var tag = code.slice(i).match(/^<(\/?)([a-z][\w:.-]*)(?=[\s/>])/i);
		if (!tag) continue;
		var tagEnd = findCFMLTagClose(code.slice(i));
		if (tagEnd === -1 || i + tagEnd >= pos) return true;
		var contentStart = i + tagEnd + 1;
		var name = tag[2].toLowerCase();
		if (!tag[1] && !/\/\s*>$/.test(code.slice(i, contentStart))) {
			if (/^(?:script|style|cfquery|cfscript)$/.test(name)) {
				var rawClose = findClosingTagOutsideText(code, name, contentStart);
				if (!rawClose || rawClose.start >= pos) return true;
				i = rawClose.end - 1;
				continue;
			}
			if (name === 'textarea' || name === 'title') {
				var rcdataClose = new RegExp('</' + name + '\\s*>', 'ig');
				rcdataClose.lastIndex = contentStart;
				var rcdataMatch = rcdataClose.exec(code);
				if (!rcdataMatch || rcdataMatch.index >= pos) return true;
				i = rcdataClose.lastIndex - 1;
				continue;
			}
		}
		i = contentStart - 1;
	}
	return false;
}

function findClosingTagOutsideText(code, tagName, startIndex) {
	var closeTag = '</' + tagName;
	var lowerCode = code.toLowerCase();
	var quote = "";
	var inLineComment = false;
	var inBlockComment = false;
	var isScript = tagName.toLowerCase() === 'script';
	var lastScriptToken = null;
	var scriptParens = [];
	var controlKeyword = false;

	for (var i = startIndex; i < code.length; i++) {
		var char = code[i];
		var nextChar = code[i + 1];

		if (inLineComment) {
			if (char == '\n') {
				inLineComment = false;
			}
			continue;
		}

		if (inBlockComment) {
			if (char == '*' && nextChar == '/') {
				inBlockComment = false;
				i++;
			}
			continue;
		}

		if (quote != "") {
			// JS strings and templates use backslash escapes; CFML/SQL use
			// doubled quotes and treat a backslash as an ordinary character.
			if (tagName.toLowerCase() === 'script' && char === '\\') { i++; continue; }
			/* CSS strings use backslash escapes, including an escaped physical
			 * newline. Keep `</style>` inside `"...\"</style>..."` and the
			 * continuation line inside the style body. This branch is deliberately
			 * style-only; CFML/SQL quote rules above remain unchanged. */
			if (tagName.toLowerCase() === 'style' && char === '\\') {
				if (nextChar === '\r' && code[i + 2] === '\n') i += 2;
				else i++;
				continue;
			}
			if (char == quote) {
				if (tagName.toLowerCase() !== 'script' && tagName.toLowerCase() !== 'style' && (quote == "'" || quote == '"') && nextChar == quote) {
					i++;
					continue;
				}
				quote = "";
			}
			continue;
		}

		if (char == '<' && code.substr(i, 5) == '<!---') {
			var cfmlCommentEnd = findCFMLCommentEnd(code, i);
			if (cfmlCommentEnd === -1) return null;
			i = cfmlCommentEnd - 1;
			continue;
		}
		if (char == '<' && code.substr(i, 4) == '<!--') {
			var htmlCommentEnd = findMarkupCommentEnd(code, i);
			if (htmlCommentEnd === -1) return null;
			i = htmlCommentEnd - 1;
			continue;
		}

		if (tagName.toLowerCase() === 'script' && char === '<' && /^<\/?cf[a-z]/i.test(code.slice(i))) {
			var cfTagClose = findCFMLTagClose(code.slice(i));
			if (cfTagClose !== -1) { i += cfTagClose; lastScriptToken = 'operator'; continue; }
		}
		if (tagName.toLowerCase() === 'style' && char === '\\') {
			if (nextChar === '\r' && code[i + 2] === '\n') i += 2;
			else i++;
			continue;
		}

		if (char == '-' && nextChar == '-' && tagName.toLowerCase() !== 'script' && tagName.toLowerCase() !== 'style') {
			inLineComment = true;
			i++;
			continue;
		}
		if (char == '/' && nextChar == '/' && tagName.toLowerCase() !== 'style') {
			inLineComment = true;
			i++;
			continue;
		}
		if (char == '/' && nextChar == '*') {
			inBlockComment = true;
			i++;
			continue;
		}
		if (isScript && char === '/' && (lastScriptToken === null || lastScriptToken === 'operator')) {
			var regexEnd = i + 1;
			var inClass = false;
			while (regexEnd < code.length && code[regexEnd] !== '\n' && code[regexEnd] !== '\r') {
				var regexChar = code[regexEnd];
				if (regexChar === '\\') { regexEnd += 2; continue; }
				if (regexChar === '[') inClass = true;
				else if (regexChar === ']') inClass = false;
				else if (regexChar === '/' && !inClass) break;
				regexEnd++;
			}
			if (code[regexEnd] === '/') {
				i = regexEnd;
				while (/[a-z]/i.test(code[i + 1] || '')) i++;
				lastScriptToken = 'value';
				continue;
			}
		}
		if (char == "'" || char == '"' || char == '`') {
			quote = char;
			if (isScript) lastScriptToken = 'value';
			continue;
		}
		if (lowerCode.slice(i, i + closeTag.length) == closeTag
				&& /[\s>]/.test(code[i + closeTag.length] || '')) {
			var end = i + closeTag.length;
			while (end < code.length && /[ \t\r\n]/.test(code[end])) end++;
			if (code[end] == '>') return { start: i, end: end + 1 };
		}
		if (isScript && !/\s/.test(char)) {
			if (/[A-Za-z_$]/.test(char)) {
				var wordStart = i;
				while (/[A-Za-z0-9_$]/.test(code[i + 1] || '')) i++;
				var word = code.slice(wordStart, i + 1);
				controlKeyword = /^(?:if|while|for|with|switch|catch)$/.test(word);
				lastScriptToken = REGEX_CONTEXT_KEYWORDS[word] ? 'operator' : 'value';
			} else if (/[0-9]/.test(char)) {
				while (/[A-Za-z0-9_.]/.test(code[i + 1] || '')) i++;
				lastScriptToken = 'value';
			} else if (char === '(') {
				scriptParens.push(controlKeyword);
				controlKeyword = false;
				lastScriptToken = 'operator';
			} else if (char === ')') {
				lastScriptToken = scriptParens.pop() ? 'operator' : 'value';
			} else {
				lastScriptToken = char === ']' ? 'value' : 'operator';
				controlKeyword = false;
			}
		}
	}

	return null;
}

/* Keep SQL data opaque through whitespace cleanup and indentation. The same
 * spans are compared with the pre-outer-pass body before emitting a query. */
function protectSQLData(source) {
	var tokens = createMarkerList(source, '__SQLDATA_');
	var output = '';
	var safe = true;
	for (var i = 0; i < source.length;) {
		var start = i;
		var c = source[i];
		var next = source[i + 1];
		if (source.substr(i, 5) === '<!---') {
			var commentEnd = findCFMLCommentEnd(source, i);
			if (commentEnd === -1) { safe = false; break; }
			output += source.slice(i, commentEnd);
			i = commentEnd;
			continue;
		}
		if (c === '<' && /^<\/?cf\w+\b/i.test(source.slice(i))) {
			var tagEnd = findCFMLTagClose(source.slice(i));
			if (tagEnd === -1) { safe = false; break; }
			output += source.slice(i, i + tagEnd + 1);
			i += tagEnd + 1;
			continue;
		}
		var dollar = c === '$' && source.slice(i).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
		if (dollar) {
			var dollarEnd = source.indexOf(dollar[0], i + dollar[0].length);
			if (dollarEnd === -1) { safe = false; break; }
			i = dollarEnd + dollar[0].length;
		} else if ((c === '-' && next === '-') || (c === '/' && next === '/')) {
			i += 2;
			while (i < source.length && source[i] !== '\n' && source[i] !== '\r') i++;
		} else if (c === '/' && next === '*') {
			var end = source.indexOf('*/', i + 2);
			if (end === -1) { safe = false; break; }
			i = end + 2;
		} else if (c === "'" || c === '"' || c === '`' || c === '[') {
			var close = c === '[' ? ']' : c;
			i++;
			var closed = false;
			while (i < source.length) {
				if (source[i] === '\\' && c !== '[') { i += 2; continue; }
				if (source[i] === close) {
					if (source[i + 1] === close) { i += 2; continue; }
					i++;
					closed = true;
					break;
				}
				i++;
			}
			if (!closed) { safe = false; break; }
		} else {
			output += c;
			i++;
			continue;
		}
		output += tokens.markerPrefix + tokens.length + '__';
		tokens.push(source.slice(start, i));
	}
	if (!safe) output += source.slice(i);
	return { code: output, tokens: tokens, safe: safe };
}

function restoreSQLData(code, protectedData) {
	return restoreUniqueMarkers(code, protectedData.tokens, '__SQLDATA_');
}

function protectCFMLTokens(sqlBody) {
	var tokens = createMarkerList(sqlBody, '__CFTOKEN_');
	var code = "";
	var i = 0;

	function addToken(value) {
		var id = tokens.markerPrefix + tokens.length + '__';
		tokens.push(value);
		return id;
	}

	while (i < sqlBody.length) {
		var char = sqlBody[i];

		if (char == "'" || char == '"' || char == '`') {
			var quote = char;
			var quoteStart = i;
			i++;
			while (i < sqlBody.length) {
				if (sqlBody[i] == '\\') {
					i += 2;
					continue;
				}
				if (sqlBody[i] == quote) {
					if (sqlBody[i + 1] == quote) {
						i += 2;
						continue;
					}
					i++;
					break;
				}
				i++;
			}
			code += addToken(sqlBody.slice(quoteStart, i));
			continue;
		}

		var rest = sqlBody.slice(i);
		if (rest.slice(0, 5) === '<!---') {
			var commentEnd = findCFMLCommentEnd(sqlBody, i);
			var commentValue = commentEnd === -1 ? sqlBody.slice(i) : sqlBody.slice(i, commentEnd);
			code += addToken(commentValue);
			i += commentValue.length;
			continue;
		}
		if (/^<\/?cf\w+\b/i.test(rest)) {
			var tagEnd = findCFMLTagClose(rest);
			if (tagEnd !== -1) {
				var tag = rest.slice(0, tagEnd + 1);
				code += addToken(tag);
				i += tag.length;
				continue;
			}
		}
		var tokenMatch = rest.match(/^(##|#(?:##|[^#])+#)/);
		if (tokenMatch) {
			code += addToken(tokenMatch[0]);
			i += tokenMatch[0].length;
			continue;
		}

		code += char;
		i++;
	}

	return {
		code: code,
		tokens: tokens
	};
}

function restoreCFMLTokens(code, tokens) {
	var restored = restoreUniqueMarkers(code, tokens, '__CFTOKEN_');
	if (restored === null) throw new Error('Unable to restore protected SQL tokens safely');
	return restored;
}

function cleanRestoredCFMLTokenSpacing(code) {
	var protectedData = protectSQLData(code);
	if (!protectedData.safe) return code;
	var cleaned = protectedData.code
		.replace(/\s+(<\/cf\w+\b[^>]*>)/gi, '$1')
		.replace(/(<\/?cf\w+\b[^>]*>)(and|or)\s*\(/gi, function(match, cfTag, operator) {
			return cfTag + operator.toUpperCase() + ' (';
		});
	var restored = restoreSQLData(splitMergedSQLComments(cleaned), protectedData);
	return restored === null ? code : restored;
}

/* sql-formatter is fed CFML markup comments (`<!--- ... --->`) masked as
 * opaque identifier placeholders. Because a masked comment looks like a bare
 * identifier, the formatter glues it to the FOLLOWING token instead of giving
 * it its own line. After restore the comment ends up merged onto a code line,
 * LEADING the next item:
 *       regen_group_id,
 *       <!--- why ---> version_no,        <-- comment wrongly fused to version_no
 *
 * Whether the author originally wrote that comment as a trailing annotation
 * (`regen_group_id, <!--- why --->`) or on its own line (`<!--- why --->`
 * above `version_no`) is UNRECOVERABLE here — both mask to the identical
 * token stream `regen_group_id, __CFTOKEN__ version_no,` before formatting.
 * So the safe, intent-neutral fix is to give the comment its OWN line: it is
 * never fused to code, and never wrongly attached to the previous item.
 *
 * Only a comment at the START of a line followed by more content is split —
 * a normal trailing comment (`<code> <!--- ... --->`, comment at line END) is
 * left untouched. */
function splitMergedSQLComments(code) {
	var lines = code.split('\n');
	var out = [];
	for (var i = 0; i < lines.length; i++) {
		var line = lines[i];
		var m = line.match(/^(\s*)<!---/);
		if (m) {
			var commentStart = m[1].length;
			var commentEnd = findCFMLCommentEnd(line, commentStart);
			var following = commentEnd === -1 ? '' : line.slice(commentEnd).trim();
			if (commentEnd !== -1 && following !== '') {
				out.push(line.slice(0, commentEnd));
				out.push(m[1] + following);
				continue;
			}
		}
		out.push(line);
	}
	return out.join('\n');
}

function shouldFormatScript(openTag) {
	if (/\bsrc\s*=/i.test(openTag)) {
		return false;
	}

	var typeMatch = openTag.match(/\btype\s*=\s*["']?([^"'\s>]+)/i);
	if (!typeMatch) {
		return true;
	}

	var typeValue = typeMatch[1].toLowerCase();
	return ['text/javascript', 'application/javascript', 'module'].includes(typeValue);
}

function normalizeSafeStructuralBody(body) {
	var lines = body.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
	var commentMask = buildMarkupCommentMask(lines);
	var baseIndent = null;
	for (var i = 0; i < lines.length; i++) {
		if (commentMask[i] || lines[i].trim() === '') continue;
		var prefix = (lines[i].match(/^[ \t]*/) || [''])[0];
		if (baseIndent === null || prefix.length < baseIndent) baseIndent = prefix.length;
	}
	if (baseIndent === null) baseIndent = 0;

	var result = [];
	var commentState = { cfmlDepth: 0, htmlDepth: 0 };
	var commentOrigPrefix = null;
	var structuralDepth = 0;
	for (var j = 0; j < lines.length; j++) {
		var line = lines[j];
		var trimmed = line.trim();
		var scan = advanceMarkupCommentState(trimmed, commentState);
		var prefix = (line.match(/^[ \t]*/) || [''])[0];
		if (scan.startsInComment || (scan.hadComment && !scan.codeOutsideComment)) {
			if (!scan.startsInComment) commentOrigPrefix = prefix;
			if (commentOrigPrefix === null) commentOrigPrefix = prefix;
			var relative = prefix.indexOf(commentOrigPrefix) === 0
				? prefix.slice(commentOrigPrefix.length) : '';
			result.push(new Array(structuralDepth + 1).join('\t') + relative + trimmed);
			continue;
		}
		commentOrigPrefix = null;
		var structuralMatch = trimmed.match(/^<\/(cfif|cfelseif|cfelse|cfloop|cfswitch|cfcase|cfdefaultcase)\b/i);
		var structuralOpen = trimmed.match(/^<(cfif|cfloop|cfswitch|cfcase)\b/i);
		var structuralMiddle = trimmed.match(/^<(cfelseif|cfelse|cfdefaultcase)\b/i);
		if (structuralMatch || structuralMiddle) structuralDepth = Math.max(0, structuralDepth - 1);
		if (trimmed === '') {
			result.push('');
		} else {
			result.push(line.slice(Math.min(baseIndent, prefix.length)));
		}
		if (structuralOpen && !/\/\s*>$/.test(trimmed)) structuralDepth++;
	}
	while (result.length > 0 && result[0].trim() === '') result.shift();
	while (result.length > 0 && result[result.length - 1].trim() === '') result.pop();
	return result.join('\n');
}

function cleanEmbeddedBody(body) {
	var lines = body.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

	while (lines.length > 0 && lines[0].trim() == "") {
		lines.shift();
	}
	while (lines.length > 0 && lines[lines.length - 1].trim() == "") {
		lines.pop();
	}

	/* The first non-empty line defines the embedded block's common base.
	 * Using the minimum indentation is incorrect for legacy mixed whitespace:
	 * one outlier top-level `<cfelseif>` with a single tab caused the common
	 * 16-space prefix on every other line to survive. Do not call `.trim()` on
	 * the final string either—doing so removes the first line's indentation a
	 * second, different way from all following lines. */
	var baseIndent = null;
	for (var i = 0; i < lines.length; i++) {
		if (lines[i].trim() === "") continue;
		var indentMatch = lines[i].match(/^[ \t]*/);
		baseIndent = indentMatch ? indentMatch[0].length : 0;
		break;
	}

	if (baseIndent && baseIndent > 0) {
		for (var j = 0; j < lines.length; j++) {
			var lineIndent = (lines[j].match(/^[ \t]*/) || [''])[0].length;
			/* A malformed/outlier line may be less indented than the common
			 * base. Strip its available prefix, never content; structural tag
			 * alignment will place such a line from the canonical hierarchy. */
			lines[j] = lines[j].slice(Math.min(baseIndent, lineIndent));
		}
	}

	return lines.join('\n');
}

function indentEmbeddedBody(body, parentIndent) {
	return body.split('\n').map(function(line) {
		if (line.trim() == "") {
			return "";
		}
		return parentIndent + '\t' + line;
	}).join('\n');
}

function indentSQLBody(body, parentIndent) {
	var protectedData = protectSQLData(body);
	if (!protectedData.safe) return body;
	var restored = restoreSQLData(indentEmbeddedBody(protectedData.code, parentIndent), protectedData);
	return restored === null ? body : restored;
}

/* Count SQL parenthesis changes after hiding quoted strings and CFML tokens.
 * This lets the structural-query fallback distinguish a real multi-line
 * subquery continuation from an ordinary CFML branch body. */
function scanSQLParentheses(line) {
	var protectedText = protectCFMLTokens(line).code;
	var delta = 0;
	var hasSelect = false;
	for (var i = 0; i < protectedText.length; i++) {
		if (protectedText[i] === '-' && protectedText[i + 1] === '-') break;
		if (protectedText[i] === '/' && protectedText[i + 1] === '*') {
			var endComment = protectedText.indexOf('*/', i + 2);
			if (endComment === -1) break;
			i = endComment + 1;
			continue;
		}
		if (protectedText[i] === '(') delta++;
		else if (protectedText[i] === ')') delta--;
		else if (/[A-Za-z]/.test(protectedText[i])) {
			var wordStart = i;
			while (i < protectedText.length && /[A-Za-z0-9_$]/.test(protectedText[i])) i++;
			if (protectedText.slice(wordStart, i).toLowerCase() === 'select') hasSelect = true;
			i--;
		}
	}
	return { delta: delta, hasSelect: hasSelect };
}

function buildMarkupCommentMask(lines) {
	var mask = [];
	var state = { cfmlDepth: 0, htmlDepth: 0 };
	for (var i = 0; i < lines.length; i++) {
		var trimmed = lines[i].trim();
		var scan = advanceMarkupCommentState(trimmed, state);
		/* A mixed line may contain live code after a closed comment. It is
		 * still masked for structural-query detection because the line cannot
		 * safely be classified as a standalone SQL/CFML leaf. */
		mask[i] = scan.startsInComment || scan.hadComment;
	}
	return mask;
}

function hasComplexMarkupComments(text) {
	if (typeof text !== 'string') return false;
	/* Comment markers inside strings are conservatively treated as complex.
	 * The safe structural fallback preserves them, while trying to infer
	 * string/comment precedence here could reintroduce the same boundary bug. */
	for (var i = 0; i < text.length; i++) {
		if (text.slice(i, i + 5) !== '<!---') continue;
		var end = findCFMLCommentEnd(text, i);
		var value = end === -1 ? text.slice(i) : text.slice(i, end);
		if (value.indexOf('\n') !== -1
				|| value.indexOf('<!---', 5) !== -1
				|| /<!---\s*\/?cf/i.test(value)) return true;
		if (end === -1) return true;
		i = end - 1;
	}
	return false;
}

function hasCFMLInsideSQLBlockComment(text) {
	if (typeof text !== 'string') return false;
	var start = 0;
	while ((start = text.indexOf('/*', start)) !== -1) {
		var end = text.indexOf('*/', start + 2);
		var value = end === -1 ? text.slice(start) : text.slice(start, end + 2);
		if (/<\/?cf[a-z]/i.test(value)) return true;
		if (end === -1) return true;
		start = end + 2;
	}
	return false;
}

/* Structural query fallback may preserve SQL continuation whitespace from the
 * original body, but CFML control tags and ordinary SQL lines must use the
 * indentation computed by the outer named-tag hierarchy. A minimum-indent trim
 * is unsafe for legacy mixed whitespace: one outlier `<cfelseif>` beginning
 * with a tab makes the common 16-space prefix survive on every other line.
 * Merge canonical structural/baseline lines while preserving deeper pure-tab
 * SQL continuations at the top level or inside an open SQL parenthesis. */
function alignStructuralControlFlowIndent(canonicalBody, preservedBody) {
	if (typeof canonicalBody !== 'string' || typeof preservedBody !== 'string') {
		return preservedBody;
	}

	var structural = /^<\/?(?:cfif|cfelseif|cfelse|cfloop|cfswitch|cfcase|cfdefaultcase)\b[^>]*>$/i;
	var canonicalLines = canonicalBody.split('\n');
	var preservedLines = preservedBody.split('\n');
	var canonicalCommentMask = buildMarkupCommentMask(canonicalLines);
	var canonicalIndex = 0;
	var preservedCommentState = { cfmlDepth: 0, htmlDepth: 0 };

	for (var i = 0; i < preservedLines.length; i++) {
		var preservedTrimmed = preservedLines[i].trim();
		var preservedCommentScan = advanceMarkupCommentState(preservedTrimmed, preservedCommentState);
		if (preservedCommentScan.startsInComment
				|| (preservedCommentScan.hadComment && !preservedCommentScan.codeOutsideComment)) continue;
		if (!structural.test(preservedTrimmed)) continue;

		var preservedName = preservedTrimmed.match(/^<\/?([a-zA-Z][\w-]*)/)[1].toLowerCase();
		var matchIndex = -1;
		for (var j = canonicalIndex; j < canonicalLines.length; j++) {
			if (canonicalCommentMask[j]) continue;
			var canonicalTrimmed = canonicalLines[j].trim();
			var canonicalMatch = canonicalTrimmed.match(/^<\/?([a-zA-Z][\w-]*)/);
			if (canonicalMatch
					&& structural.test(canonicalTrimmed)
					&& canonicalMatch[1].toLowerCase() === preservedName) {
				matchIndex = j;
				break;
			}
		}
		if (matchIndex === -1) continue;

		/* Use the canonical line, not merely its prefix: this also keeps the
		 * outer scanner's case/attribute normalization and avoids retaining
		 * residual spaces from the mixed original prefix. */
		preservedLines[i] = canonicalLines[matchIndex];
		canonicalIndex = matchIndex + 1;
	}

	/* Reconcile the remaining SQL lines with the canonical structural body.
	 * Space-only and mixed prefixes are legacy baseline/column whitespace, so
	 * the canonical line wins. Preserve a pure-tab prefix only when it is
	 * deeper than the canonical line; this keeps intentional SQL continuation
	 * alignment stable across later passes without allowing outdented or
	 * mixed-whitespace lines to override the structural hierarchy. */
	var preservedStructuralDepth = 0;
	var preservedSQLParenDepth = 0;
	var preservedSQLSubqueryDepth = 0;
	var preservedCommentState = { cfmlDepth: 0, htmlDepth: 0 };
	for (var k = 0; k < preservedLines.length && k < canonicalLines.length; k++) {
		var preservedPrefix = (preservedLines[k].match(/^[ \t]*/) || [''])[0];
		var canonicalPrefix = (canonicalLines[k].match(/^[ \t]*/) || [''])[0];
		var preservedTrimmedAtK = preservedLines[k].trim();
		var preservedCommentScanAtK = advanceMarkupCommentState(preservedTrimmedAtK, preservedCommentState);
		if (preservedCommentScanAtK.startsInComment
				|| (preservedCommentScanAtK.hadComment && !preservedCommentScanAtK.codeOutsideComment)) continue;
		var structuralKindAtK = structural.test(preservedTrimmedAtK)
				? classifyStructuralCFMLTag(preservedTrimmedAtK) : 'UNKNOWN';
		var sqlStructureAtK = scanSQLParentheses(preservedLines[k]);
		var parenDeltaAtK = sqlStructureAtK.delta;
		if (sqlStructureAtK.hasSelect
				&& (preservedSQLParenDepth > 0 || parenDeltaAtK > 0)) {
			preservedSQLSubqueryDepth = Math.max(
				preservedSQLSubqueryDepth,
				preservedSQLParenDepth + parenDeltaAtK
			);
		}
		if (preservedTrimmedAtK !== canonicalLines[k].trim()
				|| /^<!---?/.test(preservedTrimmedAtK)
				|| /^\/\*/.test(preservedTrimmedAtK)) {
			if (structuralKindAtK === 'OPEN') preservedStructuralDepth++;
			else if (structuralKindAtK === 'CLOSE') preservedStructuralDepth = Math.max(0, preservedStructuralDepth - 1);
			preservedSQLParenDepth = Math.max(0, preservedSQLParenDepth + parenDeltaAtK);
			continue;
		}
		var pureTabPrefix = preservedPrefix.length > 0
				&& preservedPrefix.replace(/\t/g, '') === '';
		if (structural.test(preservedTrimmedAtK)
				|| (preservedStructuralDepth > 0 && preservedSQLSubqueryDepth <= 0)
				|| !pureTabPrefix
				|| preservedPrefix.length <= canonicalPrefix.length) {
			preservedLines[k] = canonicalLines[k];
		}
		if (structuralKindAtK === 'OPEN') preservedStructuralDepth++;
		else if (structuralKindAtK === 'CLOSE') preservedStructuralDepth = Math.max(0, preservedStructuralDepth - 1);
		preservedSQLParenDepth = Math.max(0, preservedSQLParenDepth + parenDeltaAtK);
		if (preservedSQLSubqueryDepth > 0
				&& preservedSQLParenDepth < preservedSQLSubqueryDepth) {
			preservedSQLSubqueryDepth = 0;
		}
	}

	return preservedLines.join('\n');
}

function formatBraceCode(code, splitAdjacentBlocks) {
	var protectedText = protectBraceCodeText(code);
	var protectedParens = protectBraceCodeParens(protectedText.code);
	var normalized = protectedParens.code;

	if (splitAdjacentBlocks == true) {
		normalized = normalized.replace(/}\s*(?=[.#A-Za-z_*[])/g, '}\n');
	}

	// Empty `{}` and `[]` literals stay on one line. Without this guard
	// the naive `{` → `{\n` / `}` → `\n}` rewrites turn `var x = {};`
	// into `var x = {\n};` (two lines) — visually verbose for empty
	// container literals. Mark them with a sentinel so the splits skip
	// them, then restore at the end.
	normalized = normalized
		.replace(/\{\s*\}/g, '__BRACECODE_EMPTY_OBJ__')
		.replace(/\[\s*\]/g, '__BRACECODE_EMPTY_ARR__');

	normalized = normalized
		.replace(/{/g, '{\n')
		.replace(/}/g, '\n}')
		.replace(/;\s*/g, ';\n');

	var lines = normalized.split('\n');
	var output = [];
	var indentLevel = 0;
	var blockStack = [{ baseIndent: 0, inCase: false }];

	for (var i = 0; i < lines.length; i++) {
		var line = lines[i].trim();
		if (line == "") {
			continue;
		}

		var top = blockStack[blockStack.length - 1] || { baseIndent: 0, inCase: false };
		var isCase = /^(?:case\b[^:]+|default)\s*:/.test(line);
		var startCloser = line.startsWith("}") || line.startsWith("]");

		if (startCloser) {
			indentLevel = top.baseIndent - 1;
			/* A branch line such as `} catch {` or `} else {` closes
			 * the previous block and opens its replacement on the same
			 * physical line. Pop the closed block before calculating the
			 * next block's base; otherwise the replacement remains on the
			 * old block's stack and every following line drifts one level. */
			if (line.endsWith("{") && blockStack.length > 1) {
				blockStack.pop();
			}
		} else if (isCase) {
			indentLevel = top.baseIndent;
		}

		if (indentLevel < 0) {
			indentLevel = 0;
		}

		output.push(''.padStart(indentLevel, '\t') + line);

		if (isCase) {
			indentLevel = top.baseIndent + 1;
			top.inCase = true;
		}

		if (line.endsWith("{") || line.endsWith("[")) {
			indentLevel += 1;
			blockStack.push({ baseIndent: indentLevel, inCase: false });
		} else if (startCloser && blockStack.length > 1) {
			blockStack.pop();
		}
	}

	var joined = output.join('\n');
	// Restore empty `{}` and `[]` sentinels (see comment above the
	// replace block — keeps `var x = {};` on one line).
	joined = joined
		.replace(/__BRACECODE_EMPTY_OBJ__/g, '{}')
		.replace(/__BRACECODE_EMPTY_ARR__/g, '[]');
	joined = restoreBraceCodeParens(joined, protectedParens.tokens);
	return restoreBraceCodeText(joined, protectedText.tokens);
}

/* Format JavaScript blocks that contain own-line CFML control tags.
 *
 * `formatBraceCode` intentionally knows nothing about CFML, so a script body
 * such as `<cfif>\ncall();\n</cfif>` used to lose the CFML depth when the deep
 * JS pass ran after beautifyCFML. Protect the tags before brace formatting,
 * then add a separate named CFML depth to the brace-formatted lines. Strings,
 * comments, and template literals are protected first, so literal `<cfif>`
 * text is never treated as structure. */
function hasMultilineBraceCodeTemplate(code) {
	var opening = -1;
	for (var i = 0; i < code.length; i++) {
		if (code[i] !== '`') continue;
		var slashCount = 0;
		for (var j = i - 1; j >= 0 && code[j] === '\\'; j--) slashCount++;
		if (slashCount % 2 === 1) continue;
		if (opening === -1) {
			opening = i;
		} else {
			if (code.slice(opening, i).indexOf('\n') !== -1) return true;
			opening = -1;
		}
	}
	return false;
}

function hasCFMLTagInsideBraceString(code) {
	if (typeof code !== 'string') return false;
	var protectedText = protectBraceCodeText(code);
	for (var i = 0; i < protectedText.tokens.length; i++) {
		var token = protectedText.tokens[i];
		if (/^[\"'`]/.test(token) && /<\/?cf[a-z]/i.test(token)) return true;
	}
	return false;
}

function formatBraceCodeWithCFML(code) {
	var protectedText = protectBraceCodeText(code);
	var protectedTags = protectBraceCodeCFMLTags(protectedText.code);
	var formatted = formatBraceCode(protectedTags.code, false);
	var lines = formatted.split('\n');
	var result = [];
	var cfDepth = 0;
	var tagLine = /^__CFMLBRACETAG_(\d+)__$/;

	for (var i = 0; i < lines.length; i++) {
		var line = lines[i];
		var leading = (line.match(/^[\t]*/) || [''])[0];
		var trimmed = line.trim();
		var tagMatch = trimmed.match(tagLine);
		var tag = tagMatch ? protectedTags.tags[parseInt(tagMatch[1], 10)] : null;
		var structuralKind = tag ? classifyStructuralCFMLTag(tag.trim()) : 'UNKNOWN';

		if (tag && structuralKind === 'CLOSE') {
			cfDepth = Math.max(0, cfDepth - 1);
			result.push(leading + repeatTab(cfDepth) + tag.trim());
		} else if (tag && structuralKind === 'SIBLING') {
			cfDepth = Math.max(0, cfDepth - 1);
			result.push(leading + repeatTab(cfDepth) + tag.trim());
			cfDepth++;
		} else if (tag && structuralKind === 'OPEN') {
			result.push(leading + repeatTab(cfDepth) + tag.trim());
			cfDepth++;
		} else {
			result.push(leading + repeatTab(cfDepth) + trimmed);
		}
	}

	return restoreBraceCodeText(
		restoreBraceCodeCFMLTags(result.join('\n'), protectedTags.tags),
		protectedText.tokens
	);
}

/* Map real CFML tags to ordered JS comments for validation only. Strings,
 * regexes, templates and comments stay opaque while tag locations are found.
 * If a marker is ambiguous or the resulting JavaScript cannot be parsed, the
 * caller must retain the original region. */
function prepareMixedJavaScriptForValidation(code) {
	if (/__BRACETOKEN_\d+__|__CFMLBRACETAG_\d+__|__CFMLVALIDATION_\d+__/.test(code)) return null;
	var protectedText = protectBraceCodeText(code);
	var protectedTags = protectBraceCodeCFMLTags(protectedText.code);
	function restoreTokens(value) {
		return value.replace(/__BRACETOKEN_(\d+)__/g, function(match, index) {
			var token = protectedText.tokens[parseInt(index, 10)];
			return token === undefined ? match : token;
		});
	}
	var tags = protectedTags.tags.map(restoreTokens);
	var masked = protectedTags.code.replace(/__CFMLBRACETAG_(\d+)__/g, function(match, index) {
		var tag = tags[parseInt(index, 10)];
		var newlines = (tag.match(/\n/g) || []).length;
		return '/*__CFMLVALIDATION_' + index + '__' + new Array(newlines + 1).join('\n') + '*/';
	});
	return { code: restoreTokens(masked), tags: tags };
}

function verifyMixedJavaScriptTransformation(original, formatted) {
	if (typeof verifyJavaScriptTransformation !== 'function') return false;
	// The common pure-JavaScript path needs no placeholder round trip.
	if (!/<\/?cf[a-z]/i.test(original) && !/<\/?cf[a-z]/i.test(formatted)) {
		return verifyJavaScriptTransformation(original, formatted).ok;
	}
	var before = prepareMixedJavaScriptForValidation(original);
	var after = prepareMixedJavaScriptForValidation(formatted);
	if (!before || !after || JSON.stringify(before.tags) !== JSON.stringify(after.tags)) return false;
	return verifyJavaScriptTransformation(before.code, after.code).ok;
}

/* Protect CFML tags after protectBraceCodeText has hidden strings/comments.
 * The small scanner honors quoted attributes so `>` inside a tag value does
 * not terminate the token early. */
function protectBraceCodeCFMLTags(code) {
	var tags = [];
	var output = '';
	var i = 0;
	while (i < code.length) {
		if (code[i] === '<' && /^<\/?cf[a-z]/i.test(code.slice(i))) {
			var quote = null;
			var end = i + 1;
			for (; end < code.length; end++) {
				var c = code[end];
				if (quote) {
					if (c === quote) quote = null;
					continue;
				}
				if (c === '"' || c === "'") {
					quote = c;
					continue;
				}
				if (c === '>') break;
			}
			if (end < code.length && code[end] === '>') {
				var index = tags.length;
				tags.push(code.slice(i, end + 1));
				output += '__CFMLBRACETAG_' + index + '__';
				i = end + 1;
				continue;
			}
		}
		output += code[i++];
	}
	return { code: output, tags: tags };
}

function restoreBraceCodeCFMLTags(code, tags) {
	for (var i = 0; i < tags.length; i++) {
		code = code.split('__CFMLBRACETAG_' + i + '__').join(tags[i]);
	}
	return code;
}

function findCSSMarkupCommentEnd(code, start) {
	if (typeof findMarkupCommentEnd === 'function') {
		return findMarkupCommentEnd(code, start);
	}
	var marker = code.substr(start, 5) === '<!---' ? '--->' : '-->';
	var close = code.indexOf(marker, start + marker.length);
	return close === -1 ? -1 : close + marker.length;
}

function extractCSSStyleBodies(source) {
	var bodies = [];
	if (typeof source !== 'string') return bodies;
	replaceEmbeddedBlock(source, 'style', function(parentIndent, openTag, body, closeTag) {
		bodies.push(body);
		return parentIndent + openTag + body + closeTag;
	});
	return bodies;
}

function findCSSStringEnd(code, start) {
	var quote = code[start];
	for (var i = start + 1; i < code.length; i++) {
		if (code[i] === '\\') {
			if (code[i + 1] === '\r' && code[i + 2] === '\n') i += 2;
			else i++;
			continue;
		}
		if (code[i] === quote) return i + 1;
		if (code[i] === '\n' || code[i] === '\r') return -1;
	}
	return -1;
}

function findCSSHashExpressionEnd(code, start) {
	var quote = null;
	var parenDepth = 0;
	var braceDepth = 0;
	for (var i = start + 1; i < code.length; i++) {
		var char = code[i];
		if (quote) {
			if (char === quote) {
				if (code[i + 1] === quote) i++;
				else quote = null;
			}
			continue;
		}
		if (char === "'" || char === '"') {
			quote = char;
			continue;
		}
		if (char === '(') {
			parenDepth++;
			continue;
		}
		if (char === ')' && parenDepth > 0) {
			parenDepth--;
			continue;
		}
		if (char === '{') {
			braceDepth++;
			continue;
		}
		if (char === '}') {
			if (braceDepth === 0) return -1;
			braceDepth--;
			continue;
		}
		if (char === ';' && braceDepth === 0) return -1;
		if ((char === '\n' || char === '\r') && parenDepth === 0 && braceDepth === 0) return -1;
		if (char === '#' && code[i + 1] === '#') {
			i++;
			continue;
		}
		if (char === '#' && parenDepth === 0) return i + 1;
	}
	return -1;
}

function collectCSSProtectedSegments(code) {
	var segments = [];
	var i = 0;
	while (i < code.length) {
		var char = code[i];
		var next = code[i + 1];
		if (char === '\\') {
			var escapeEnd = i + (next === '\r' && code[i + 2] === '\n' ? 3 : 2);
			if (next === '\n' || next === '\r') {
				while (code[escapeEnd] === ' ' || code[escapeEnd] === '\t') escapeEnd++;
			}
			segments.push(code.slice(i, escapeEnd));
			i = escapeEnd;
			continue;
		}
		if (char === '/' && next === '*') {
			var blockEnd = code.indexOf('*/', i + 2);
			if (blockEnd === -1) return { safe: false, segments: segments };
			blockEnd += 2;
			segments.push(code.slice(i, blockEnd));
			i = blockEnd;
			continue;
		}
		if (char === '/' && next === '/' && (i === 0 || /[\s{;]/.test(code[i - 1]))) {
			var lineEnd = code.indexOf('\n', i + 2);
			if (lineEnd === -1) lineEnd = code.length;
			segments.push(code.slice(i, lineEnd));
			i = lineEnd;
			continue;
		}
		if (char === '<' && (code.substr(i, 5) === '<!---' || code.substr(i, 4) === '<!--')) {
			var markupEnd = findCSSMarkupCommentEnd(code, i);
			if (markupEnd === -1) return { safe: false, segments: segments };
			segments.push(code.slice(i, markupEnd));
			i = markupEnd;
			continue;
		}
		if (char === '<' && /^<\/?cf\w/i.test(code.slice(i))) {
			var tagClose = findCFMLTagClose(code.slice(i));
			if (tagClose === -1) return { safe: false, segments: segments };
			tagClose += i + 1;
			segments.push(code.slice(i, tagClose));
			i = tagClose;
			continue;
		}
		if (char === '"' || char === "'") {
			var stringEnd = findCSSStringEnd(code, i);
			if (stringEnd === -1) return { safe: false, segments: segments };
			segments.push(code.slice(i, stringEnd));
			i = stringEnd;
			continue;
		}
		if (char === '#' && next !== '#') {
			var hashEnd = findCSSHashExpressionEnd(code, i);
			if (hashEnd !== -1) {
				segments.push(code.slice(i, hashEnd));
				i = hashEnd;
				continue;
			}
		}
		i++;
	}
	return { safe: true, segments: segments };
}

function sameCSSProtectedSegments(left, right) {
	if (!left || !right || !left.safe || !right.safe) return false;
	if (left.segments.length !== right.segments.length) return false;
	for (var i = 0; i < left.segments.length; i++) {
		if (left.segments[i] !== right.segments[i]) return false;
	}
	return true;
}

function scanCSSRuleBoundaries(code) {
	var output = '';
	var i = 0;
	while (i < code.length) {
		var char = code[i];
		var next = code[i + 1];
		if (char === '\\') {
			var escapeLength = next === '\r' && code[i + 2] === '\n' ? 3 : 2;
			output += code.slice(i, i + escapeLength);
			i += escapeLength;
			continue;
		}
		if (char === '/' && next === '*') {
			var blockEnd = code.indexOf('*/', i + 2);
			if (blockEnd === -1) return { code: code, safe: false };
			blockEnd += 2;
			output += code.slice(i, blockEnd);
			i = blockEnd;
			continue;
		}
		if (char === '/' && next === '/' && (i === 0 || /[\s{;]/.test(code[i - 1]))) {
			var lineEnd = code.indexOf('\n', i + 2);
			if (lineEnd === -1) lineEnd = code.length;
			output += code.slice(i, lineEnd);
			i = lineEnd;
			continue;
		}
		if (char === '<' && (code.substr(i, 5) === '<!---' || code.substr(i, 4) === '<!--')) {
			var markupEnd = findCSSMarkupCommentEnd(code, i);
			if (markupEnd === -1) return { code: code, safe: false };
			output += code.slice(i, markupEnd);
			i = markupEnd;
			continue;
		}
		if (char === '<' && /^<\/?cf\w/i.test(code.slice(i))) {
			var tagClose = findCFMLTagClose(code.slice(i));
			if (tagClose === -1) return { code: code, safe: false };
			tagClose += i + 1;
			output += code.slice(i, tagClose);
			i = tagClose;
			continue;
		}
		if (char === '"' || char === "'") {
			var stringEnd = findCSSStringEnd(code, i);
			if (stringEnd === -1) return { code: code, safe: false };
			output += code.slice(i, stringEnd);
			i = stringEnd;
			continue;
		}
		if (char === '#' && next !== '#') {
			var hashEnd = findCSSHashExpressionEnd(code, i);
			if (hashEnd !== -1) {
				output += code.slice(i, hashEnd);
				i = hashEnd;
				continue;
			}
		}
		if (char === '}') {
			var lookahead = i + 1;
			while (lookahead < code.length && /\s/.test(code[lookahead])) lookahead++;
			output += '}';
			if (lookahead > i + 1 && lookahead < code.length) {
				var selectorStart = code[lookahead];
				if (/[.#A-Za-z_*\[]/.test(selectorStart)) {
					output += '\n';
					i = lookahead;
					continue;
				}
			} else if (lookahead === i + 1 && lookahead < code.length
					&& /[.#A-Za-z_*\[]/.test(code[lookahead])) {
				output += '\n';
				i = lookahead;
				continue;
			}
			i++;
			continue;
		}
		output += char;
		i++;
	}
	return { code: output, safe: true };
}

function cssLineMetadata(code) {
	var lines = [{ first: null, last: null, opaque: false }];
	var line = 0;
	var i = 0;

	/* Mark only physical lines after an opaque region's first newline. The
	 * opening line may still contain CSS code that should receive normal
	 * structural indentation; continuation lines must remain byte-for-byte
	 * relative to the embedded body so comment text is not trimmed. */
	function advanceOpaque(end, preserveContinuation) {
		while (i < end) {
			if (code[i] === '\n') {
				line++;
				lines[line] = { first: null, last: null, opaque: preserveContinuation && i + 1 < end };
			}
			i++;
		}
	}

	function addVisible(character) {
		if (/\s/.test(character)) return;
		if (!lines[line]) lines[line] = { first: null, last: null, opaque: false };
		if (lines[line].first === null) lines[line].first = character;
		lines[line].last = character;
	}

	while (i < code.length) {
		var char = code[i];
		var next = code[i + 1];
		if (char === '\\') {
			addVisible(char);
			advanceOpaque(Math.min(code.length, i + (next === '\r' && code[i + 2] === '\n' ? 3 : 2)), true);
			continue;
		}
		if (char === '/' && next === '*') {
			var blockEnd = code.indexOf('*/', i + 2);
			if (blockEnd !== -1) {
				advanceOpaque(blockEnd + 2, true);
				continue;
			}
		}
		if (char === '<' && (code.substr(i, 5) === '<!---' || code.substr(i, 4) === '<!--')) {
			var markupEnd = findCSSMarkupCommentEnd(code, i);
			if (markupEnd !== -1) {
				advanceOpaque(markupEnd, true);
				continue;
			}
		}
		if (char === '<' && /^<\/?cf\w/i.test(code.slice(i))) {
			var tagClose = findCFMLTagClose(code.slice(i));
			if (tagClose !== -1) {
				advanceOpaque(i + tagClose + 1, true);
				continue;
			}
		}
		if (char === '"' || char === "'") {
			var quoteEnd = findCSSStringEnd(code, i);
			if (quoteEnd === -1) {
				i = code.length;
				break;
			}
			var stringHasNewline = /[\r\n]/.test(code.slice(i, quoteEnd));
			advanceOpaque(quoteEnd, stringHasNewline);
			continue;
		}
		if (char === '#' && next !== '#') {
			var hashEnd = findCSSHashExpressionEnd(code, i);
			if (hashEnd !== -1) {
				advanceOpaque(hashEnd, /[\r\n]/.test(code.slice(i, hashEnd)));
				continue;
			}
		}
		if (char === '/' && next === '/' && (i === 0 || /[\s{;]/.test(code[i - 1]))) {
			var lineEnd = code.indexOf('\n', i + 2);
			if (lineEnd === -1) lineEnd = code.length;
			advanceOpaque(lineEnd);
			continue;
		}
		if (char === '\n') {
			line++;
			lines[line] = { first: null, last: null, opaque: false };
			i++;
			continue;
		}
		addVisible(char);
		i++;
	}
	return lines;
}

function formatCSSCode(code) {
	var scanned = scanCSSRuleBoundaries(code);
	if (!scanned.safe) return code;
	var normalized = scanned.code;
	var lines = normalized.split('\n');
	var metadata = cssLineMetadata(normalized);
	var output = [];
	var indentLevel = 0;

	for (var i = 0; i < lines.length; i++) {
		var lineStructure = metadata[i] || { first: null, last: null, opaque: false };
		if (lineStructure.first === '}') {
			indentLevel -= 1;
		}
		if (indentLevel < 0) {
			indentLevel = 0;
		}
		if (lineStructure.opaque) {
			output.push(lines[i]);
			if (lineStructure.last === '{') {
				indentLevel += 1;
			}
			continue;
		}
		var line = lines[i].trim();
		if (line == "") {
			continue;
		}

		output.push(''.padStart(indentLevel, '\t') + line);

		if (lineStructure.last === '{') {
			indentLevel += 1;
		}
	}

	return output.join('\n');
}

/* JS keywords that introduce an expression context — a `/` following
 * any of these is a regex literal, NOT a division operator. Used by
 * protectBraceCodeText's identifier-run handler to set lastSig back
 * to 'operator' so the regex masking branch fires correctly. */
var REGEX_CONTEXT_KEYWORDS = {
	'return':1,'typeof':1,'throw':1,'void':1,'delete':1,'new':1,
	'in':1,'of':1,'instanceof':1,'yield':1,'await':1,'case':1
};

function protectBraceCodeText(code) {
	var tokens = [];
	var output = "";
	var i = 0;
	var lastSig = null;

	while (i < code.length) {
		var char = code[i];
		var nextChar = code[i + 1];

		if (char == '/' && nextChar == '/') {
			var lineStart = i;
			i += 2;
			while (i < code.length && code[i] != '\n') {
				i++;
			}
			output += addBraceCodeToken(tokens, code.slice(lineStart, i));
			continue;
		}

		if (char == '/' && nextChar == '*') {
			var blockStart = i;
			i += 2;
			while (i < code.length && !(code[i] == '*' && code[i + 1] == '/')) {
				i++;
			}
			if (i < code.length) {
				i += 2;
			}
			output += addBraceCodeToken(tokens, code.slice(blockStart, i));
			continue;
		}

		/* CFML markup comment <!--- ... ---> and HTML comment <!-- ... -->.
		 * Legacy ColdFusion files often embed dated/tagged CFML comments
		 * MID-JS-BODY for change-tracking (e.g. `<!--- 20260429 [start]
		 * Reason: ... --->`). These pass through splitLeadingCommentBlock
		 * (which only strips comments at the file start) and reach
		 * formatBraceCode verbatim. Without protection, any `{` or `}`
		 * inside the comment text gets counted by the brace depth
		 * tracker, accumulating mismatch and producing flat-depth output
		 * for the entire JS body. Mask them as tokens so their content
		 * is opaque to depth tracking, and restore verbatim at the end.
		 *
		 * Exception: old script blocks commonly use an HTML-comment
		 * wrapper (`<!--` ... `//-->`) around executable JavaScript. It
		 * is a compatibility marker, not a real comment enclosing the JS;
		 * leave the two wrapper lines visible so braces and CFML tags in
		 * the body can still be formatted. */
		if (char == '<' && code.substr(i, 4) == '<!--') {
			var wrapperLineEnd = code.indexOf('\n', i);
			var wrapperLine = code.slice(i, wrapperLineEnd === -1 ? code.length : wrapperLineEnd).replace(/\r$/, '');
			var hasLegacyScriptClose = /(?:^|\r?\n)[ \t]*(?:\/\/-->|__BRACETOKEN_\d+__)\s*(?:\r?\n|$)/.test(code.slice(i));
			if (/^<!--[ \t]*$/.test(wrapperLine) && hasLegacyScriptClose) {
				output += '<!--';
				i += 4;
				continue;
			}
		}
		if (char == '<' && (code.substr(i, 5) == '<!---' || code.substr(i, 4) == '<!--')) {
			var markupStart = i;
			var markupEnd = findMarkupCommentEnd(code, i);
			if (markupEnd === -1) {
				/* Unterminated markup comment — mask the remainder so its
				 * braces/brackets cannot contaminate executable-code depth. */
				output += addBraceCodeToken(tokens, code.slice(markupStart));
				i = code.length;
				continue;
			}
			i = markupEnd;
			output += addBraceCodeToken(tokens, code.slice(markupStart, i));
			continue;
		}

		if (char == '/' && (lastSig == null || lastSig == 'operator')) {
			var regexStart = i;
			var scan = i + 1;
			var inClass = false;
			var closed = false;
			while (scan < code.length) {
				var rc = code[scan];
				if (rc == '\\') { scan += 2; continue; }
				if (rc == '\n') break;
				if (rc == '[') inClass = true;
				else if (rc == ']') inClass = false;
				else if (rc == '/' && !inClass) { scan++; closed = true; break; }
				scan++;
			}
			if (closed) {
				while (scan < code.length && /[gimsuy]/.test(code[scan])) {
					scan++;
				}
				output += addBraceCodeToken(tokens, code.slice(regexStart, scan));
				i = scan;
				lastSig = 'value';
				continue;
			}
		}

		if (char == "'" || char == '"') {
			var quote = char;
			var strStart = i;
			i++;
			while (i < code.length) {
				if (code[i] == '\\') { i += 2; continue; }
				if (code[i] == '\n') break;
				if (code[i] == quote) { i++; break; }
				i++;
			}
			output += addBraceCodeToken(tokens, code.slice(strStart, i));
			lastSig = 'value';
			continue;
		}

		if (char == '`') {
			var tmplStart = i;
			i++;
			var exprDepth = 0;
			while (i < code.length) {
				var tc = code[i];
				if (tc == '\\') { i += 2; continue; }
				if (tc == '$' && code[i + 1] == '{' && exprDepth == 0) {
					exprDepth++;
					i += 2;
					continue;
				}
				if (exprDepth > 0 && tc == '{') { exprDepth++; i++; continue; }
				if (exprDepth > 0 && tc == '}') { exprDepth--; i++; continue; }
				if (tc == '`' && exprDepth == 0) { i++; break; }
				i++;
			}
			output += addBraceCodeToken(tokens, code.slice(tmplStart, i));
			lastSig = 'value';
			continue;
		}

		if (/\s/.test(char)) {
			output += char;
			i++;
			continue;
		}

		// Numbers end an expression, so a following slash is division. Consume
		// decimals, exponents, radix literals and bigint suffixes as one value.
		if (/[0-9]/.test(char) || (char == '.' && /[0-9]/.test(nextChar || ''))) {
			var numberMatch = code.slice(i).match(/^(?:0[xX][\da-fA-F_]+n?|0[bB][01_]+n?|0[oO][0-7_]+n?|(?:\d[\d_]*(?:\.[\d_]*)?|\.[\d_]+)(?:[eE][+-]?[\d_]+)?n?)/);
			if (numberMatch) {
				output += numberMatch[0];
				i += numberMatch[0].length;
				lastSig = 'value';
				continue;
			}
		}

		/* Identifier / keyword run. Consume the full word so we can
		 * classify regex-context keywords (`return`, `typeof`, `throw`,
		 * `void`, `delete`, `in`, `of`, `new`, `yield`, `await`,
		 * `instanceof`, `case`) — they precede an EXPRESSION, so the
		 * next `/` must be a regex, not division. Without this, lines
		 * like `return /\b...{0,80}.../` get mis-classified as
		 * division, the regex isn't masked as a token, and the next
		 * `{` → `{\n` rewrite SHATTERS the regex literal across lines
		 * (real-world repro: ai_chatbox_js_runtime_send.cfm L26252,
		 * v7.1.2 production regression). */
		if (/[A-Za-z_$]/.test(char)) {
			var idStart = i;
			while (i < code.length && /[A-Za-z0-9_$]/.test(code[i])) i++;
			var word = code.slice(idStart, i);
			output += word;
			lastSig = REGEX_CONTEXT_KEYWORDS[word] ? 'operator' : 'value';
			continue;
		}

		if (char == ')' || char == ']') {
			lastSig = 'value';
		} else {
			lastSig = 'operator';
		}

		output += char;
		i++;
	}

	return {
		code: output,
		tokens: tokens
	};
}

function protectBraceCodeParens(code) {
	var tokens = [];
	var output = "";
	var i = 0;

	while (i < code.length) {
		var char = code[i];

		if (char == '(') {
			var start = i;
			var depth = 1;
			i++;
			while (i < code.length && depth > 0) {
				var c = code[i];
				if (c == '(') { depth++; i++; continue; }
				if (c == ')') { depth--; i++; continue; }
				i++;
			}
			output += addBraceCodeParenToken(tokens, code.slice(start, i));
			continue;
		}

		output += char;
		i++;
	}

	return {
		code: output,
		tokens: tokens
	};
}

function addBraceCodeParenToken(tokens, value) {
	var id = '__BRACEPAREN_' + tokens.length + '__';
	tokens.push(value);
	return id;
}

/* Restores `(...)` groups captured by protectBraceCodeParens.
 *
 * Single-line tokens: straight substring replace.
 *
 * Multi-line tokens (e.g. `(function(evt) { … })` spanning newlines from
 * the source): need re-indentation. The main format loop applied indent
 * to the line that holds the placeholder, but each subsequent line of
 * the token kept the SOURCE's original whitespace verbatim. When the
 * source had outer-wrap indent (every line +1 tab because the file was
 * a CFML include), the wrapper line got dedented to top level but the
 * paren-content body kept its old +1 → wrapper at indent 0 and body at
 * indent 2, off by one.
 *
 * Fix: walk the multi-line token's lines tracking brace depth from 0.
 * Line containing the placeholder ("host line") sits at baseIndent.
 * Each subsequent line gets baseIndent + (depth-tab) prefix, with its
 * original leading whitespace stripped. Closing-brace lines decrement
 * before applying prefix so `})` aligns with `(function() {`.
 *
 * Verified on sample/ai_chatbox_js_runtime_send.cfm L208-211 + L217-219
 * (commit ada7e54). */
function restoreBraceCodeParens(code, tokens) {
	for (var i = 0; i < tokens.length; i++) {
		var placeholder = '__BRACEPAREN_' + i + '__';
		var value = tokens[i];
		if (value.indexOf('\n') === -1) {
			code = code.split(placeholder).join(value);
			continue;
		}
		// Multi-line: each occurrence needs its own re-indent because
		// the placeholder's host-line indent may differ. Walk
		// occurrences in order, slicing as we go.
		var pieces = code.split(placeholder);
		var rebuilt = pieces[0];
		for (var k = 1; k < pieces.length; k++) {
			var hostLineStart = rebuilt.lastIndexOf('\n') + 1;
			var hostLinePrefix = rebuilt.slice(hostLineStart);
			var leadMatch = hostLinePrefix.match(/^(\t*)/);
			var baseIndent = leadMatch ? leadMatch[1] : '';
			rebuilt += reindentMultilineParenContent(value, baseIndent) + pieces[k];
		}
		code = rebuilt;
	}
	return code;
}

/* Re-indents the content of a multi-line paren token so its first line
 * sits inline with the placeholder and subsequent lines step in/out by
 * brace depth. Strips each subsequent line's existing leading
 * whitespace before applying the new prefix. */
function reindentMultilineParenContent(value, baseIndent) {
	var lines = value.split('\n');
	var depth = 0;
	var out = [];
	var blockStack = [{ baseDepth: 0, inCase: false }];
	var parenStack = [];
	function remainsOpenOnLine(line, index, open, close) {
		var nesting = 0;
		for (var pos = index; pos < line.length; pos++) {
			if (line[pos] === open) nesting++;
			else if (line[pos] === close && --nesting === 0) return false;
		}
		return true;
	}
	for (var k = 0; k < lines.length; k++) {
		var trimmed = lines[k].replace(/^[ \t]+/, '');
		var lineDepth = depth;
		var top = blockStack[blockStack.length - 1] || { baseDepth: 0, inCase: false };
		var isCase = /^(?:case\b[^:]+|default)\s*:/.test(trimmed);

		// Lines that start with a closer pre-decrement (so `})` aligns
		// with its opener).
		var startCloser = /^[\]})]/.test(trimmed);
		if (startCloser) {
			if (trimmed.charAt(0) === '}' && top.inCase) {
				lineDepth = top.baseDepth - 1;
			} else {
				lineDepth--;
			}
		} else if (isCase) {
			lineDepth = top.baseDepth;
		}
		if (lineDepth < 0) lineDepth = 0;
		var prefix;
		if (k === 0) {
			// Host line — placeholder already had `baseIndent` rendered
			// by the main loop. Emit content verbatim (no prefix here).
			prefix = '';
		} else {
			prefix = baseIndent + repeatTab(lineDepth);
		}
		out.push(prefix + trimmed);

		if (isCase) {
			depth = top.baseDepth + 1;
			top.inCase = true;
		}

		// Update depth from this line's outer characters. The line's
		// content may still contain protected __BRACETOKEN_N__ /
		// __BRACEPAREN_N__ placeholders — they look like
		// `__BRACETOKEN_0__` with no braces, so counting `{` `[` `}` `]`
		// on the visible chars is safe.
		var startIdx = 0;
		if (k === 0 && trimmed.charAt(0) === '(') {
			startIdx = 1;
		}
		for (var ci = startIdx; ci < trimmed.length; ci++) {
			var c = trimmed[ci];
			if (c === '{' || c === '[') {
				// A multiline block beginning on a call's opening line shares
				// its visual level; an inline object or index does not.
				if (remainsOpenOnLine(trimmed, ci, c, c === '{' ? '}' : ']')) {
					for (var pi = parenStack.length - 1; pi >= 0 && parenStack[pi].line === k; pi--) {
						if (parenStack[pi].indents) {
							parenStack[pi].indents = false;
							depth--;
						}
					}
				}
				depth++;
				blockStack.push({ baseDepth: depth, inCase: false });
			} else if (c === '(') {
				parenStack.push({ line: k, indents: true });
				depth++;
			} else if (c === '}' || c === ']') {
				depth--;
				if (blockStack.length > 1) {
					var popped = blockStack.pop();
					if (popped.inCase) depth = popped.baseDepth - 1;
				}
			} else if (c === ')') {
				if (parenStack.length > 0) {
					if (parenStack.pop().indents) depth--;
				} else if (k === lines.length - 1 && ci === trimmed.length - 1 && depth === 0) {
					// outer closing paren of the token
				} else {
					depth--;
				}
			}
		}
		if (depth < 0) depth = 0;
	}
	return out.join('\n');
}

function addBraceCodeToken(tokens, value) {
	var id = '__BRACETOKEN_' + tokens.length + '__';
	tokens.push(value);
	return id;
}

/* Restores text tokens captured by protectBraceCodeText.
 *
 * Single-line tokens (line comments, single-line block comments, regex,
 * single-line strings): straight substring replace.
 *
 * Multi-line BLOCK COMMENTS only: re-indent continuation lines so they
 * align under the placeholder's host-line baseIndent. Strip the source's
 * outer-wrap indent (longest common leading TAB sequence across
 * continuation lines — tabs are structural, spaces are visual alignment
 * to `/* ` so they stay).
 *
 * Multi-line TEMPLATE LITERALS and REGEX: NEVER modify content (string
 * characters are syntactically significant). Restored verbatim even if
 * mis-aligned in output — fixing those requires content-aware logic
 * that's out of scope here.
 *
 * Real-world repro: sample/ai_chatbox_js_runtime_send.cfm L14-16 — file-
 * header block comment kept its source `\t` prefix after the surrounding
 * code got dedented to top-level. Same bug class as the paren-token
 * restore fix in commit 9156ba7 — multi-line tokens need indent
 * reconstruction from output context, not from source. */
function restoreBraceCodeText(code, tokens) {
	for (var i = 0; i < tokens.length; i++) {
		var placeholder = '__BRACETOKEN_' + i + '__';
		var value = tokens[i];
		if (value.indexOf('\n') === -1) {
			code = code.split(placeholder).join(value);
			continue;
		}
		// Multi-line markup comments are opaque, but their continuation
		// prefixes must be rebased to the placeholder's host line. Otherwise
		// cleanEmbeddedBody's removed common prefix is restored as extra
		// indentation on every later pass. Template literals and regex
		// content remain byte-significant and are restored verbatim.
		if (value.indexOf('<!---') === 0 || value.indexOf('<!--') === 0) {
			var markupPieces = code.split(placeholder);
			var markupRebuilt = markupPieces[0];
			for (var mk = 1; mk < markupPieces.length; mk++) {
				var markupHostStart = markupRebuilt.lastIndexOf('\n') + 1;
				var markupHostPrefix = markupRebuilt.slice(markupHostStart).match(/^[\t]*/);
				var markupBaseIndent = markupHostPrefix ? markupHostPrefix[0] : '';
				markupRebuilt += reindentMultilineMarkupComment(value, markupBaseIndent) + markupPieces[mk];
			}
			code = markupRebuilt;
			continue;
		}
		if (value.charAt(0) !== '/' || value.charAt(1) !== '*') {
			code = code.split(placeholder).join(value);
			continue;
		}
		var pieces = code.split(placeholder);
		var rebuilt = pieces[0];
		for (var k = 1; k < pieces.length; k++) {
			var hostLineStart = rebuilt.lastIndexOf('\n') + 1;
			var leadMatch = rebuilt.slice(hostLineStart).match(/^(\t*)/);
			var baseIndent = leadMatch ? leadMatch[1] : '';
			rebuilt += reindentMultilineBlockComment(value, baseIndent) + pieces[k];
		}
		code = rebuilt;
	}
	return code;
}

/* Re-indents the continuation lines of a multi-line block comment.
 * Line 0 stays inline with the placeholder (the main loop already
 * rendered baseIndent before it). Continuation lines lose their
 * source outer-wrap (longest common leading TAB prefix — tabs are
 * structural indent, while spaces typically align text visually under
 * `/* ` and must be preserved). Then prefixed with baseIndent.
 *
 * For example, source:
 *     \t/* Header
 *     \t   Continuation A
 *     \t   Continuation B *<slash>
 * Captured token (lines):
 *     /* Header
 *     \t   Continuation A
 *     \t   Continuation B *<slash>
 * Common leading tabs across continuations: `\t`. Strip → leaves
 * `   Continuation A`, `   Continuation B *<slash>`. Prepend
 * baseIndent (which is whatever the main loop applied to host line).
 * Result if baseIndent is empty:
 *     /* Header
 *        Continuation A
 *        Continuation B *<slash> */
function reindentMultilineMarkupComment(value, baseIndent) {
	var lines = value.split('\n');
	if (lines.length < 2) return value;
	var commonPrefix = null;
	for (var i = 1; i < lines.length; i++) {
		if (lines[i].replace(/[ \t]/g, '') === '') continue;
		var prefix = (lines[i].match(/^[ \t]*/) || [''])[0];
		if (commonPrefix === null) {
			commonPrefix = prefix;
			continue;
		}
		var commonLength = 0;
		while (commonLength < commonPrefix.length
				&& commonLength < prefix.length
				&& commonPrefix[commonLength] === prefix[commonLength]) {
			commonLength++;
		}
		commonPrefix = commonPrefix.slice(0, commonLength);
	}
	if (commonPrefix === null) commonPrefix = '';
	var output = [lines[0]];
	for (var j = 1; j < lines.length; j++) {
		var continuation = lines[j];
		if (commonPrefix !== '' && continuation.indexOf(commonPrefix) === 0) {
			continuation = continuation.slice(commonPrefix.length);
		}
		output.push(baseIndent + continuation);
	}
	return output.join('\n');
}

function reindentMultilineBlockComment(value, baseIndent) {
	var lines = value.split('\n');
	if (lines.length < 2) return value;
	// Find longest common leading TAB sequence across continuation lines
	// (skip blank lines). Tabs only — spaces preserve text alignment.
	var sourceTabs = null;
	for (var k = 1; k < lines.length; k++) {
		var line = lines[k];
		if (line.replace(/[ \t]/g, '') === '') continue;  // blank
		var lt = line.match(/^\t*/)[0];
		if (sourceTabs === null || lt.length < sourceTabs.length) {
			sourceTabs = lt;
		}
	}
	if (sourceTabs === null || sourceTabs === '') return value;
	var out = [lines[0]];
	for (var j = 1; j < lines.length; j++) {
		var ln = lines[j];
		if (ln.indexOf(sourceTabs) === 0) {
			out.push(baseIndent + ln.slice(sourceTabs.length));
		} else {
			out.push(ln);
		}
	}
	return out.join('\n');
}
