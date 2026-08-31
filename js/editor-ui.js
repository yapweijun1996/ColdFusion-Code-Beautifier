/* Editor UI integration layer.
 *
 * This module owns browser-only interactions around the formatter. It does
 * not know how CFML/SQL/JS/CSS formatting works: it calls the public legacy
 * functions exposed by the formatter and clipboard modules, and manages only
 * buttons, keyboard editing, and busy state.
 */
(function (root) {
	'use strict';

	var state = {
		initialized: false,
		busy: false,
		allowNextTabOut: false,
		idleLabel: 'Beautify',
		clearWasDisabled: false
	};

	function getElement(id) {
		if (typeof document === 'undefined' || !document.getElementById) return null;
		return document.getElementById(id);
	}

	function getFunction(name) {
		if (root && typeof root[name] === 'function') return root[name];
		/* In a classic script, function declarations are also available as
		 * globals. Keep this fallback for the VM harness and older browsers. */
		try {
			if (typeof window !== 'undefined' && typeof window[name] === 'function') return window[name];
		} catch (e) {}
		return null;
	}

	function notify(message) {
		var toast = getFunction('simple_toast_msg');
		if (toast) {
			try { toast(message); } catch (e) {}
		}
	}

	function dispatchInputEvent(textarea) {
		if (!textarea || typeof textarea.dispatchEvent !== 'function') return;
		try {
			var event;
			if (typeof Event === 'function') {
				event = new Event('input', { bubbles: true });
			} else if (document.createEvent) {
				event = document.createEvent('Event');
				event.initEvent('input', true, false);
			}
			if (event) textarea.dispatchEvent(event);
		} catch (e) {
			/* Input dispatch is an enhancement. Never make indentation fail in
			 * a browser with an incomplete Event implementation. */
		}
	}

	function leadingSpaces(line) {
		var match = line.match(/^ +/);
		return match ? match[0].length : 0;
	}

	function configuredTabWidth() {
		var widthEl = getElement('normalize_tab_width');
		var width = widthEl && parseInt(widthEl.value, 10);
		return width === 2 || width === 4 || width === 8 ? width : 0;
	}

	function spaceUnit(lines) {
		var configured = configuredTabWidth();
		if (configured) return configured;
		var smallest = 0;
		for (var i = 0; i < lines.length; i++) {
			var count = leadingSpaces(lines[i]);
			if (count > 0 && (!smallest || count < smallest)) smallest = count;
		}
		return smallest || 4;
	}

	function transformLine(line, outdent, unit) {
		if (!outdent) {
			return { value: '\t' + line, delta: 1 };
		}
		if (line.charAt(0) === '\t') {
			return { value: line.slice(1), delta: -1 };
		}
		var spaces = leadingSpaces(line);
		if (!spaces) return { value: line, delta: 0 };
		var remove = Math.min(unit, spaces);
		return { value: line.slice(remove), delta: -remove };
	}

	function mapSelectionPosition(position, changes, outdent, max) {
		var delta = 0;
		for (var i = 0; i < changes.length; i++) {
			var change = changes[i];
			/* For indent, a selection beginning at the line start should stay
			 * attached to the original code after the new tab. For outdent, a
			 * cursor at the line start is already before the removed whitespace. */
			if (outdent ? change.position < position : change.position <= position) {
				delta += change.delta;
			}
		}
		return Math.max(0, Math.min(max, position + delta));
	}

	/* Insert one tab at the caret, or indent/outdent every selected line.
	 * Returns true when the textarea value changed. Kept public for focused
	 * unit tests and future editor commands. */
	function applyTabEdit(textarea, outdent) {
		if (!textarea || typeof textarea.value !== 'string') return false;
		var value = textarea.value;
		var start = typeof textarea.selectionStart === 'number' ? textarea.selectionStart : 0;
		var end = typeof textarea.selectionEnd === 'number' ? textarea.selectionEnd : start;
		start = Math.max(0, Math.min(value.length, start));
		end = Math.max(start, Math.min(value.length, end));

		if (!outdent && start === end) {
			textarea.value = value.slice(0, start) + '\t' + value.slice(end);
			textarea.selectionStart = start + 1;
			textarea.selectionEnd = start + 1;
			dispatchInputEvent(textarea);
			return true;
		}

		var lineStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
		var endLineStart = value.lastIndexOf('\n', Math.max(0, end - 1)) + 1;
		var includeEndLine = end > endLineStart || (outdent && start === end);
		var blockEnd;
		if (includeEndLine) {
			blockEnd = value.indexOf('\n', endLineStart);
			if (blockEnd === -1) blockEnd = value.length;
		} else {
			/* The selection ends exactly at the next line's start. Preserve that
			 * newline, but do not edit the unselected next line. */
			blockEnd = end > lineStart && value.charAt(end - 1) === '\n' ? end - 1 : end;
		}

		var block = value.slice(lineStart, blockEnd);
		var lines = block.split('\n');
		var unit = spaceUnit(lines);
		var changes = [];
		var transformed = [];
		var offset = 0;
		for (var i = 0; i < lines.length; i++) {
			var result = transformLine(lines[i], !!outdent, unit);
			transformed.push(result.value);
			changes.push({ position: lineStart + offset, delta: result.delta });
			offset += lines[i].length + 1;
		}

		var newBlock = transformed.join('\n');
		var newValue = value.slice(0, lineStart) + newBlock + value.slice(blockEnd);
		if (newValue === value) return false;

		textarea.value = newValue;
		var newStart = mapSelectionPosition(start, changes, !!outdent, newValue.length);
		var newEnd = mapSelectionPosition(end, changes, !!outdent, newValue.length);
		textarea.selectionStart = Math.min(newStart, newEnd);
		textarea.selectionEnd = Math.max(newStart, newEnd);
		dispatchInputEvent(textarea);
		return true;
	}

	function setAttribute(element, name, value) {
		if (element && typeof element.setAttribute === 'function') element.setAttribute(name, value);
		else if (element) element[name] = value;
	}

	function removeAttribute(element, name) {
		if (element && typeof element.removeAttribute === 'function') element.removeAttribute(name);
		else if (element) delete element[name];
	}

	function setBeautifyBusy(busy) {
		var button = getElement('beautify');
		var clearButton = getElement('clear');
		if (!button) return;

		if (busy) {
			state.clearWasDisabled = !!(clearButton && clearButton.disabled);
			state.idleLabel = button.textContent || state.idleLabel;
			button.disabled = true;
			setAttribute(button, 'aria-busy', 'true');
			button.textContent = 'Beautifying…';
			if (clearButton) clearButton.disabled = true;
		} else {
			button.disabled = false;
			removeAttribute(button, 'aria-busy');
			button.textContent = state.idleLabel || 'Beautify';
			if (clearButton) clearButton.disabled = state.clearWasDisabled;
		}
	}

	function finishFailure(error, previousOutput) {
		var output = getElement('output');
		if (output && typeof previousOutput === 'string') output.value = previousOutput;
		state.busy = false;
		setBeautifyBusy(false);
		notify('Beautify failed. Your input was kept.');
		if (typeof console !== 'undefined' && console.error) {
			console.error('[editor-ui] beautify failed:', error);
		}
	}

	function finishSuccess(result) {
		state.busy = false;
		setBeautifyBusy(false);
		if (result === false) {
			notify('Input changed while formatting; the result was not applied.');
		}
	}

	function handleBeautify() {
		if (state.busy) return;
		var formatter = getFunction('beautifyCodes');
		if (!formatter) {
			notify('Beautifier is not available.');
			return;
		}

		var output = getElement('output');
		var previousOutput = output && typeof output.value === 'string' ? output.value : '';
		state.busy = true;
		setBeautifyBusy(true);

		var result;
		try {
			result = formatter();
		} catch (error) {
			finishFailure(error, previousOutput);
			return;
		}

		if (result && typeof result.then === 'function') {
			result.then(function (value) {
				finishSuccess(value);
			}, function (error) {
				finishFailure(error, previousOutput);
			});
		} else {
			finishSuccess(result);
		}
	}

	function handleShortcut(event) {
		if (!event || event.defaultPrevented) return;
		if (event.key !== 'Enter' || (!event.ctrlKey && !event.metaKey)
			|| event.shiftKey || event.altKey) return;
		if (state.busy) return;
		if (typeof event.preventDefault === 'function') event.preventDefault();
		var button = getElement('beautify');
		if (button && typeof button.click === 'function') button.click();
		else handleBeautify();
	}

	function handleEditorKeydown(event) {
		if (!event) return;
		if (event.key === 'Escape') {
			state.allowNextTabOut = true;
			return;
		}
		if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return;
		if (state.allowNextTabOut) {
			state.allowNextTabOut = false;
			return;
		}
		var outdent = !!event.shiftKey;
		var changed = applyTabEdit(getElement('input'), outdent);
		if (changed && typeof event.preventDefault === 'function') event.preventDefault();
	}

	function init() {
		if (state.initialized || typeof document === 'undefined' || !document.getElementById) return false;
		var beautifyButton = getElement('beautify');
		var copyButton = getElement('copy');
		var clearButton = getElement('clear');
		var input = getElement('input');
		if (!beautifyButton || !copyButton || !clearButton || !input) return false;

		state.initialized = true;
		state.idleLabel = beautifyButton.textContent || 'Beautify';

		if (typeof beautifyButton.addEventListener === 'function') {
			beautifyButton.addEventListener('click', handleBeautify);
		}
		if (typeof copyButton.addEventListener === 'function') {
			copyButton.addEventListener('click', function () {
				var copy = getFunction('copy_output_data');
				if (copy) copy();
			});
		}
		if (typeof clearButton.addEventListener === 'function') {
			clearButton.addEventListener('click', function () {
				var clear = getFunction('clear_data');
				if (clear) clear();
			});
		}
		if (typeof input.addEventListener === 'function') {
			input.addEventListener('keydown', handleEditorKeydown);
		}
		if (typeof document.addEventListener === 'function') {
			document.addEventListener('keydown', handleShortcut);
		}
		return true;
	}

	var api = {
		init: init,
		applyTabEdit: applyTabEdit,
		setBeautifyBusy: setBeautifyBusy,
		isBusy: function () { return state.busy; }
	};
	if (root) root.CFBEditorUI = api;

	if (typeof document !== 'undefined') {
		if (document.readyState === 'loading' && typeof document.addEventListener === 'function') {
			document.addEventListener('DOMContentLoaded', init);
		} else {
			init();
		}
	}
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
