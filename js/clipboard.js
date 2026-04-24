function clear_data() {
	document.getElementById('input').value = '';
	document.getElementById('output').value = '';
	console.log("Clear Data");
	simple_toast_msg('Clear Data');
}
function copy_output_data() {
	//console.log("Copy Output Data");
	var textarea = document.getElementById("output");

	if (textarea.value !== "") {
		textarea.select();
		var copied = false;
		try {
			copied = document.execCommand("copy");
		} catch (error) {
			copied = false;
		}
		if (copied) {
			console.log("Copied the text.");
			simple_toast_msg('Copied the text.');
		} else {
			console.log("Copy failed.");
			simple_toast_msg('Copy failed.');
		}
		return copied;

	} else {
	}
	return false;
}
