window.onload = function() {
	console.log('window - onload');
};

document.querySelector('.at_year').textContent = new Date().getFullYear();
