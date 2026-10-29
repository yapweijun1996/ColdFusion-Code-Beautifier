/* CFML tag splitter. Loaded before beautifier.js; exposes
 * splitAdjacentCFMLTags globally.
 *
 * Default-on behavior: when an executable CFML tag (cfset, cfparam,
 * cfinclude, cfreturn) follows the closing `>` of another tag on the same
 * line, insert a newline plus the original line's leading whitespace.
 *
 * Opaque contexts are preserved: CFML/HTML comments, quoted strings,
 * <script>, <style>, <cfquery>, <cfscript>, and JS regex literals. */
function splitAdjacentCFMLTags(code) {
	if (typeof code !== 'string' || code === '') return code;

	// Splittable: any <cfXXX> open or </cfXXX> close, EXCEPT <cfqueryparam>
	// and <cfargument> (both have legitimate inline-with-other-content uses).
	// Leading <!--- or <!-- (comment opener) also acts as a split boundary so
	//   <cfset a = 1><!---<cfset b = 2>---><cfset c = 3>
	// becomes 3 lines with the comment as a standalone middle line.
	// Rule (C) splittables — three categories with different policy:
	//   OPEN  — any HTML/CFML open tag `<TAG>`. Splits when preceded by
	//           `>` (tag-to-tag boundary). Excludes cfqueryparam/cfargument.
	//   CF_CLOSE — CFML close tags `</cfXXX>`. Splits when preceded by `>`.
	//   COMMENT — `<!---` / `<!--`. Splits when preceded by `>`.
	// HTML close tags (`</td>`, `</tr>`, etc.) are NOT in this list, so
	// `<td></td>`, `</td></tr>` stay glued. Rule (B) handles the
	// "mixed CFML+HTML close" case separately.
	var SPLITTABLE_OPEN_RE     = /^<(?!\/|!|cfqueryparam\b|cfargument\b)[a-z][a-z0-9]*\b/i;
	var SPLITTABLE_CFCLOSE_RE  = /^<\/cf(?!queryparam\b|argument\b)[a-z]+\b/i;
	// Structural container closes that should align with their opens.
	// Excludes `</td>`, `</li>`, `</p>`, `</span>`, `</a>`, `</b>`, `</i>` etc.
	// (frequently inline-with-content).
	var SPLITTABLE_HTMLCLOSE_RE = /^<\/(?:tr|table|thead|tbody|tfoot|html|head|body|ul|ol|select|fieldset|optgroup)\b/i;
	var SPLITTABLE_COMMENT_RE  = /^<!--/;
	// Always-split: <script>/<style> + their closers. Fires when output
	// line has any non-ws content, regardless of preceding char. Real-
	// world: `<td>...&nbsp;<script>` should split between `&nbsp;` and
	// `<script>` even though `&nbsp;` ends with `;` not `>`.
	var ALWAYS_SPLIT_BEFORE_RE = /^<\/?(?:script|style)\b/i;
	// HTML close-block tags: split-before only when current output line
	// already contains a CFML close tag. Preserves inline `<td>x</td>`.
	var HTML_CLOSE_BLOCK_RE = /^<\/(?:td|tr|table|div|li|ul|ol|p|section|article|header|footer|nav|main|aside|form)\b/i;
	var LINE_HAS_CFML_CLOSE_RE = /<\/cf(?!queryparam\b|argument\b)[a-z]+>/i;
	var lower = code.toLowerCase();
	var out = '';
	var i = 0;
	var useJsStringEscapes = shouldUseJsStringEscapes(code);
	var inHtmlTagContext = false;  // true between `<` and `>` of an HTML/CFML tag

	function shouldUseJsStringEscapes(src) {
		/* Bare JS partials may still contain small server-side <cfoutput>
		 * islands. In that shape, quoted HTML uses JS escapes (`\'`) and the
		 * CFML splitter must not lose string parity before later `</div>`
		 * fragments. Keep normal CFML semantics for ordinary tag-first files. */
		var bodyStart = 0;
		while (bodyStart < src.length) {
			while (bodyStart < src.length && /\s/.test(src[bodyStart])) bodyStart++;
			if (src.slice(bodyStart, bodyStart + 5) !== '<!---'
					&& src.slice(bodyStart, bodyStart + 4) !== '<!--') break;
			var commentEnd = findMarkupCommentEnd(src, bodyStart);
			if (commentEnd === -1) break;
			bodyStart = commentEnd;
		}
		var body = src.slice(bodyStart).replace(/^\s+/, '');
		return /^(?:\/\*|\/\/|function\b|var\b|let\b|const\b|class\b|if\b|\(\s*function\b)/.test(body)
			&& /\\['"]/.test(src);
	}

	function leadingWsOfInputLine(pos) {
		var lineStart = code.lastIndexOf('\n', pos) + 1;
		var firstNonWs = lineStart;
		while (firstNonWs < code.length && (code[firstNonWs] === ' ' || code[firstNonWs] === '\t')) firstNonWs++;
		return code.slice(lineStart, firstNonWs);
	}

	function emitRegion(endNeedle) {
		// Emits up to and including the closing needle, advances i past it.
		var j = lower.indexOf(endNeedle, i);
		if (j === -1) {
			out += code.slice(i);
			i = code.length;
			return;
		}
		out += code.slice(i, j + endNeedle.length);
		i = j + endNeedle.length;
	}

	function emitMarkupComment() {
		var end = findMarkupCommentEnd(code, i);
		if (end === -1) {
			out += code.slice(i);
			i = code.length;
			return;
		}
		out += code.slice(i, end);
		i = end;
	}

	function lineTailHasOpenQuote(text) {
		var q = null;
		for (var k = 0; k < text.length; k++) {
			var ch = text[k];
			if (q) {
				if (useJsStringEscapes && ch === '\\') {
					k++;
					continue;
				}
				if (ch === q) {
					if (!useJsStringEscapes && text[k + 1] === q) {
						k++;
						continue;
					}
					q = null;
				}
				continue;
			}
			if (ch === '"' || ch === "'" || (useJsStringEscapes && ch === '`')) q = ch;
		}
		return q !== null;
	}

	function maybeSplitBefore(pos) {
		// Three split rules with different gating:
		//
		//   (A) ALWAYS-SPLIT — <script>/<style> open + close. Splits when
		//       output line has any non-ws content. No "preceding `>`"
		//       requirement (so `&nbsp;<script>` correctly splits).
		//
		//   (B) HTML-CLOSE-BLOCK + LINE-HAS-CFML-CLOSE — </td>/</tr>/etc.
		//       Splits only if the current output line already contains a
		//       CFML close tag. Signal: this is mixed CFML+HTML content
		//       where the HTML close should be visually separated.
		//       Preserves inline `<td>x</td>` (no CFML close in line).
		//
		//   (C) CFML-TAG (default) — <cfXXX>/</cfXXX>/<!---/<!--. Splits
		//       only when last non-ws char on output line is `>`. Protects
		//       inline `<cfif x>1<cfelse>0</cfif>` (`<cfelse>` preceded
		//       by `1` not `>` → no split).
		var j = pos;
		while (j < code.length && (code[j] === ' ' || code[j] === '\t')) j++;
		if (j >= code.length || code[j] !== '<') return false;
		var slice = code.slice(j);
		var outLastNl = out.lastIndexOf('\n');
		var outLineTail = outLastNl === -1 ? out : out.slice(outLastNl + 1);
		var trimmed = outLineTail.replace(/[ \t]+$/, '');
		if (trimmed === '') return false;
		if (lineTailHasOpenQuote(trimmed)) return false;

		// (A) script/style — always split when line has content
		if (ALWAYS_SPLIT_BEFORE_RE.test(slice)) {
			out += '\n' + leadingWsOfInputLine(pos);
			i = j;
			return true;
		}

		// (B) HTML close-block + line has CFML close earlier
		if (HTML_CLOSE_BLOCK_RE.test(slice) && LINE_HAS_CFML_CLOSE_RE.test(outLineTail)) {
			out += '\n' + leadingWsOfInputLine(pos);
			i = j;
			return true;
		}

		// (D) Stray close — `</TAG>` (CFML or HTML) that closes a block
		// opened on a PRIOR line (no matching `<TAG>` on the current
		// output line). Fires even when preceded by text content
		// (the `>` requirement of Rule C would otherwise skip these).
		//
		// Real-world triggers:
		//   <cfif outer>
		//     <cfif inner>Foo</cfif> bar</cfif>     ← stray </cfif>
		//   <b>
		//     <cfif x>GST<cfelse>VAT</cfif></b>     ← stray </b>
		//
		// Discriminator: position-sensitive stack simulation of opens/closes
		// for the SAME tag name on the current output line tail.
		//   - open found → push
		//   - close found:
		//       stack non-empty → pop (matches an inline open)
		//       stack empty    → ignore (matches a phantom prior-line open)
		// After walking the tail, if stack is non-empty, our pending close
		// has an inline partner → do NOT split. If stack is empty, no
		// inline partner exists → split.
		//
		// Examples (pending close shown first, then output-line tail):
		//   </cfif>  `<cfif x>1<cfelse>0`            → stack=[cfif] → keep inline
		//   </cfif>  `<cfif a>foo</cfif>`            → stack=[]     → split (stray)
		//   </cfif>  `</cfif>foo<cfif b>bar`         → stack=[cfif] → keep inline
		//   </b>     `<p>Hello <b>world`             → stack=[b]    → keep inline
		//   </b>     `<cfif x>X</cfif>`              → stack=[]     → split (stray)
		//   </td>    `<td>x</td>y`                   → stack=[]     → split (stray)
		var strayClose = slice.match(/^<\/([a-z][a-z0-9]*)\b/i);
		if (strayClose) {
			var closeTag = strayClose[1].toLowerCase();
			// cfqueryparam/cfargument have no meaningful close form; skip.
			if (closeTag !== 'cfqueryparam' && closeTag !== 'cfargument') {
				var pairRe = new RegExp('<(/?)' + closeTag + '\\b', 'gi');
				var depth = 0;
				var pm;
				while ((pm = pairRe.exec(outLineTail)) !== null) {
					if (pm[1] === '/') {
						if (depth > 0) depth--;  // matches inline open
						// else: ignore (matches phantom prior-line open)
					} else {
						depth++;  // open pushed onto stack
					}
				}
				if (depth === 0) {
					// No inline open waiting → pending close is stray.
					out += '\n' + leadingWsOfInputLine(pos);
					i = j;
					return true;
				}
			}
		}

		// (C) Open tag / CFML close / comment — splits at `>` boundary.
		// HTML close tags (`</td>`, `</tr>`, etc.) deliberately omitted
		// here to preserve `<td></td>` and `</td></tr>` inline.
		var inSplittableC = SPLITTABLE_OPEN_RE.test(slice)
			|| SPLITTABLE_CFCLOSE_RE.test(slice)
			|| SPLITTABLE_HTMLCLOSE_RE.test(slice)
			|| SPLITTABLE_COMMENT_RE.test(slice);
		if (!inSplittableC) return false;
		if (!trimmed.endsWith('>')) return false;
		out += '\n' + leadingWsOfInputLine(pos);
		i = j;
		return true;
	}

	while (i < code.length) {
		// Order matters: longer literal first (`<!---` before `<!--`).
		if (lower.startsWith('<!---', i)) {
			if (maybeSplitBefore(i)) continue;
			emitMarkupComment();
			continue;
		}
		if (lower.startsWith('<!--', i)) {
			if (maybeSplitBefore(i)) continue;
			emitMarkupComment();
			continue;
		}
		// Opaque blocks: emit open tag verbatim, then skip to closer.
		// 12 chars covers `<cfscript ` (10) plus a couple word-boundary chars.
		var rest = lower.slice(i, i + 12);
		if (/^<script\b/.test(rest)) {
			if (maybeSplitBefore(i)) continue;
			var oe = code.indexOf('>', i);
			if (oe === -1) { out += code.slice(i); i = code.length; continue; }
			out += code.slice(i, oe + 1);
			i = oe + 1;
			emitRegion('</script>');
			continue;
		}
		if (/^<style\b/.test(rest)) {
			if (maybeSplitBefore(i)) continue;
			var oe2 = code.indexOf('>', i);
			if (oe2 === -1) { out += code.slice(i); i = code.length; continue; }
			out += code.slice(i, oe2 + 1);
			i = oe2 + 1;
			emitRegion('</style>');
			continue;
		}
		if (/^<cfquery\b/.test(rest)) {
			if (maybeSplitBefore(i)) continue;
			var oe3 = code.indexOf('>', i);
			if (oe3 === -1) { out += code.slice(i); i = code.length; continue; }
			out += code.slice(i, oe3 + 1);
			i = oe3 + 1;
			emitRegion('</cfquery>');
			continue;
		}
		if (/^<cfscript\b/.test(rest)) {
			// <cfscript>...</cfscript> contains JS-like code with `//` line
			// comments. Treat as opaque so embedded `<script>`/`<style>`
			// substrings inside comments don't trigger splits.
			if (maybeSplitBefore(i)) continue;
			var oe4 = code.indexOf('>', i);
			if (oe4 === -1) { out += code.slice(i); i = code.length; continue; }
			out += code.slice(i, oe4 + 1);
			i = oe4 + 1;
			emitRegion('</cfscript>');
			continue;
		}
		// At any `<` — let maybeSplitBefore decide based on its three
		// rules (CFML / HTML-close-block / script-style). It returns
		// false for non-matching tags so plain HTML tags like `<td>`
		// just pass through.
		if (code[i] === '/' && code[i + 1] !== '/' && code[i + 1] !== '*') {
			var regexEnd = scanJSRegexLiteralEnd(code, i, out, { disallowAfterLt: true });
			if (regexEnd !== -1) {
				out += code.slice(i, regexEnd);
				i = regexEnd;
				continue;
			}
		}
		if (code[i] === '<' && maybeSplitBefore(i)) {
			continue;
		}
		// Track whether we are inside an HTML/CFML tag's attribute zone.
		if (code[i] === '<') inHtmlTagContext = true;
		else if (code[i] === '>') inHtmlTagContext = false;
		// Quote (string literal) — emit verbatim until matching close.
		// Single-quote `'` is only a string delimiter inside a tag attribute or
		// in JS-escape mode; bare apostrophes in HTML text content (e.g. "Lucee's")
		// must NOT trigger string-consuming mode.
		var c = code[i];
		if (c === '"' || (c === "'" && (inHtmlTagContext || useJsStringEscapes)) || (useJsStringEscapes && c === '`')) {
			out += c;
			i++;
			while (i < code.length) {
				if (useJsStringEscapes && code[i] === '\\') {
					out += code.substr(i, 2);
					i += 2;
					continue;
				}
				if (code[i] === c) {
					if (!useJsStringEscapes && code[i + 1] === c) {  // SQL-style doubled-quote escape
						out += c + c;
						i += 2;
						continue;
					}
					out += c;
					i++;
					break;
				}
				out += code[i];
				i++;
			}
			continue;
		}
		out += c;
		i++;
	}

	return out;
}

/* Keep literal HTML text, including whitespace between tags, as authored.
 * CSS can change any element's display mode, so a fixed list of inline tags
 * cannot establish that inserted whitespace is harmless. Raw code blocks are
 * matched as units to leave their dedicated formatters in control. */
function scanRenderedTextBoundaries(source) {
	var markers = [];
	var text = [];
	var hasRenderedMarkup = false;
	var cursor = 0;
	var scan = 0;
	while (scan < source.length) {
		var start = source.indexOf('<', scan);
		if (start === -1) break;
		var hash = source.indexOf('#', scan);
		if (hash !== -1 && hash < start) {
			if (source[hash + 1] === '#') { scan = hash + 2; continue; }
			var quote = null;
			var expressionEnd = -1;
			for (var h = hash + 1; h < source.length; h++) {
				var character = source[h];
				if (quote) {
					if (character === quote) {
						if (source[h + 1] === quote) h++;
						else quote = null;
					}
				} else if (character === '"' || character === "'") {
					quote = character;
				} else if (character === '#') {
					if (source[h + 1] === '#') h++;
					else { expressionEnd = h; break; }
				}
			}
			if (expressionEnd === -1) return null;
			scan = expressionEnd + 1;
			continue;
		}
		var rest = source.slice(start);
		var end;
		var key;
		var match;
		if (rest.slice(0, 4) === '<!--') {
			end = findMarkupCommentEnd(source, start);
			if (end === -1) return null;
			key = rest.slice(0, 5) === '<!---' ? 'cf-comment' : 'html-comment';
		} else if (/^<!doctype\b/i.test(rest)) {
			end = source.indexOf('>', start + 2);
			if (end === -1) return null;
			end++;
			key = 'doctype';
		} else {
			match = rest.match(/^<(\/?)([a-z][\w:-]*)(?=[\s/>])/i);
			if (!match) { scan = start + 1; continue; }
			var name = match[2].toLowerCase();
			var tagEnd = findCFMLTagClose(rest);
			if (tagEnd === -1) return null;
			end = start + tagEnd + 1;
			key = (match[1] ? '/' : '') + name;
			if ((name.slice(0, 2) !== 'cf' && name !== 'script' && name !== 'style')
					|| /^(?:cfoutput|cfinclude|cfmodule)$/.test(name)) hasRenderedMarkup = true;
			if (!match[1] && /^(?:script|style|cfquery|cfscript|cfsilent)$/.test(name)
					&& !/\/\s*>$/.test(source.slice(start, end))) {
				var close = findClosingTagOutsideText(source, name, end);
				if (!close) return null;
				end = close.end;
				key = 'raw:' + name;
			}
		}
		text.push(source.slice(cursor, start));
		markers.push({ key: key, start: start, end: end });
		cursor = end;
		scan = end;
		if (match && !match[1] && match[2].toLowerCase() === 'textarea') {
			var closeMatch = /<\/textarea\s*>/ig;
			closeMatch.lastIndex = scan;
			var textareaClose = closeMatch.exec(source);
			if (!textareaClose) return null;
			text.push(source.slice(cursor, textareaClose.index));
			markers.push({ key: '/textarea', start: textareaClose.index, end: closeMatch.lastIndex });
			cursor = closeMatch.lastIndex;
			scan = cursor;
		}
		match = null;
	}
	text.push(source.slice(cursor));
	if (markers.length && text.some(function(part) { return /\S/.test(part); })) {
		hasRenderedMarkup = true;
	}
	return { markers: markers, text: text, hasRenderedMarkup: hasRenderedMarkup };
}

function preserveOriginalHTML(source) {
	if (typeof console !== 'undefined' && console.warn) {
		console.warn('[beautifier] HTML text or attributes could not be safely reconciled; preserving original document.');
	}
	return source;
}

function preserveRenderedHTMLWhitespace(original, formatted) {
	var source = original.replace(/\r\n?/g, '\n');
	var candidate = formatted.replace(/\r\n?/g, '\n');
	var before = scanRenderedTextBoundaries(source);
	if (!before) {
		// Invalid CFML-only input remains the responsibility of the CFML formatter.
		return /<style\b|<\/?(?!cf|script\b|style\b)[a-z][\w:-]*(?=[\s/>])/i.test(source) ? preserveOriginalHTML(source) : formatted;
	}
	var protectCSS = before.markers.some(function(marker) { return marker.key === 'raw:style'; });
	if (!before.hasRenderedMarkup && !protectCSS) return formatted;
	var after = scanRenderedTextBoundaries(candidate);
	if (!after || before.markers.length !== after.markers.length) return preserveOriginalHTML(source);
	var result = '';
	var preDepth = 0;
	var previousStandaloneCFSet = false;
	for (var i = 0; i < before.markers.length; i++) {
		if (before.markers[i].key !== after.markers[i].key) return preserveOriginalHTML(source);
		var key = before.markers[i].key;
		var originalMarker = source.slice(before.markers[i].start, before.markers[i].end);
		var formattedMarker = candidate.slice(after.markers[i].start, after.markers[i].end);
		if (key !== 'cf-comment' && key !== 'html-comment' && key !== 'doctype') {
			var originalTag = originalMarker;
			var formattedTag = formattedMarker;
			if (key.slice(0, 4) === 'raw:') {
				originalTag = originalTag.slice(0, findCFMLTagClose(originalTag) + 1);
				formattedTag = formattedTag.slice(0, findCFMLTagClose(formattedTag) + 1);
			}
			var originalValues = originalTag.match(/"[^"]*"|'[^']*'/g) || [];
			var formattedValues = formattedTag.match(/"[^"]*"|'[^']*'/g) || [];
			if (originalValues.length !== formattedValues.length) return preserveOriginalHTML(source);
			for (var j = 0; j < originalValues.length; j++) {
				if (originalValues[j] !== formattedValues[j]) return preserveOriginalHTML(source);
			}
		}
		if (key === 'raw:style' && typeof collectCSSProtectedSegments === 'function'
				&& typeof sameCSSProtectedSegments === 'function') {
			var originalOpenEnd = findCFMLTagClose(originalMarker) + 1;
			var formattedOpenEnd = findCFMLTagClose(formattedMarker) + 1;
			var originalClose = originalMarker.match(/<\/style\s*>$/i);
			var formattedClose = formattedMarker.match(/<\/style\s*>$/i);
			if (!originalClose || !formattedClose) return preserveOriginalHTML(source);
			var originalCSS = originalMarker.slice(originalOpenEnd, originalClose.index);
			var formattedCSS = formattedMarker.slice(formattedOpenEnd, formattedClose.index);
			if (!sameCSSProtectedSegments(collectCSSProtectedSegments(originalCSS), collectCSSProtectedSegments(formattedCSS))) {
				formattedMarker = originalMarker;
				if (typeof console !== 'undefined' && console.warn) {
					console.warn('[beautifier] CSS content could not be safely reconciled; preserving original style block.');
				}
			}
		}
		var leadingText = before.hasRenderedMarkup ? before.text[i] : after.text[i];
		var currentStandaloneCFSet = key === 'cfset'
			&& (!/\S/.test(source.slice(source.lastIndexOf('\n', before.markers[i].start - 1) + 1, before.markers[i].start))
				|| (previousStandaloneCFSet && before.text[i] === ''));
		// Adjacent standalone assignments are split by the CFML formatter;
		// retain that split without inserting whitespace into inline HTML text.
		if (before.hasRenderedMarkup && preDepth === 0 && currentStandaloneCFSet
				&& previousStandaloneCFSet && before.text[i] === ''
				&& /^\s*\n\s*$/.test(after.text[i])) {
			leadingText = after.text[i];
		}
		// Keep rendered text and existing line breaks, but allow the indentation
		// before a standalone CFML tag to follow the structural formatter.
		if (before.hasRenderedMarkup && preDepth === 0
				&& /^(?:\/?cf[\w:-]+|raw:cf[\w:-]+|cf-comment)$/.test(key)
				&& /^\s*\n[\s\S]*$/.test(leadingText) && !/\S/.test(leadingText)
				&& /^\s*\n[\s\S]*$/.test(after.text[i]) && !/\S/.test(after.text[i])) {
			leadingText = leadingText.replace(/[ \t]*$/, (after.text[i].match(/[ \t]*$/) || [''])[0]);
		}
		result += leadingText + formattedMarker;
		if (key === 'pre') preDepth++;
		else if (key === '/pre' && preDepth > 0) preDepth--;
		previousStandaloneCFSet = currentStandaloneCFSet;
	}
	return result + (before.hasRenderedMarkup ? before.text[before.text.length - 1] : after.text[after.text.length - 1]);
}
