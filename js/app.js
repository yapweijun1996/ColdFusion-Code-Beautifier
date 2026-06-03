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

/* Persist Semantic Indent (tree-sitter) opt-in across reloads. NOT gated by
 * Safe Mode: it is a whitespace-only transform (re-indents flat nested-call
 * chains; content is preserved — proven by tests/tree-sitter.test.mjs C4). */
(function persistSemanticIndent() {
	var KEY = 'cfb.semantic_indent';
	function safeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
	function safeSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

	function init() {
		if (typeof document === 'undefined' || !document.getElementById) return;
		var el = document.getElementById('semantic_indent');
		if (!el) return;
		var saved = safeGet(KEY);
		if (saved === '1') el.checked = true;
		else if (saved === '0') el.checked = false;
		if (typeof el.addEventListener === 'function') {
			el.addEventListener('change', function() {
				safeSet(KEY, el.checked ? '1' : '0');
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

/* Persist Normalize Indent preferences (checkbox + tab-width selector) so
 * the user's last choice survives page reloads. */
(function persistNormalizePrefs() {
	var STORAGE = {
		indent:   'cfb.normalize_indent',
		tabWidth: 'cfb.normalize_tab_width'
	};
	function safeGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
	function safeSet(key, value) { try { localStorage.setItem(key, value); } catch (e) {} }

	function init() {
		if (typeof document === 'undefined' || !document.getElementById) return;
		var indentEl   = document.getElementById('normalize_indent');
		var tabWidthEl = document.getElementById('normalize_tab_width');
		if (!indentEl || !tabWidthEl) return;

		var savedIndent = safeGet(STORAGE.indent);
		if (savedIndent === '1') indentEl.checked = true;
		else if (savedIndent === '0') indentEl.checked = false;

		var savedWidth = safeGet(STORAGE.tabWidth);
		if (savedWidth !== null && tabWidthEl.options) {
			for (var i = 0; i < tabWidthEl.options.length; i++) {
				if (tabWidthEl.options[i].value === savedWidth) {
					tabWidthEl.value = savedWidth;
					break;
				}
			}
		}

		if (typeof indentEl.addEventListener === 'function') {
			indentEl.addEventListener('change', function() {
				safeSet(STORAGE.indent, indentEl.checked ? '1' : '0');
			});
		}
		if (typeof tabWidthEl.addEventListener === 'function') {
			tabWidthEl.addEventListener('change', function() {
				safeSet(STORAGE.tabWidth, tabWidthEl.value);
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

/* Safe Mode — one-click disable of all "content-shaped change" paths.
 *
 * When checked, force-unchecks AND disables (greys out) the four toggles
 * that can alter content beyond whitespace:
 *   - deep_sql / deep_css / deep_js  (home-rolled language formatters)
 *   - pro_sql                         (sql-formatter library rewrites SQL)
 *
 * What remains active: CFML auto-split (Rules A/B/C/D) + indent tracker.
 * Both are whitespace-only transformations (proven by 22 content-
 * preservation invariants in tests/run-tests.js). Use Safe Mode when
 * processing sensitive or production CFML where you cannot tolerate
 * even a cosmetic SQL keyword case change.
 *
 * Persisted in localStorage so a one-time opt-in survives reloads.
 * See docs/SAFETY.md for the full per-language risk evaluation.
 */
(function persistSafeMode() {
	var STORAGE_KEY = 'cfb.safe_mode';
	var GATED_IDS = ['deep_sql', 'deep_css', 'deep_js', 'pro_sql'];

	function safeGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
	function safeSet(key, value) { try { localStorage.setItem(key, value); } catch (e) {} }

	function applySafeMode(safeEl, gatedEls) {
		var on = !!safeEl.checked;
		for (var i = 0; i < gatedEls.length; i++) {
			var el = gatedEls[i];
			if (!el) continue;
			if (on) {
				// Stash the user's prior state so Safe Mode is fully reversible.
				if (el.dataset && typeof el.dataset === 'object') {
					el.dataset.safeModePrior = el.checked ? '1' : '0';
				}
				el.checked = false;
				el.disabled = true;
			} else {
				el.disabled = false;
				var prior = el.dataset && el.dataset.safeModePrior;
				if (prior === '1') el.checked = true;
				else if (prior === '0') el.checked = false;
				// If no prior recorded (e.g. first load with safe_mode previously
				// saved as ON), leave checkbox state as-is (unchecked) — the user
				// can re-enable explicitly.
			}
			// Dim the parent <label> for a clear visual signal.
			var lbl = el.closest ? el.closest('label') : null;
			if (lbl && lbl.style) lbl.style.opacity = on ? '0.45' : '';
		}
	}

	function init() {
		if (typeof document === 'undefined' || !document.getElementById) return;
		var safeEl = document.getElementById('safe_mode');
		if (!safeEl) return;
		var gatedEls = GATED_IDS.map(function(id) { return document.getElementById(id); });

		var saved = safeGet(STORAGE_KEY);
		if (saved === '1') safeEl.checked = true;
		else if (saved === '0') safeEl.checked = false;

		applySafeMode(safeEl, gatedEls);

		if (typeof safeEl.addEventListener === 'function') {
			safeEl.addEventListener('change', function() {
				safeSet(STORAGE_KEY, safeEl.checked ? '1' : '0');
				applySafeMode(safeEl, gatedEls);
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
