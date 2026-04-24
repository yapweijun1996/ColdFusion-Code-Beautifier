function beautifyCFML(rawCode, split_html_tag) {
	
	if(split_html_tag == true){
		rawCode = rawCode.replace(/></g, '>\n<');
	}
	
	var lines = rawCode.split('\n');
	var indentLevel = 0;
	var indentSize = 1; // You can choose the size of indentation you want
	var indentSpace = 0;
	
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
	var auto_copy_n_clear_bcontent = document.getElementById('auto_copy_n_clear_bcontent').checked;
	var deep_format = document.getElementById('deep_format').checked;
	var rawCode = document.getElementById('input').value;
	var output = document.getElementById('output');
	var language = document.getElementById('language').value;
	
	if(language == 'auto'){
		language = detectLanguage(rawCode);
	}
	
	if(language == 'sql'){
		output.value = beautifySQL(rawCode);
	}else{
		var result = beautifyCFML(rawCode, split_html_tag);
		if(deep_format == true){
			result = deepFormatEmbedded(result);
		}
		output.value = result;
	}
	
	if(auto_copy_n_clear_bcontent == true){
		copy_output_data();
	}
}
