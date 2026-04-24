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
	var rawCode = document.getElementById('input').value;
	var output = document.getElementById('output');
	var language = document.getElementById('language').value;
	var copied = false;

	if(language == 'auto'){
		language = detectLanguage(rawCode);
	}

	if(language == 'sql'){
		output.value = beautifySQL(rawCode);
	}else{
		var result = beautifyCFML(rawCode, split_html_tag);
		if(deep_sql || deep_css || deep_js){
			result = deepFormatEmbedded(result, {sql: deep_sql, css: deep_css, js: deep_js});
		}
		output.value = result;
	}

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
