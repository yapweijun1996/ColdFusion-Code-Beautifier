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
				// Only preserve original verbatim when the user typed
				// hand-crafted indent. Flat-zero-indent input falls back
				// to beautifyCFML's nested output, which auto-derives
				// cfif depth and avoids leaving the cfif chain glued
				// to the cfquery's left margin.
				if (bodyHasUserIndent(verbatimSource)) {
					var verbatimCleaned = cleanEmbeddedBody(verbatimSource);
					if (verbatimCleaned !== '') {
						return parentIndent + openTag + '\n'
							+ indentEmbeddedBody(verbatimCleaned, parentIndent) + '\n'
							+ parentIndent + closeTag;
					}
				}
				return parentIndent + openTag + body + closeTag;
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
					formattedSQL = beautifySQL(protectedSQL.code);
				}
			} else {
				formattedSQL = beautifySQL(protectedSQL.code);
			}
			var restoredSQL = restoreCFMLTokens(formattedSQL, protectedSQL.tokens);
			restoredSQL = cleanRestoredCFMLTokenSpacing(restoredSQL);

			return parentIndent + openTag + '\n' + indentEmbeddedBody(restoredSQL, parentIndent) + '\n' + parentIndent + closeTag;
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
			if (c == '\\') { i++; continue; }
			if (c == quote) quote = "";
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
			if (char == '\\') {
				i++;
				continue;
			}
			if (char == quote) {
				if (quote == "'" && nextChar == "'") {
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
