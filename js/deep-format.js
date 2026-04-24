function deepFormatEmbedded(cfmlCode) {
	var out = cfmlCode;
	
	out = out.replace(/([ \t]*)(<cfquery\b[^>]*>)([\s\S]*?)(<\/cfquery>)/gi, function(match, parentIndent, openTag, body, closeTag) {
		var protectedSQL = protectCFMLTokens(cleanEmbeddedBody(body));
		var formattedSQL = beautifySQL(protectedSQL.code);
		var restoredSQL = restoreCFMLTokens(formattedSQL, protectedSQL.tokens);
		restoredSQL = cleanRestoredCFMLTokenSpacing(restoredSQL);
		
		return parentIndent + openTag + '\n' + indentEmbeddedBody(restoredSQL, parentIndent) + '\n' + parentIndent + closeTag;
	});
	
	out = out.replace(/([ \t]*)(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi, function(match, parentIndent, openTag, body, closeTag) {
		if (!shouldFormatScript(openTag) || body.trim() == "") {
			return match;
		}
		
		var formattedJS = formatBraceCode(cleanEmbeddedBody(body), false);
		return parentIndent + openTag + '\n' + indentEmbeddedBody(formattedJS, parentIndent) + '\n' + parentIndent + closeTag;
	});
	
	out = out.replace(/([ \t]*)(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, function(match, parentIndent, openTag, body, closeTag) {
		if (body.trim() == "") {
			return match;
		}
		
		var formattedCSS = formatCSSCode(cleanEmbeddedBody(body));
		return parentIndent + openTag + '\n' + indentEmbeddedBody(formattedCSS, parentIndent) + '\n' + parentIndent + closeTag;
	});
	
	return out;
}

function protectCFMLTokens(sqlBody) {
	var tokens = [];
	var code = sqlBody.replace(/<cfqueryparam\b[^>]*\/?>|<\/?cf\w+\b[^>]*>|#[^#]+#/gi, function(match) {
		var id = '__CFTOKEN_' + tokens.length + '__';
		tokens.push(match);
		return id;
	});
	
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
	return code.replace(/\s+(<\/cf\w+\b[^>]*>)/gi, '$1');
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
	var normalized = code;
	
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
	
	return output.join('\n');
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
