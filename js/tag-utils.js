function get_tag_element_start_width(line_data){
	var tagMatch = line_data.match(/^<([a-zA-Z][\w:.-]*)/);
	return tagMatch ? '<' + tagMatch[1] : '';
}

function get_tag_element_end_width(line_data){
	var tagMatch = line_data.match(/^<\/([a-zA-Z][\w:.-]*)/);
	return tagMatch ? '</' + tagMatch[1] : '';
}

function get_tag_name(data){
	var output = "";
	// Extract both opening and closing tag names. The old opener-only regex
	// returned "" for every </tag>, so close-boundary state (script/query/style)
	// was never reset and later lines were parsed in the wrong language mode.
	var tagMatch = data.match(/^<\/?([a-zA-Z][\w:.-]*)/);
	var tag_element = tagMatch ? tagMatch[1] : null;
	if (tag_element) {
		// Construct the start tag based on the extracted tag_element
		var output = tag_element;
	}
	return output;
}
