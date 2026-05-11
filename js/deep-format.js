function bodyHasStructuralCFMLControlFlow(body) {
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

function protectExpressionStrings(text) {
	var tokens = [];
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
			output += '__CFEXPSTR_' + (tokens.length - 1) + '__';
		} else {
			output += c;
			i++;
		}
	}
	return { code: output, tokens: tokens };
}

function restoreProtectedExpressionStrings(text, tokens) {
	for (var i = 0; i < tokens.length; i++) {
		text = text.split('__CFEXPSTR_' + i + '__').join(tokens[i]);
	}
	return text;
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
	return restoreProtectedExpressionStrings(transformed, protectedExpr.tokens);
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
			var valStart = i;
			while (i < content.length && !/\s/.test(content[i])) i++;
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
		// CFML markup comment — preserve verbatim
		if (char === '<' && text.slice(i, i + 5) === '<!---') {
			var start = i;
			var end = text.indexOf('--->', i + 5);
			if (end === -1) end = text.length;
			else end += 4;
			output += text.slice(start, end);
			i = end;
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
	var openIdx = -1;
	var closeIdx = -1;
	var depth = 0;
	var openP = /^<(?:cfif|cfloop|cfswitch)\b[^>]*>$/i;
	var closeP = /^<\/(?:cfif|cfloop|cfswitch)>$/i;
	for (var i = 0; i < lines.length; i++) {
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

function detectAllLeavesStartWithWhere(treeLines) {
	var structural = /^<\/?(?:cfif|cfelseif|cfelse|cfloop|cfswitch|cfcase|cfdefaultcase)\b[^>]*>$/i;
	var seenLeaf = false;
	for (var i = 0; i < treeLines.length; i++) {
		var t = treeLines[i].trim();
		if (t === '' || structural.test(t)) continue;
		if (!/^where\b/i.test(t)) return false;
		seenLeaf = true;
	}
	return seenLeaf;
}

function stripWhereFromLeaves(treeLines) {
	var structural = /^<\/?(?:cfif|cfelseif|cfelse|cfloop|cfswitch|cfcase|cfdefaultcase)\b[^>]*>$/i;
	return treeLines.map(function(line) {
		var t = line.trim();
		if (t === '' || structural.test(t)) return line;
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
	for (var i = 0; i < treeLines.length; i++) {
		var trimmed = treeLines[i].trim();
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
					console.warn('[deep-format] Phase 3 tree-body normalization failed on line, keeping verbatim. Error:', e && e.message);
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
	var markers = [];
	var processed = [];
	var pattern = /^<\/?(?:cfif|cfelseif|cfelse|cfloop|cfswitch|cfcase|cfdefaultcase)\b[^>]*>$/i;
	for (var i = 0; i < lines.length; i++) {
		var trimmed = lines[i].trim();
		if (pattern.test(trimmed)) {
			var idx = markers.length;
			markers.push({ tag: trimmed, kind: classifyStructuralCFMLTag(trimmed) });
			processed.push('__cfm_' + idx + '__,');
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
	var markerLine = /^(\s*)__cfm_(\d+)__,?\s*$/;

	for (var i = 0; i < lines.length; i++) {
		var line = lines[i];
		var match = line.match(markerLine);
		if (match) {
			var indent = match[1];
			var idx = parseInt(match[2], 10);
			if (idx < 0 || idx >= markers.length) return null;
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
				console.warn('[deep-format] Phase 2 CFML normalization failed, leaving text unchanged. Error:', err && err.message);
			}
			return text;
		}
	}

	if (doSql) {
		out = replaceEmbeddedBlock(out, 'cfquery', function(parentIndent, openTag, body, closeTag) {
			var currentIndex = cfqueryIndex++;

			// Structural CFML control flow inside <cfquery> is incompatible
			// with SQL formatters that normalize whitespace around tokens.
			// Use the ORIGINAL (pre-beautifyCFML) body verbatim — only adjust
			// the leading common whitespace to match the new parent depth.
			// This preserves the user's hand-crafted relative indent for
			// multi-line subqueries and inline CFML comments, which the
			// outer beautifyCFML pass would otherwise flatten.
			if (bodyHasStructuralCFMLControlFlow(body)) {
				var verbatimSource = (originalBodies[currentIndex] !== undefined)
					? originalBodies[currentIndex]
					: body;

				// Tier 1 — Marker-injection: when Pro SQL is enabled, replace
				// own-line CFML control-flow tags with column-friendly markers,
				// run sql-formatter, then restore. Produces full SQL re-format
				// (uppercase keywords, list-broken columns) WITH cfif structure
				// preserved AND body indented +1 inside cfif. Falls through
				// to verbatim if marker round-trip can't be verified.
				if (bodyHasUserIndent(verbatimSource)
						&& sqlPro
						&& typeof formatProSQLSync === 'function'
						&& typeof isProSQLLoaded === 'function'
						&& isProSQLLoaded()) {
					try {
						var verbatimCleanedForMarker = cleanEmbeddedBody(verbatimSource);
						if (verbatimCleanedForMarker !== '') {
							var marked = protectStructuralCFMLAsColumnMarkers(verbatimCleanedForMarker);
							var protectedSQLM = protectCFMLTokens(marked.code);
							var formattedSQLM = formatProSQLSync(protectedSQLM.code, sqlDialect);
							var restoredCFMLM = restoreCFMLTokens(formattedSQLM, protectedSQLM.tokens);
							restoredCFMLM = cleanRestoredCFMLTokenSpacing(restoredCFMLM);
							var markerRestored = restoreStructuralCFMLMarkers(restoredCFMLM, marked.markers);
							if (markerRestored !== null) {
								return maybeNormalizeCFMLTags(
									parentIndent + openTag + '\n'
									+ indentEmbeddedBody(markerRestored, parentIndent) + '\n'
									+ parentIndent + closeTag
								);
							}
						}
					} catch (markerErr) {
						// Marker approach threw — fall through to verbatim
						if (typeof console !== 'undefined' && console.warn) {
							console.warn('[deep-format] Tier 1 marker injection failed (cfquery #' + currentIndex + '), falling back to next tier. Error:', markerErr && markerErr.message, '\nDialect:', sqlDialect, '\nSQL excerpt:', String(verbatimSource).slice(0, 300));
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
						&& sqlPro
						&& typeof formatProSQLSync === 'function'
						&& typeof isProSQLLoaded === 'function'
						&& isProSQLLoaded()) {
					try {
						var cleanedForHoist = cleanEmbeddedBody(verbatimSource);
						var split = splitCfqueryBodyAtCfifTree(cleanedForHoist);
						if (split && detectAllLeavesStartWithWhere(split.treeLines)) {
							var strippedTree = stripWhereFromLeaves(split.treeLines);
							var preTrimmed = split.pre.replace(/\s+$/, '');
							var preToFormat = preTrimmed + (preTrimmed ? '\n' : '') + 'where';
							var protectedPre = protectCFMLTokens(preToFormat);
							var formattedPre = formatProSQLSync(protectedPre.code, sqlDialect);
							var restoredPre = restoreCFMLTokens(formattedPre, protectedPre.tokens);
							restoredPre = cleanRestoredCFMLTokenSpacing(restoredPre);
							restoredPre = restoredPre.replace(/\s+$/, '');

							var treeFormatted = formatStrippedTree(strippedTree);

							var postTrimmed = split.post.trim();
							var formattedPost = '';
							if (postTrimmed !== '') {
								try {
									var postProt = protectCFMLTokens(postTrimmed);
									var postUppered = uppercaseSQLKeywordsInProtected(postProt.code);
									var postSpaced = normalizeSQLEqualsSpacing(postUppered);
									formattedPost = restoreCFMLTokens(postSpaced, postProt.tokens);
									formattedPost = '\t' + formattedPost.replace(/\n/g, '\n\t');
								} catch (postErr) {
									formattedPost = '\t' + postTrimmed;
									if (typeof console !== 'undefined' && console.warn) {
										console.warn('[deep-format] Phase 3 post-cfif clause uppercase failed (cfquery #' + currentIndex + '), keeping verbatim. Error:', postErr && postErr.message);
									}
								}
							}

							var assembled = restoredPre + '\n' + treeFormatted;
							if (formattedPost !== '') {
								assembled += '\n' + formattedPost;
							}

							return maybeNormalizeCFMLTags(
								parentIndent + openTag + '\n'
								+ indentEmbeddedBody(assembled, parentIndent) + '\n'
								+ parentIndent + closeTag
							);
						}
					} catch (hoistErr) {
						// Phase 3 failed — fall through to Tier 2
						if (typeof console !== 'undefined' && console.warn) {
							console.warn('[deep-format] Phase 3 WHERE hoisting failed (cfquery #' + currentIndex + '), falling back to Tier 2 verbatim. Error:', hoistErr && hoistErr.message, '\nDialect:', sqlDialect);
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
						var verbatimFinal = verbatimCleaned;
						if (sqlPro) {
							try {
								var protectedV = protectCFMLTokens(verbatimCleaned);
								var upperedV = uppercaseSQLKeywordsInProtected(protectedV.code);
								verbatimFinal = restoreCFMLTokens(upperedV, protectedV.tokens);
							} catch (upperErr) {
								verbatimFinal = verbatimCleaned;
								if (typeof console !== 'undefined' && console.warn) {
									console.warn('[deep-format] Tier 2 keyword uppercase failed (cfquery #' + currentIndex + '), leaving body verbatim. Error:', upperErr && upperErr.message);
								}
							}
						}
						return maybeNormalizeCFMLTags(
							parentIndent + openTag + '\n'
							+ indentEmbeddedBody(verbatimFinal, parentIndent) + '\n'
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
						console.warn('[deep-format] Pro SQL formatter threw on cfquery #' + currentIndex + ', falling back to built-in beautifySQL. This is why your output lacks list-break / cfqueryparam lowercasing. Error:', err && err.message, '\nDialect:', sqlDialect, '\nProtected SQL excerpt:', protectedSQL.code.slice(0, 400));
					}
					formattedSQL = beautifySQL(protectedSQL.code);
				}
			} else {
				if (sqlPro && typeof console !== 'undefined' && console.warn) {
					console.warn('[deep-format] Pro SQL checkbox is ON but engine not ready (cfquery #' + currentIndex + '), falling back to built-in beautifySQL. isProSQLLoaded():', (typeof isProSQLLoaded === 'function' && isProSQLLoaded()), 'formatProSQLSync:', typeof formatProSQLSync);
				}
				formattedSQL = beautifySQL(protectedSQL.code);
			}
			var restoredSQL = restoreCFMLTokens(formattedSQL, protectedSQL.tokens);
			restoredSQL = cleanRestoredCFMLTokenSpacing(restoredSQL);

			return maybeNormalizeCFMLTags(parentIndent + openTag + '\n' + indentEmbeddedBody(restoredSQL, parentIndent) + '\n' + parentIndent + closeTag);
		});
	}

	if (doJs) {
		out = replaceEmbeddedBlock(out, 'script', function(parentIndent, openTag, body, closeTag) {
			if (!shouldFormatScript(openTag) || body.trim() == "") {
				return parentIndent + openTag + body + closeTag;
			}

			var formattedJS = formatBraceCode(cleanEmbeddedBody(body), false);
			return parentIndent + openTag + '\n' + indentEmbeddedBody(formattedJS, parentIndent) + '\n' + parentIndent + closeTag;
		});
	}

	if (doCss) {
		out = replaceEmbeddedBlock(out, 'style', function(parentIndent, openTag, body, closeTag) {
			if (body.trim() == "") {
				return parentIndent + openTag + body + closeTag;
			}

			var formattedCSS = formatCSSCode(cleanEmbeddedBody(body));
			return parentIndent + openTag + '\n' + indentEmbeddedBody(formattedCSS, parentIndent) + '\n' + parentIndent + closeTag;
		});
	}

	return out;
}

function replaceEmbeddedBlock(code, tagName, formatter) {
	var output = "";
	var index = 0;
	var openRegex = new RegExp('<' + tagName + '\\b[^>]*>', 'gi');

	while (true) {
		var openStart = -1;
		var openEnd = -1;
		var openMatch = null;
		openRegex.lastIndex = index;
		while (true) {
			var candidate = openRegex.exec(code);
			if (!candidate) break;
			if (isInsideCommentOrString(code, candidate.index)) {
				continue;
			}
			openMatch = candidate;
			openStart = candidate.index;
			openEnd = openRegex.lastIndex;
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
		var closeStart = findClosingTagOutsideText(code, tagName, contentStart);

		output += code.slice(index, blockStart);
		if (closeStart == -1) {
			output += code.slice(blockStart);
			break;
		}

		var closeEnd = closeStart + tagName.length + 3;
		output += formatter(parentIndent, openMatch[0], code.slice(contentStart, closeStart), code.slice(closeStart, closeEnd));
		index = closeEnd;
	}

	return output;
}

function isInsideCommentOrString(code, pos) {
	var quote = "";
	var inLine = false;
	var inBlock = false;
	var inMarkup = false;
	for (var i = 0; i < pos; i++) {
		var c = code[i];
		var n = code[i + 1];
		if (inLine) {
			if (c == '\n') inLine = false;
			continue;
		}
		if (inBlock) {
			if (c == '*' && n == '/') { inBlock = false; i++; }
			continue;
		}
		if (inMarkup) {
			if (c == '-' && n == '-' && code[i + 2] == '-' && code[i + 3] == '>') { inMarkup = false; i += 3; }
			continue;
		}
		if (quote != "") {
			// CFML / HTML strings do NOT use backslash escapes — `\` is a literal
			// character. Treating `\"` as an escape (C/JS-style) would swallow the
			// closing quote of strings like
			//   "..\..\..\#mainstorefld#\contentstore\#cookie.cookcfnunique#\"
			// and leave parser parity off-by-one for the rest of the file, which
			// silently skips every subsequent <cfquery> as "inside a string".
			if (c == quote) {
				// SQL standard escape: doubled quote = literal quote inside string.
				// Without this, a body containing 'it''s OK' would close the string
				// at the second `'` and re-open at the third, leaving the parity
				// flipped for the rest of the file — and subsequent cfqueries
				// would be wrongly judged "inside a string" and skipped entirely.
				if ((c == "'" || c == '"') && n == c) { i++; continue; }
				quote = "";
			}
			continue;
		}
		if (c == '/' && n == '/') { inLine = true; i++; continue; }
		if (c == '/' && n == '*') { inBlock = true; i++; continue; }
		if (c == '<' && n == '!' && code[i + 2] == '-' && code[i + 3] == '-' && code[i + 4] == '-') { inMarkup = true; i += 4; continue; }
		if (c == '"' || c == "'" || c == '`') { quote = c; continue; }
	}
	return inLine || inBlock || inMarkup || quote != "";
}

function findClosingTagOutsideText(code, tagName, startIndex) {
	var closeTag = '</' + tagName + '>';
	var lowerCode = code.toLowerCase();
	var quote = "";
	var inLineComment = false;
	var inBlockComment = false;

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
			// CFML / HTML strings do NOT use backslash escapes (`\` is literal).
			// Mirrors the same fix in isInsideCommentOrString — see comment there.
			if (char == quote) {
				if ((quote == "'" || quote == '"') && nextChar == quote) {
					i++;
					continue;
				}
				quote = "";
			}
			continue;
		}

		if (char == '-' && nextChar == '-') {
			inLineComment = true;
			i++;
			continue;
		}
		if (char == '/' && nextChar == '/') {
			inLineComment = true;
			i++;
			continue;
		}
		if (char == '/' && nextChar == '*') {
			inBlockComment = true;
			i++;
			continue;
		}
		if (char == "'" || char == '"' || char == '`') {
			quote = char;
			continue;
		}
		if (lowerCode.slice(i, i + closeTag.length) == closeTag) {
			return i;
		}
	}

	return -1;
}

function protectCFMLTokens(sqlBody) {
	var tokens = [];
	var code = "";
	var i = 0;

	function addToken(value) {
		var id = '__CFTOKEN_' + tokens.length + '__';
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
		var tokenMatch = rest.match(/^(<!---[\s\S]*?--->|<cfqueryparam\b[^>]*\/?>|<\/?cf\w+\b[^>]*>|##|#(?:##|[^#])+#)/i);
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
	for (var i = 0; i < tokens.length; i++) {
		code = code.split('__CFTOKEN_' + i + '__').join(tokens[i]);
	}
	return code;
}

function cleanRestoredCFMLTokenSpacing(code) {
	return code
		.replace(/\s+(<\/cf\w+\b[^>]*>)/gi, '$1')
		.replace(/(<\/?cf\w+\b[^>]*>)(and|or)\s*\(/gi, function(match, cfTag, operator) {
			return cfTag + operator.toUpperCase() + ' (';
		});
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

function cleanEmbeddedBody(body) {
	var lines = body.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

	while (lines.length > 0 && lines[0].trim() == "") {
		lines.shift();
	}
	while (lines.length > 0 && lines[lines.length - 1].trim() == "") {
		lines.pop();
	}

	var minIndent = null;
	for (var i = 0; i < lines.length; i++) {
		if (lines[i].trim() == "") {
			continue;
		}
		var indentMatch = lines[i].match(/^[ \t]*/);
		var indentLength = indentMatch ? indentMatch[0].length : 0;
		if (minIndent == null || indentLength < minIndent) {
			minIndent = indentLength;
		}
	}

	if (minIndent && minIndent > 0) {
		for (var j = 0; j < lines.length; j++) {
			lines[j] = lines[j].slice(minIndent);
		}
	}

	return lines.join('\n').trim();
}

function indentEmbeddedBody(body, parentIndent) {
	return body.split('\n').map(function(line) {
		if (line.trim() == "") {
			return "";
		}
		return parentIndent + '\t' + line;
	}).join('\n');
}

function formatBraceCode(code, splitAdjacentBlocks) {
	var protectedText = protectBraceCodeText(code);
	var protectedParens = protectBraceCodeParens(protectedText.code);
	var normalized = protectedParens.code;

	if (splitAdjacentBlocks == true) {
		normalized = normalized.replace(/}\s*(?=[.#A-Za-z_*[])/g, '}\n');
	}

	normalized = normalized
		.replace(/{/g, '{\n')
		.replace(/}/g, '\n}')
		.replace(/;\s*/g, ';\n');

	var lines = normalized.split('\n');
	var output = [];
	var indentLevel = 0;

	for (var i = 0; i < lines.length; i++) {
		var line = lines[i].trim();
		if (line == "") {
			continue;
		}

		if (indentLevel < 0) {
			indentLevel = 0;
		}

		if (line.startsWith("}") || line.startsWith("]")) {
			indentLevel -= 1;
		}

		if (indentLevel < 0) {
			indentLevel = 0;
		}

		output.push(''.padStart(indentLevel, '\t') + line);

		if (line.endsWith("{") || line.endsWith("[")) {
			indentLevel += 1;
		}
	}

	var joined = output.join('\n');
	joined = restoreBraceCodeParens(joined, protectedParens.tokens);
	return restoreBraceCodeText(joined, protectedText.tokens);
}

function formatCSSCode(code) {
	var normalized = code.replace(/}\s*(?=[.#A-Za-z_*[])/g, '}\n');
	var lines = normalized.split('\n');
	var output = [];
	var indentLevel = 0;

	for (var i = 0; i < lines.length; i++) {
		var line = lines[i].trim();
		if (line == "") {
			continue;
		}

		if (indentLevel < 0) {
			indentLevel = 0;
		}
		if (line.startsWith("}")) {
			indentLevel -= 1;
		}
		if (indentLevel < 0) {
			indentLevel = 0;
		}

		output.push(''.padStart(indentLevel, '\t') + line);

		if (line.endsWith("{")) {
			indentLevel += 1;
		}
	}

	return output.join('\n');
}

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

		if (char == ')' || char == ']' || /[A-Za-z0-9_$]/.test(char)) {
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

function restoreBraceCodeParens(code, tokens) {
	for (var i = 0; i < tokens.length; i++) {
		code = code.split('__BRACEPAREN_' + i + '__').join(tokens[i]);
	}
	return code;
}

function addBraceCodeToken(tokens, value) {
	var id = '__BRACETOKEN_' + tokens.length + '__';
	tokens.push(value);
	return id;
}

function restoreBraceCodeText(code, tokens) {
	for (var i = 0; i < tokens.length; i++) {
		code = code.split('__BRACETOKEN_' + i + '__').join(tokens[i]);
	}
	return code;
}
