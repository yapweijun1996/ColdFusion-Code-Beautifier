/* Small notification helpers used by the editor and PWA update flow. */
(function (root) {
	'use strict';

	function removeToast(toast) {
		if (!toast) return;
		if (toast._removeTimeout) clearTimeout(toast._removeTimeout);
		if (typeof toast.remove === 'function') toast.remove();
		else if (toast.parentNode && typeof toast.parentNode.removeChild === 'function') {
			toast.parentNode.removeChild(toast);
		}
	}

	function createToast(content, actionText, onAction, options) {
		if (typeof document === 'undefined' || !document.querySelector || !document.createElement) {
			return null;
		}
		var toastContainer = document.querySelector('.simpleToastContainer');
		if (!toastContainer) return null;

		var toast = document.createElement('div');
		toast.className = 'simple-toast';
		toast.innerHTML = content;

		if (actionText) {
			var actionRow = document.createElement('div');
			actionRow.className = 'simple-toast-actions';
			var action = document.createElement('button');
			action.type = 'button';
			action.className = 'simple-toast-action';
			action.textContent = actionText;
			action.addEventListener('click', function (event) {
				if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
				try {
					if (typeof onAction === 'function') onAction();
				} finally {
					removeToast(toast);
				}
			});
			actionRow.appendChild(action);
			toast.appendChild(actionRow);
		}

		if (typeof toastContainer.prepend === 'function') toastContainer.prepend(toast);
		else toastContainer.insertBefore(toast, toastContainer.firstChild || null);

		setTimeout(function () {
			if (toast.classList) {
				toast.classList.add('show');
				toast.classList.add('simple-toast-slidein');
			}
		}, 10);

		var configuredDuration = options && options.duration;
		var duration = typeof configuredDuration === 'number'
			? configuredDuration
			: (actionText ? 0 : 4200);
		toast._removeTimeout = null;
		if (duration > 0) {
			toast._removeTimeout = setTimeout(function () {
				removeToast(toast);
			}, duration);
		}

		toast.addEventListener('mouseenter', function () {
			if (toast._removeTimeout) {
				clearTimeout(toast._removeTimeout);
				toast._removeTimeout = null;
			}
			if (toast.style && typeof toast.style.setProperty === 'function') {
				toast.style.setProperty('--animation-paused', 'paused');
			}
			if (toast.classList) toast.classList.remove('simple-toast-slidein');
		});

		toast.addEventListener('mouseleave', function () {
			if (toast.style && typeof toast.style.setProperty === 'function') {
				toast.style.setProperty('--animation-paused', 'running');
			}
			if (toast.classList) toast.classList.add('simple-toast-slidein');
			if (duration > 0 && !toast._removeTimeout) {
				toast._removeTimeout = setTimeout(function () {
					removeToast(toast);
				}, duration);
			}
		});

		toast.addEventListener('click', function () {
			removeToast(toast);
		});
		return toast;
	}

	function simple_toast_msg(content) {
		return createToast(content, null, null, null);
	}

	/* Persistent notification with a keyboard-accessible action button.
	 * `options.duration` can be used for a timed action; zero keeps it visible
	 * until the user clicks the action or the toast itself. */
	function simple_toast_action(content, actionText, onAction, options) {
		return createToast(content, actionText, onAction, options || { duration: 0 });
	}

	if (root) {
		root.simple_toast_msg = simple_toast_msg;
		root.simple_toast_action = simple_toast_action;
	}
	/* Classic scripts also expose these declarations as window globals. */
	if (typeof window !== 'undefined') {
		window.simple_toast_msg = simple_toast_msg;
		window.simple_toast_action = simple_toast_action;
	}
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
