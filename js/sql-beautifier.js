function beautifySQL(sql) {
	var tokens = tokenizeSQL(sql);
	var lines = [];
	var line = "";
	var parenIndent = 0;
	var parenStack = [];
	var lastToken = null;
	
	// Known limitations: complex procedures/triggers with BEGIN...END and multiple CTE chains may need manual cleanup.
	// Strings, quoted identifiers, and comments are preserved as tokens so SQL keywords inside them are not reformatted.
	function indent() {
		return ''.padStart(parenIndent, '\t');
	}
	
	function flushLine() {
		if (line.trim() != "") {
			lines.push(line.replace(/\s+$/g, ''));
		}
		line = indent();
		lastToken = null;
	}
	
	function currentText(token) {
		if (token.type == 'word') {
			var upperValue = token.value.toUpperCase();
			if (SQL_UPPERCASE_KEYWORDS.includes(upperValue)) {
				return upperValue;
			}
		}
		return token.value;
	}
	
	function appendText(text, token) {
		if (line == "") {
			line = indent();
		}
		if (needsSpaceBefore(text, token, lastToken, line)) {
			line += " ";
		}
		line += text;
		lastToken = {
			value: text,
			type: token.type
		};
	}
	
	function startsSubquery(index) {
		var nextIndex = getNextContentIndex(tokens, index + 1);
		if (nextIndex == -1) {
			return false;
		}
		return tokens[nextIndex].type == 'word' && ['SELECT', 'WITH'].includes(tokens[nextIndex].value.toUpperCase());
	}
	
	for (var i = 0; i < tokens.length; i++) {
		var token = tokens[i];
		
		if (token.type == 'comment') {
			appendText(token.value, token);
			flushLine();
			continue;
		}
		
		if (token.value == '(') {
			var isSubquery = startsSubquery(i);
			appendText('(', token);
			parenStack.push(isSubquery);
			if (isSubquery) {
				parenIndent += 1;
				flushLine();
			}
			continue;
		}
		
		if (token.value == ')') {
			var closesSubquery = parenStack.pop() == true;
			if (closesSubquery) {
				if (line.trim() != "") {
					flushLine();
				}
				parenIndent -= 1;
				if (parenIndent < 0) {
					parenIndent = 0;
				}
				line = indent();
				lastToken = null;
			}
			appendText(')', token);
			continue;
		}
		
		var clause = matchSQLMajorClause(tokens, i);
		if (clause != null) {
			if (line.trim() != "") {
				flushLine();
			}
			appendText(clause.text, {
				type: 'word'
			});
			i += clause.length - 1;
			continue;
		}
		
		appendText(currentText(token), token);
	}
	
	if (line.trim() != "") {
		flushLine();
	}
	
	return lines.join('\n');
}

function tokenizeSQL(sql) {
	var tokens = [];
	var i = 0;
	
	while (i < sql.length) {
		var char = sql[i];
		var nextChar = sql[i + 1];
		
		if (/\s/.test(char)) {
			i++;
			continue;
		}
		
		if (char == '-' && nextChar == '-') {
			var lineCommentStart = i;
			i += 2;
			while (i < sql.length && sql[i] != '\n') {
				i++;
			}
			tokens.push({
				type: 'comment',
				value: sql.slice(lineCommentStart, i)
			});
			continue;
		}
		
		if (char == '/' && nextChar == '*') {
			var blockCommentStart = i;
			i += 2;
			while (i < sql.length && !(sql[i] == '*' && sql[i + 1] == '/')) {
				i++;
			}
			if (i < sql.length) {
				i += 2;
			}
			tokens.push({
				type: 'comment',
				value: sql.slice(blockCommentStart, i)
			});
			continue;
		}
		
		if (char == "'" || char == '"' || char == '`') {
			var quote = char;
			var quoteStart = i;
			i++;
			while (i < sql.length) {
				if (sql[i] == '\\') {
					i += 2;
					continue;
				}
				if (sql[i] == quote) {
					if (sql[i + 1] == quote) {
						i += 2;
						continue;
					}
					i++;
					break;
				}
				i++;
			}
			tokens.push({
				type: quote == "'" ? 'string' : 'identifier',
				value: sql.slice(quoteStart, i)
			});
			continue;
		}
		
		if (/[A-Za-z_]/.test(char)) {
			var wordStart = i;
			i++;
			while (i < sql.length && /[A-Za-z0-9_$]/.test(sql[i])) {
				i++;
			}
			tokens.push({
				type: 'word',
				value: sql.slice(wordStart, i)
			});
			continue;
		}
		
		if (/[0-9]/.test(char)) {
			var numberStart = i;
			i++;
			while (i < sql.length && /[0-9.]/.test(sql[i])) {
				i++;
			}
			tokens.push({
				type: 'number',
				value: sql.slice(numberStart, i)
			});
			continue;
		}
		
		var twoChars = sql.slice(i, i + 2);
		var threeChars = sql.slice(i, i + 3);
		if (threeChars == '->>') {
			tokens.push({
				type: 'operator',
				value: threeChars
			});
			i += 3;
			continue;
		}
		if (['::', '->', '<=', '>=', '!=', '<>'].includes(twoChars)) {
			tokens.push({
				type: 'operator',
				value: twoChars
			});
			i += 2;
			continue;
		}
		
		tokens.push({
			type: ['=', '+', '-', '*', '/', '<', '>'].includes(char) ? 'operator' : 'symbol',
			value: char
		});
		i++;
	}
	
	return tokens;
}

function matchSQLMajorClause(tokens, index) {
	for (var i = 0; i < SQL_MAJOR_CLAUSES.length; i++) {
		var clause = SQL_MAJOR_CLAUSES[i];
		var matched = true;
		
		for (var j = 0; j < clause.length; j++) {
			var token = tokens[index + j];
			if (!token || token.type != 'word' || token.value.toUpperCase() != clause[j]) {
				matched = false;
				break;
			}
		}
		
		if (matched) {
			return {
				text: clause.join(' '),
				length: clause.length
			};
		}
	}
	
	return null;
}

function getNextContentIndex(tokens, index) {
	for (var i = index; i < tokens.length; i++) {
		if (tokens[i].type != 'comment') {
			return i;
		}
	}
	return -1;
}

function needsSpaceBefore(text, token, lastToken, line) {
	if (line == "" || line.endsWith('\t')) {
		return false;
	}
	if (text == ',' || text == ')' || text == '.' || text == '::' || text == '->' || text == '->>' || text == ';') {
		return false;
	}
	if (lastToken == null) {
		return false;
	}
	if (lastToken.value == '(' || lastToken.value == '.' || lastToken.value == '::' || lastToken.value == '->' || lastToken.value == '->>') {
		return false;
	}
	if (text == '(' && lastToken.type == 'word' && SQL_FUNCTION_KEYWORDS.includes(lastToken.value.toUpperCase())) {
		return false;
	}
	if (['=', '+', '-', '*', '/', '<', '>', '<=', '>=', '!=', '<>'].includes(text)) {
		return true;
	}
	if (lastToken.type == 'operator' && !['::', '->', '->>'].includes(lastToken.value)) {
		return true;
	}
	return true;
}
