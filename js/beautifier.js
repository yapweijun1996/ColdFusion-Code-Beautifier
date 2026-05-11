function beautifyCFML(rawCode, split_html_tag) {

	if(split_html_tag == true){
		rawCode = rawCode.replace(/></g, '>\n<');
	}

	var lines = rawCode.split('\n');
	var indentLevel = 0;
	var indentSize = 1; // You can choose the size of indentation you want
	var indentSpace = 0;
	var inMarkupComment = false;
	var inBlockComment = false;
	var commentOrigPrefix = "";
	var commentNewPrefix = "";
	var inMultiLineTag = false;
	var multiLineTagName = "";

	function applyIndent() {
		if(indentLevel != 0 && indentSize != 0){
			indentSpace = indentLevel * indentSize;
		}else{
			indentSpace = 0;
		}
		lines[i] = ''.padStart(indentSpace, '\t') + line;
	}

	for (var i = 0; i < lines.length; i++) {

		/* Initial [start]  */
		if(indentLevel < 0){
			indentLevel = 0;
		}
		var line = lines[i].trim();
		var line_data = line.toLowerCase();

		// Multi-line opening tag continuation: lines after a tag like
		// `<div class="..."` whose `>` is on a later line. Continuation
		// lines (including the line containing the closing `>`) sit at
		// indentLevel = openingLineLevel + 1. After the closing `>`:
		//   - self-close (`/>`), HTML void, or CF inline tag → pop back
		//     to parent level so siblings align with the opener.
		//   - block/regular tag → keep indentLevel at +1 so the tag's
		//     children indent under it; the matching `</tag>` decrements
		//     back to the opener's level via existing logic.
		if (inMultiLineTag) {
			applyIndent();
			if (line.indexOf('>') !== -1) {
				var selfClose = /\/\s*>/.test(line);
				inMultiLineTag = false;
				if (selfClose || HTML_VOID_TAGS.indexOf(multiLineTagName) !== -1 || CF_TAGS.inline.indexOf(multiLineTagName) !== -1) {
					indentLevel -= 1;
				}
				multiLineTagName = "";
			}
			continue;
		}

		var opensMarkupComment = line_data.includes('<!---') || line_data.includes('<!--');
		var closesMarkupComment = line_data.includes('--->') || line_data.includes('-->');
		var opensBlockComment = line_data.startsWith('/*') && !line_data.endsWith('*/');
		var closesBlockComment = line_data.endsWith('*/');

		if (inMarkupComment || inBlockComment) {
			// Shift continuation line's leading whitespace so alignment
			// relative to the opening line is preserved.
			if (lines[i].indexOf(commentOrigPrefix) === 0) {
				lines[i] = commentNewPrefix + lines[i].substring(commentOrigPrefix.length);
			}
			if (inMarkupComment && closesMarkupComment) {
				inMarkupComment = false;
			}
			if (inBlockComment && closesBlockComment) {
				inBlockComment = false;
			}
			continue;
		}

		if (opensMarkupComment && !closesMarkupComment) {
			commentOrigPrefix = (lines[i].match(/^[ \t]*/) || [""])[0];
			applyIndent();
			commentNewPrefix = ''.padStart(indentSpace, '\t');
			inMarkupComment = true;
			continue;
		}

		if (opensBlockComment && !closesBlockComment) {
			commentOrigPrefix = (lines[i].match(/^[ \t]*/) || [""])[0];
			applyIndent();
			commentNewPrefix = ''.padStart(indentSpace, '\t');
			inBlockComment = true;
			continue;
		}

		if (line_data.includes('<!---') && line_data.includes('--->')) {

		}else{
			line_data = line_data.replace("/*", "");
			line_data = line_data.replace("*/", "");
			//line_data = line_data.replace("//", "");
			line_data = line_data.replace("<!---", "");
			line_data = line_data.replace("--->", "");
			line_data = line_data.replace("<!--", "");
			line_data = line_data.replace("-->", "");

			if (line_data.trim().endsWith(';')) {
				line_data = line_data.replace(/\;\s*$/, '');
			}

			if (line_data.trim().endsWith('+')) {
				line_data = line_data.replace(/\+\s*$/, '');
			}

			if (line_data.trim().startsWith('"') && line_data.trim().endsWith('"')) {
				line_data = line_data.replace(/^"/, '');
				line_data = line_data.replace(/"$/, '');
			}

			if (line_data.trim().startsWith("'") && line_data.trim().endsWith("'")) {
				line_data = line_data.replace(/^'/, '');
				line_data = line_data.replace(/'$/, '');
			}

			line_data = line_data.trim();
		}

		var start_width_tag = get_tag_element_start_width(line_data);
		var end_width_tag   = get_tag_element_end_width(line_data);
		var tag_name        = get_tag_name(line_data);
		var maintain_yn     = "n";
		/* Initial [end  ]   */

		// Multi-line opening tag entry: `<tag attr=...` with no `>` on
		// this line. Apply indent at current level, then bump
		// indentLevel by 1 so continuation lines (handled at the top
		// of the next iteration via inMultiLineTag) sit one level
		// deeper than the opener. Skip comment openers — they have
		// their own handling above.
		if (line_data.startsWith("<") && !line_data.includes(">") && tag_name && !line_data.startsWith('<!')) {
			applyIndent();
			multiLineTagName = tag_name;
			inMultiLineTag = true;
			indentLevel += 1;
			continue;
		}

		if (line_data.startsWith("<") && line_data.includes(">")) { // Handle HTML Coldfusion
			/* Maintain [start] */
			if (line_data.startsWith("<") && line_data.includes("/>")) {
				maintain_yn = "y";
			}
			else if (line_data.startsWith(start_width_tag) && line_data.includes(end_width_tag) && start_width_tag != "" && end_width_tag != "") {
				maintain_yn = "y";
			}
			else if (CF_TAGS.inline.includes(tag_name)) {
				maintain_yn = "y";
			}
			else if (HTML_VOID_TAGS.includes(tag_name)) {
				maintain_yn = "y";
			}
			/* Maintain [end  ] */

			/* Decrease [start]   */
			else if (CF_TAGS.middle.includes(tag_name)) {
				indentLevel -= 1;
				applyIndent();
				indentLevel += 1;
				continue;
			}
			else if (line_data.startsWith('</')) {
				indentLevel -= 1;
			}
			/* Decrease [end  ] */

			// indentation
			//lines[i] = ''.padStart(indentLevel * indentSize) + line;
			applyIndent();




			/* Increase [start] */
			if(maintain_yn != "y"){
				if (line_data.startsWith(start_width_tag) && !line_data.includes(end_width_tag) && start_width_tag != "" && end_width_tag != "") {
					if (!tag_name.startsWith('cf') || CF_TAGS.block.includes(tag_name)) {
						indentLevel += 1;
					}
				}
			}
			/* Increase [end  ] */
		}else{ // Handle JavaScript CSS
		/* maintain_yn [start] */
		if(line_data.startsWith("//")){
			maintain_yn = "y";

			// indentation
			//lines[i] = ''.padStart(indentLevel * indentSize) + line;
			applyIndent();
		}
		/* maintain_yn [end  ] */

		if(maintain_yn == "n"){
			/* Decrease [start] */
			// JavaScript CSS
			if(line_data.startsWith("}")){
				indentLevel -= 1;
			}
			else if(line_data.startsWith("]")){
				indentLevel -= 1;
			}
			else if(line_data.includes("}") && !line_data.includes("{")){
				indentLevel -= 1;
			}
			/* Decrease [end  ] */


			// indentation
			//lines[i] = ''.padStart(indentLevel * indentSize) + line;
			applyIndent();

			/* Increase [start] */
			// JavaScript CSS
			if(line_data.endsWith("{")){
				indentLevel += 1;
			}else if(line_data.endsWith("[")){
				indentLevel += 1;
				/* Increase [end  ] */
			}
			else if(line_data.includes("{") && !line_data.includes("}")){
				indentLevel += 1;
				/* Increase [end  ] */
			}

		}

	}

	//console.log("line_data." + line_data);
	//console.log("indentLevel." + indentLevel);
}

return lines.join('\n');

}

function detectLanguage(code) {
	if (/^\s*(select|insert|update|delete|with|create|alter|drop)\b/i.test(code)) {
		return 'sql';
	}
	return 'cfml';
}

function beautifyCodes() {
	var split_html_tag = document.getElementById('split_html_tag').checked;
	var auto_copy = document.getElementById('auto_copy').checked;
	var auto_clear = document.getElementById('auto_clear').checked;
	var auto_clear_output = document.getElementById('auto_clear_output').checked;
	var deep_sql = document.getElementById('deep_sql').checked;
	var deep_css = document.getElementById('deep_css').checked;
	var deep_js = document.getElementById('deep_js').checked;
	var proSqlEl = document.getElementById('pro_sql');
	var pro_sql = proSqlEl ? proSqlEl.checked : false;
	var dialectEl = document.getElementById('pro_sql_dialect');
	var pro_sql_dialect = dialectEl ? dialectEl.value : 'sql';
	var rawCode = document.getElementById('input').value;
	var output = document.getElementById('output');
	var language = document.getElementById('language').value;

	if(language == 'auto'){
		language = detectLanguage(rawCode);
	}

	function finishOutput() {
		var copied = false;
		if(auto_copy == true){
			copied = copy_output_data();
		}
		if(auto_clear == true){
			document.getElementById('input').value = '';
		}
		if(auto_clear_output == true && (auto_copy != true || copied == true)){
			output.value = '';
		}
	}

	function runFormat() {
		if(language == 'sql'){
			var canUseProDirect = pro_sql
				&& typeof formatProSQLSync === 'function'
				&& typeof isProSQLLoaded === 'function'
				&& isProSQLLoaded()
				&& !(typeof bodyHasStructuralCFMLControlFlow === 'function' && bodyHasStructuralCFMLControlFlow(rawCode));
			if (canUseProDirect) {
				try {
					output.value = formatProSQLSync(rawCode, pro_sql_dialect);
				} catch (err) {
					if (typeof console !== 'undefined' && console.warn) {
						console.warn('[beautifier] Pro SQL direct mode threw, falling back to built-in beautifySQL. Error:', err && err.message, '\nDialect:', pro_sql_dialect, '\nSQL excerpt:', rawCode.slice(0, 400));
					}
					output.value = beautifySQL(rawCode);
				}
			} else {
				output.value = beautifySQL(rawCode);
			}
		}else{
			var result = beautifyCFML(rawCode, split_html_tag);
			if(deep_sql || deep_css || deep_js){
				result = deepFormatEmbedded(result, {
					sql: deep_sql,
					css: deep_css,
					js: deep_js,
					sqlPro: pro_sql,
					sqlDialect: pro_sql_dialect
				}, rawCode);
			}
			output.value = result;
		}
		finishOutput();
	}

	if (pro_sql && typeof ensureProSQL === 'function' && (!(typeof isProSQLLoaded === 'function') || !isProSQLLoaded())) {
		ensureProSQL().then(runFormat).catch(function(err) {
			console.warn('[pro-sql] load failed, falling back to built-in formatter:', err);
			runFormat();
		});
		return;
	}

	runFormat();
}
