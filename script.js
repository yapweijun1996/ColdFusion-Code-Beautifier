function beautifyCodes() {
	
	var split_html_tag = document.getElementById('split_html_tag').checked;
	var auto_copy_n_clear_bcontent = document.getElementById('auto_copy_n_clear_bcontent').checked;
	var rawCode = document.getElementById('input').value;
	var output = document.getElementById('output');
	
	if(split_html_tag == true){
		rawCode = rawCode.replace(/></g, '>\n<');
	}
	
	var lines = rawCode.split('\n');
	var indentLevel = 0;
	var indentSize = 1; // You can choose the size of indentation you want
	var indentSpace = 0;
	
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
			// Coldfusion
			else if (start_width_tag.startsWith('<cfset')
			|| start_width_tag.startsWith('<cfspreadsheet')
			|| start_width_tag.startsWith('<cfqueryparam')
			|| start_width_tag.startsWith('<cf_inc_multidb_date')
			|| start_width_tag.startsWith('<cfoutput')
			|| start_width_tag.startsWith('<cfparam')
			|| start_width_tag.startsWith('<cfinclude')
			|| start_width_tag.startsWith('<cfargument')
			|| start_width_tag.startsWith('<cfreturn')
			|| start_width_tag.startsWith('<cfbreak')
			|| start_width_tag.startsWith('<cfabort')
			|| start_width_tag.startsWith('<cfdump')
			|| start_width_tag.startsWith('<cfflush')
			|| start_width_tag.startsWith('<cfmodule')
			|| start_width_tag.startsWith('<cflocation')
			|| start_width_tag.startsWith('<cfimage')
			|| start_width_tag.startsWith('<cf_aebrowser')
			|| start_width_tag.startsWith('<cfdirectory')
			|| start_width_tag.startsWith('<cffile')
			|| start_width_tag.startsWith('<cfcontinue')
			|| start_width_tag.startsWith('<cfhttpparam')
			|| start_width_tag.startsWith('<cfcookie')
			|| start_width_tag.startsWith('<cfsleep')
			|| start_width_tag.startsWith('<cfparam')
			|| start_width_tag.startsWith('<cfparam')
			|| start_width_tag.startsWith('<cfparam')
			|| start_width_tag.startsWith('<cfparam')
			) {
				maintain_yn = "y";
			}
			// HTML
			else if (start_width_tag.startsWith('<input')
			|| start_width_tag.startsWith('<br')
			|| start_width_tag.startsWith('<meta')
			|| start_width_tag.startsWith('<img')
			|| start_width_tag.startsWith('<link')
			|| start_width_tag.startsWith('<input')
			|| start_width_tag.startsWith('<input')
			|| start_width_tag.startsWith('<input')
			) {
				maintain_yn = "y";
			}
			/* Maintain [end  ] */
			
			/* Decrease [start]   */
			else if (line_data.startsWith('</')) {
				indentLevel -= 1;
			}
			else if (line_data.startsWith('<cfelse')) {
				indentLevel -= 1;
			}
			/* Decrease [end  ] */
			
			// indentation
			//lines[i] = ''.padStart(indentLevel * indentSize) + line;
			if(indentLevel != 0 && indentSize != 0){
				indentSpace = indentLevel * indentSize;
			}else{
				indentSpace = 0;
			}
			lines[i] = ''.padStart(indentSpace, '\t') + line;
			
			
			
			
			/* Increase [start] */
			if(maintain_yn != "y"){
				if (line_data.startsWith(start_width_tag) && !line_data.includes(end_width_tag) && start_width_tag != "" && end_width_tag != "") {
					indentLevel += 1;
				}
			}
			/* Increase [end  ] */
		}else{ // Handle JavaScript CSS
			/* maintain_yn [start] */
			if(line_data.startsWith("//")){
				maintain_yn = "y";
				
				// indentation
				//lines[i] = ''.padStart(indentLevel * indentSize) + line;
				if(indentLevel != 0 && indentSize != 0){
					indentSpace = indentLevel * indentSize;
				}else{
					indentSpace = 0;
				}
				lines[i] = ''.padStart(indentSpace, '\t') + line;
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
				if(indentLevel != 0 && indentSize != 0){
					indentSpace = indentLevel * indentSize;
				}else{
					indentSpace = 0;
				}
				lines[i] = ''.padStart(indentSpace, '\t') + line;
				
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

	output.value = lines.join('\n');

	if(auto_copy_n_clear_bcontent == true){
		copy_output_data();
	}

}

function get_tag_element_start_width(line_data){
	var output = "";
	var tag_element = get_tag_name(line_data);
	if (tag_element != "") {
		// Construct the start tag based on the extracted tag_element.
		var output = "<"+ tag_element;
	}
	return output;
}

function get_tag_element_end_width(line_data){
	var output = "";
	var tag_element = get_tag_name(line_data);
	if (tag_element != "") {
		// Construct the start tag based on the extracted tag_element.
		var output = "</"+ tag_element;
	}
	return output;
}

function get_tag_name(data){
	var output = "";
	// Extract the tag name using a regex that captures the tag immediately following '<'
	var tagMatch = data.match(/^<(\w+)/);
	var tag_element = tagMatch ? tagMatch[1] : null;
	if (tag_element) {
		// Construct the start tag based on the extracted tag_element
		var output = tag_element;
	}
	return output;
}

function clear_data() {
	document.getElementById('input').value = '';
	document.getElementById('output').value = '';
	console.log("Clear Data");
}
function copy_output_data() {
	var auto_copy_n_clear_bcontent = document.getElementById('auto_copy_n_clear_bcontent').checked;
	
	//console.log("Copy Output Data");
	var textarea = document.getElementById("output");
	
	if (textarea.value !== "") {
		textarea.select();
		document.execCommand("copy");
		console.log("Copied the text.");
		
		if(auto_copy_n_clear_bcontent == true){
			clear_data();
		}
		
	} else {
	}
}
window.onload = function() {
	console.log('window - onload');
};


