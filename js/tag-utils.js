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
