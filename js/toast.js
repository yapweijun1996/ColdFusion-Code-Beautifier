function simple_toast_msg(content) {
	var toastContainer = document.querySelector('.simpleToastContainer');
	var toast = document.createElement('div');
	toast.className = 'simple-toast';
	toast.innerHTML = content;
	
	toastContainer.prepend(toast);
	
	setTimeout(() => {
		toast.classList.add('show');
		toast.classList.add('simple-toast-slidein');
	}, 10);
	
	let removeTimeout = setTimeout(() => {
		toast.remove();
	}, 4200);
	
	toast.addEventListener('mouseenter', () => {
		clearTimeout(removeTimeout);
		toast.style.setProperty('--animation-paused', 'paused');
		toast.classList.remove('simple-toast-slidein');
	});
	
	toast.addEventListener('mouseleave', () => {
		toast.style.setProperty('--animation-paused', 'running');
		toast.classList.add('simple-toast-slidein');
		removeTimeout = setTimeout(() => {
			toast.remove();
		}, 4200);
	});
	
	toast.addEventListener('click', () => {
		toast.remove();
	});
}
