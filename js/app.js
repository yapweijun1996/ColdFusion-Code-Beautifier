window.onload = function() {
	console.log('window - onload');
};

if (typeof document !== 'undefined' && document.querySelector) {
	var yearEl = document.querySelector('.at_year');
	if (yearEl) yearEl.textContent = new Date().getFullYear();
}

/* Persist Pro SQL preferences in localStorage so the user's last
 * choice of engine + dialect survives reloads. Other toggles stay
 * session-scoped to keep the default UX predictable.
 *
 * Side effect: when the saved state is "on", the vendor bundle is
 * pre-warmed in the background so the first Beautify click after a
 * fresh load isn't blocked on the network round-trip.
 */
(function persistProSqlPrefs() {
	var STORAGE = {
		pro: 'cfb.pro_sql',
		dialect: 'cfb.pro_sql_dialect'
	};

	function safeGet(key) {
		try { return localStorage.getItem(key); } catch (e) { return null; }
	}
	function safeSet(key, value) {
		try { localStorage.setItem(key, value); } catch (e) {}
	}

	function init() {
		if (typeof document === 'undefined' || !document.getElementById) return;
		var proEl = document.getElementById('pro_sql');
		var dialectEl = document.getElementById('pro_sql_dialect');
		if (!proEl || !dialectEl) return;

		var savedPro = safeGet(STORAGE.pro);
		if (savedPro === '1' || savedPro === '0') {
			proEl.checked = (savedPro === '1');
		}

		var savedDialect = safeGet(STORAGE.dialect);
		if (savedDialect && dialectEl.options) {
			for (var i = 0; i < dialectEl.options.length; i++) {
				if (dialectEl.options[i].value === savedDialect) {
					dialectEl.value = savedDialect;
					break;
				}
			}
		}

		if (proEl.checked && typeof ensureProSQL === 'function') {
			ensureProSQL().catch(function() {});
		}

		if (typeof proEl.addEventListener === 'function') {
			proEl.addEventListener('change', function() {
				safeSet(STORAGE.pro, proEl.checked ? '1' : '0');
				if (proEl.checked && typeof ensureProSQL === 'function') {
					ensureProSQL().catch(function() {});
				}
			});
		}
		if (typeof dialectEl.addEventListener === 'function') {
			dialectEl.addEventListener('change', function() {
				safeSet(STORAGE.dialect, dialectEl.value);
			});
		}
	}

	if (typeof document === 'undefined') return;
	if (document.readyState === 'loading' && typeof document.addEventListener === 'function') {
		document.addEventListener('DOMContentLoaded', init);
	} else {
		init();
	}
})();
