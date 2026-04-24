function clear_data() {
	document.getElementById('input').value = '';
	document.getElementById('output').value = '';
	console.log("Clear Data");
	simple_toast_msg('Clear Data');
}
function copy_output_data() {
	var auto_copy_n_clear_bcontent = document.getElementById('auto_copy_n_clear_bcontent').checked;
	
	//console.log("Copy Output Data");
	var textarea = document.getElementById("output");
	
	if (textarea.value !== "") {
		textarea.select();
		document.execCommand("copy");
		console.log("Copied the text.");
		simple_toast_msg('Copied the text.');
		
		if(auto_copy_n_clear_bcontent == true){
			clear_data();
		}
		
	} else {
	}
}
