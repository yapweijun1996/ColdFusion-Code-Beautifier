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

	function shouldUseJsStringEscapes(src) {
		/* Bare JS partials may still contain small server-side <cfoutput>
		 * islands. In that shape, quoted HTML uses JS escapes (`\'`) and the
		 * CFML splitter must not lose string parity before later `</div>`
		 * fragments. Keep normal CFML semantics for ordinary tag-first files. */
		var body = src.replace(/^\s*(?:<!---[\s\S]*?--->\s*)+/i, '').replace(/^\s+/, '');
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
			out += '<!---'; i += 5;
			emitRegion('--->');
			continue;
		}
		if (lower.startsWith('<!--', i)) {
			if (maybeSplitBefore(i)) continue;
			out += '<!--'; i += 4;
			emitRegion('-->');
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
		// Quote (string literal) — emit verbatim until matching close.
		var c = code[i];
		if (c === '"' || c === "'" || (useJsStringEscapes && c === '`')) {
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
