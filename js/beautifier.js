/* Default-on, no checkbox: when an "executive" CFML tag (cfset, cfparam,
 * cfinclude, cfreturn) follows the closing `>` of any other tag on the
 * SAME line, insert a newline + the original line's leading whitespace
 * so each executive tag lives on its own line.
 *
 * Why default-on: there is no legitimate visual or semantic reason to
 * glue two <cfset> tags together on one line — splitting is a strict
 * improvement, never a regression. Real-world legacy CFML routinely
 * has lines like
 *   <cfset a = 1><cfset b = 2><cfset c = 3>
 *   <cfset x = "old"><!---<cfset x = "older"---><cfset x = "new">
 * which become un-readable after the outer beautifier re-indents.
 *
 * Skipped contexts (parser is opaque inside these — we never split):
 *   - CFML markup comment   <!--- ... --->
 *   - HTML comment          <!-- ... -->
 *   - Single/double quoted strings
 *   - <script>...</script>   (JS body)
 *   - <style>...</style>     (CSS body)
 *   - <cfquery>...</cfquery> (SQL body — has its own dispatch)
 *
 * Why these particular tags: cfset / cfparam / cfinclude / cfreturn are
 * unambiguously line-level statements; there is no inline grammar where
 * two of them on one line is desired. cfif / cfqueryparam are EXCLUDED
 * because both have legitimate inline uses (`<cfif x>1<cfelse>0</cfif>`
 * and `WHERE x = <cfqueryparam>`).
 */
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
		if (code[i] === '<' && maybeSplitBefore(i)) {
			continue;
		}
		// Quote (string literal) — emit verbatim until matching close.
		var c = code[i];
		if (c === '"' || c === "'") {
			out += c;
			i++;
			while (i < code.length) {
				if (code[i] === c) {
					if (code[i + 1] === c) {  // SQL-style doubled-quote escape
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

/* String-aware brace/bracket counter for one line of JS/CSS/JSON-ish text.
 *
 * Counts `{` `[` (openers) and `}` `]` (closers) that appear OUTSIDE
 *   - single-quoted strings   '...'   (with `\` escape)
 *   - double-quoted strings   "..."   (with `\` escape)
 *   - template literals       `...`   (with `\` escape; `${…}` braces
 *                                      DO count — they affect JS nesting)
 *   - line comments           // …    (rest of line)
 *   - block comments          /* … * /  (whole region)
 *   - regex literals          /.../flags  (with `\` escape and `[...]`
 *                                      character classes where `/` is
 *                                      literal). `/` in OPERATOR position
 *                                      starts a regex; `/` in VALUE
 *                                      position is the division operator.
 *
 * The regex case matters because patterns frequently use `\[` (escaped
 * literal `[`) and `[\s\S]` (character class) — without protection, the
 * `[` inside the regex gets counted as an array opener and indent leaks.
 * Real-world repro: a `var markers = [ /.../, /.../ ]` array of regex
 * literals in sample/ai_chatbox_js_runtime_send.cfm leaked +3 indent
 * because each regex contributed 2 opens and 1 close.
 *
 * Returns {open, close}. */
function countBracesOutsideStrings(s) {
	var open = 0, close = 0;
	var i = 0;
	var inQ = null;        // null | "'" | '"' | '`'
	var inBlockComment = false;
	// `lastSig` tracks whether the previous significant token was a
	// VALUE (identifier, number, `)`, `]`, string close) or an
	// OPERATOR (`=`, `(`, `,`, `:`, `;`, `+`, `-`, `*`, `/`, ...).
	// `/` starts a regex literal only after an operator (or at line
	// start). Mirrors protectBraceCodeText in deep-format.js.
	var lastSig = null;    // null | 'value' | 'operator'
	while (i < s.length) {
		var c = s[i];
		if (inBlockComment) {
			if (c === '*' && s[i + 1] === '/') { inBlockComment = false; i += 2; continue; }
			i++; continue;
		}
		if (inQ) {
			if (c === '\\') { i += 2; continue; }
			if (c === inQ) { inQ = null; lastSig = 'value'; i++; continue; }
			i++; continue;
		}
		// Line comment — bail until EOL (single-line input → end).
		if (c === '/' && s[i + 1] === '/') break;
		// Block comment — single-line only here (multi-line is handled by
		// the outer beautifier's inBlockComment state).
		if (c === '/' && s[i + 1] === '*') { inBlockComment = true; i += 2; continue; }
		// Regex literal — `/` in operator position (start of expression).
		// Scan forward to matching `/`, respecting `\` escapes and `[...]`
		// character classes (where `/` is literal). Consume trailing flags.
		// If we can't find a closer on this line, treat `/` as a division
		// operator and fall through.
		if (c === '/' && (lastSig === null || lastSig === 'operator')) {
			var rs = i + 1;
			var inClass = false;
			var closed = false;
			while (rs < s.length) {
				var rc = s[rs];
				if (rc === '\\') { rs += 2; continue; }
				if (rc === '\n') break;
				if (rc === '[') inClass = true;
				else if (rc === ']') inClass = false;
				else if (rc === '/' && !inClass) { rs++; closed = true; break; }
				rs++;
			}
			if (closed) {
				while (rs < s.length && /[gimsuy]/.test(s[rs])) rs++;
				i = rs;
				lastSig = 'value';
				continue;
			}
			// Not a closed regex on this line — `/` becomes division.
		}
		if (c === '"' || c === "'" || c === '`') { inQ = c; i++; continue; }
		if (c === ' ' || c === '\t') { i++; continue; }
		if (c === '{' || c === '[') { open++; lastSig = 'operator'; i++; continue; }
		if (c === '}' || c === ']') { close++; lastSig = 'value'; i++; continue; }
		if (c === ')' || /[A-Za-z0-9_$]/.test(c)) { lastSig = 'value'; }
		else { lastSig = 'operator'; }
		i++;
	}
	return { open: open, close: close };
}

/* Count consecutive `}`/`]` characters at the start of `s` (after any
 * leading whitespace, but with NO intervening whitespace between the
 * closers themselves). Used to pre-decrement indentLevel so the line's
 * display position reflects its visual depth.
 *
 * Examples (return value in brackets):
 *   `}`        [1]   — single closer, decrement one
 *   `}}`       [2]   — adjacent closers, decrement two
 *   `} },`     [1]   — second `}` is trailing (separated by space) and
 *                      only contributes to next-line indent, NOT this
 *                      line's display position. This matches the
 *                      common "} },"-on-its-own-line convention where
 *                      the line aligns with the inner close.
 *   `reason:`  [0]   — non-closer leading char */
function leadingClosersOf(s) {
	var n = 0, i = 0;
	while (i < s.length && (s[i] === ' ' || s[i] === '\t')) i++;
	while (i < s.length && (s[i] === '}' || s[i] === ']')) { n++; i++; }
	return n;
}

function beautifyCFML(rawCode, split_html_tag) {

	if(split_html_tag == true){
		rawCode = rawCode.replace(/></g, '>\n<');
	}

	rawCode = splitAdjacentCFMLTags(rawCode);

	var lines = rawCode.split('\n');
	var indentLevel = 0;
	var indentSize = 1; // You can choose the size of indentation you want
	var indentSpace = 0;
	var inMarkupComment = false;
	var inBlockComment = false;
	var commentOrigPrefix = "";
	var commentNewPrefix = "";
	var inMultiLineTag = false;
	var multiLineTagName = "";

	function applyIndent() {
		if(indentLevel != 0 && indentSize != 0){
			indentSpace = indentLevel * indentSize;
		}else{
			indentSpace = 0;
		}
		lines[i] = ''.padStart(indentSpace, '\t') + line;
	}

	for (var i = 0; i < lines.length; i++) {

		/* Initial [start]  */
		if(indentLevel < 0){
			indentLevel = 0;
		}
		var line = lines[i].trim();
		var line_data = line.toLowerCase();

		// Multi-line opening tag continuation: lines after a tag like
		// `<div class="..."` whose `>` is on a later line. Continuation
		// lines (including the line containing the closing `>`) sit at
		// indentLevel = openingLineLevel + 1. After the closing `>`:
		//   - self-close (`/>`), HTML void, or CF inline tag → pop back
		//     to parent level so siblings align with the opener.
		//   - block/regular tag → keep indentLevel at +1 so the tag's
		//     children indent under it; the matching `</tag>` decrements
		//     back to the opener's level via existing logic.
		if (inMultiLineTag) {
			applyIndent();
			if (line.indexOf('>') !== -1) {
				var selfClose = /\/\s*>/.test(line);
				inMultiLineTag = false;
				if (selfClose || HTML_VOID_TAGS.indexOf(multiLineTagName) !== -1 || CF_TAGS.inline.indexOf(multiLineTagName) !== -1) {
					indentLevel -= 1;
				}
				multiLineTagName = "";
			}
			continue;
		}

		var opensMarkupComment = line_data.includes('<!---') || line_data.includes('<!--');
		var closesMarkupComment = line_data.includes('--->') || line_data.includes('-->');
		var opensBlockComment = line_data.startsWith('/*') && !line_data.endsWith('*/');
		var closesBlockComment = line_data.endsWith('*/');

		if (inMarkupComment || inBlockComment) {
			// Shift continuation line's leading whitespace so alignment
			// relative to the opening line is preserved.
			if (lines[i].indexOf(commentOrigPrefix) === 0) {
				lines[i] = commentNewPrefix + lines[i].substring(commentOrigPrefix.length);
			}
			if (inMarkupComment && closesMarkupComment) {
				inMarkupComment = false;
			}
			if (inBlockComment && closesBlockComment) {
				inBlockComment = false;
			}
			continue;
		}

		if (opensMarkupComment && !closesMarkupComment) {
			commentOrigPrefix = (lines[i].match(/^[ \t]*/) || [""])[0];
			applyIndent();
			commentNewPrefix = ''.padStart(indentSpace, '\t');
			inMarkupComment = true;
			continue;
		}

		if (opensBlockComment && !closesBlockComment) {
			commentOrigPrefix = (lines[i].match(/^[ \t]*/) || [""])[0];
			applyIndent();
			commentNewPrefix = ''.padStart(indentSpace, '\t');
			inBlockComment = true;
			continue;
		}

		if (line_data.includes('<!---') && line_data.includes('--->')) {

		}else{
			line_data = line_data.replace("/*", "");
			line_data = line_data.replace("*/", "");
			//line_data = line_data.replace("//", "");
			line_data = line_data.replace("<!---", "");
			line_data = line_data.replace("--->", "");
			line_data = line_data.replace("<!--", "");
			line_data = line_data.replace("-->", "");

			if (line_data.trim().endsWith(';')) {
				line_data = line_data.replace(/\;\s*$/, '');
			}

			if (line_data.trim().endsWith('+')) {
				line_data = line_data.replace(/\+\s*$/, '');
			}

			if (line_data.trim().startsWith('"') && line_data.trim().endsWith('"')) {
				line_data = line_data.replace(/^"/, '');
				line_data = line_data.replace(/"$/, '');
			}

			if (line_data.trim().startsWith("'") && line_data.trim().endsWith("'")) {
				line_data = line_data.replace(/^'/, '');
				line_data = line_data.replace(/'$/, '');
			}

			line_data = line_data.trim();
		}

		var start_width_tag = get_tag_element_start_width(line_data);
		var end_width_tag   = get_tag_element_end_width(line_data);
		var tag_name        = get_tag_name(line_data);
		var maintain_yn     = "n";
		/* Initial [end  ]   */

		// Multi-line opening tag entry: `<tag attr=...` with no `>` on
		// this line. Apply indent at current level, then bump
		// indentLevel by 1 so continuation lines (handled at the top
		// of the next iteration via inMultiLineTag) sit one level
		// deeper than the opener. Skip comment openers — they have
		// their own handling above.
		if (line_data.startsWith("<") && !line_data.includes(">") && tag_name && !line_data.startsWith('<!')) {
			applyIndent();
			multiLineTagName = tag_name;
			inMultiLineTag = true;
			indentLevel += 1;
			continue;
		}

		if (line_data.startsWith("<") && line_data.includes(">")) { // Handle HTML Coldfusion
			/* Maintain [start] */
			if (line_data.startsWith("<") && line_data.includes("/>")) {
				maintain_yn = "y";
			}
			else if (line_data.startsWith(start_width_tag) && line_data.includes(end_width_tag) && start_width_tag != "" && end_width_tag != "") {
				maintain_yn = "y";
			}
			else if (CF_TAGS.inline.includes(tag_name)) {
				maintain_yn = "y";
			}
			else if (HTML_VOID_TAGS.includes(tag_name)) {
				maintain_yn = "y";
			}
			/* Maintain [end  ] */

			/* Decrease [start]   */
			else if (CF_TAGS.middle.includes(tag_name)) {
				indentLevel -= 1;
				applyIndent();
				indentLevel += 1;
				continue;
			}
			else if (line_data.startsWith('</')) {
				indentLevel -= 1;
			}
			/* Decrease [end  ] */

			// indentation
			//lines[i] = ''.padStart(indentLevel * indentSize) + line;
			applyIndent();




			/* Increase [start] */
			if(maintain_yn != "y"){
				if (line_data.startsWith(start_width_tag) && !line_data.includes(end_width_tag) && start_width_tag != "" && end_width_tag != "") {
					if (!tag_name.startsWith('cf') || CF_TAGS.block.includes(tag_name)) {
						indentLevel += 1;
					}
				}
			}
			/* Increase [end  ] */
		}else{ // Handle JavaScript CSS
		/* maintain_yn [start] */
		if(line_data.startsWith("//")){
			maintain_yn = "y";

			// indentation
			//lines[i] = ''.padStart(indentLevel * indentSize) + line;
			applyIndent();
		}
		/* maintain_yn [end  ] */

		if(maintain_yn == "n"){
			/* Balanced brace/bracket counting (JS / CSS / JSON-ish lines).
			 *
			 * The previous heuristic relied on `startsWith("}")` /
			 * `endsWith("{")` / `includes("{") && !includes("}")`. That
			 * mishandles lines like
			 *   `{ skillName: 'x', toolName: 'y',`        (one `{`, no `}`)
			 *   `args: { text: '...',`                    (one `{`, no `}`)
			 *   `reason: "..." } },`                      (two `}`)
			 * because the third line only decremented ONCE for the two
			 * trailing `}`s — so each multi-line object literal in an
			 * array leaks +1 of indent forever. Real-world repro is a
			 * `<cfm>` file containing a pure JS fragment outside any
			 * `<script>` tag (no `formatBraceCode` dispatch in that path).
			 *
			 * Fix: per-line, count `{ [` (openers) and `} ]` (closers)
			 * OUTSIDE of string literals, line comments, and block
			 * comments. Pre-decrement by the number of *leading* closers
			 * (the visual position of the line itself), then post-adjust
			 * indentLevel by the net delta. Algebraically that's just
			 *   indentLevel += (openers - closers)
			 * but the pre-decrement matters because applyIndent() must
			 * see the *display* level (leading-closer-discounted), not
			 * the carry-over level. */
			var braceCounts = countBracesOutsideStrings(line);
			var leadingCl   = leadingClosersOf(line);
			indentLevel -= leadingCl;

			// indentation
			applyIndent();

			indentLevel += (braceCounts.open - braceCounts.close + leadingCl);
		}

	}

	//console.log("line_data." + line_data);
	//console.log("indentLevel." + indentLevel);
}

return lines.join('\n');

}

/* Returns true iff `code` contains a real `<TAG>` (CFML or HTML tag
 * opener) OUTSIDE of: JS strings, JS comments, CFML markup comments
 * (`<!--- --->`), and HTML comments (`<!-- -->`). Used by detectLanguage
 * so bare JS fragments containing HTML tags inside string literals OR
 * wrapped in CFML markup comment banners are NOT misclassified as CFML.
 *
 * What counts as a "real tag" here: `<` followed by alpha or `/` —
 * i.e. `<div`, `</cfquery`, `<cfset`. Crucially, `<!---` and `<!--`
 * are SKIPPED (their entire comment region is consumed) rather than
 * being treated as tag openers. Comment regions don't determine
 * language semantics; only real tags do.
 *
 * Two repros this guards against:
 * 1. `imgHtml += '<div class="..." onclick="open(\'x\')">';` — the JS
 *    string contains both HTML AND a `\'` escape. CFML mode's
 *    splitAdjacentCFMLTags would lose track of the string boundary at
 *    the `\'` and inject newlines before `</div>` mid-string, breaking
 *    the JS at runtime.
 * 2. `<!--- header --->\nfunction f() { … }` — a CFML markup comment
 *    banner followed by bare JS. The banner is just documentation,
 *    not CFML semantics, so the file should route to 'js'.
 *
 * Both fire only when JS escape semantics matter. detection MUST honor
 * JS escapes (\\, \', \", template literals) — the same lexical rules
 * `formatBraceCode` uses. */
function hasTagsOutsideStrings(code) {
	if (typeof code !== 'string') return false;
	var i = 0, n = code.length;
	var inQ = null;        // null | "'" | '"' | '`'
	var inLC = false;       // // line comment
	var inBC = false;       // /* block comment */
	while (i < n) {
		var c = code[i], c2 = code[i + 1];
		if (inLC) { if (c === '\n') inLC = false; i++; continue; }
		if (inBC) { if (c === '*' && c2 === '/') { inBC = false; i += 2; continue; } i++; continue; }
		if (inQ) {
			if (c === '\\') { i += 2; continue; }  // JS escape
			if (c === inQ) { inQ = null; i++; continue; }
			i++; continue;
		}
		if (c === '/' && c2 === '/') { inLC = true; i += 2; continue; }
		if (c === '/' && c2 === '*') { inBC = true; i += 2; continue; }
		// CFML markup comment <!--- ... ---> — consume entire region.
		if (c === '<' && c2 === '!' && code[i + 2] === '-' && code[i + 3] === '-' && code[i + 4] === '-') {
			var endCfm = code.indexOf('--->', i + 5);
			if (endCfm === -1) return false;  // unterminated → trust JS path
			i = endCfm + 4; continue;
		}
		// HTML comment <!-- ... --> — consume entire region.
		if (c === '<' && c2 === '!' && code[i + 2] === '-' && code[i + 3] === '-') {
			var endHtm = code.indexOf('-->', i + 4);
			if (endHtm === -1) return false;
			i = endHtm + 3; continue;
		}
		if (c === '"' || c === "'" || c === '`') { inQ = c; i++; continue; }
		// Real tag opener: `<` + letter or `<` + `/`. NOT `<!` (handled
		// above) and NOT `<` followed by space/digit/punctuation.
		if (c === '<' && c2 && /[a-zA-Z\/]/.test(c2)) return true;
		i++;
	}
	return false;
}

function detectLanguage(code) {
	if (/^\s*(select|insert|update|delete|with|create|alter|drop)\b/i.test(code)) {
		return 'sql';
	}
	// JS detection: strip any leading CFML/HTML/JS comment banner FIRST
	// (so `<!--- header --->\nfunction f()` and `/* file desc */\nvar x =`
	// both route correctly), then check that the post-banner body
	// (a) begins with a JS construct AND (b) has no `<tag>` chars
	// OUTSIDE strings/comments (CFML markup comments are also skipped
	// here so mid-file `<!--- … --->` documentation doesn't disqualify).
	//
	// Construct prefix list includes common control-flow keywords
	// (if/for/while/do/switch/return/throw/try) plus bare `(` `[` `{`
	// for IIFEs, arrays, object exports.
	//
	// Why this routing matters (data-loss-class fix, not aesthetic):
	// CFML mode's splitAdjacentCFMLTags uses CFML string semantics
	// (`\` is literal, NOT an escape). When that walker encounters a
	// JS string containing `\'` or `\"` (real-world repro:
	// `'<div onclick="open(\'x\')">'`) it loses track of the string
	// boundary and starts treating subsequent `<div>` etc. inside the
	// string as real tags — injecting newlines INSIDE the JS string
	// literal at runtime. Routing to 'js' lets formatBraceCode (which
	// has proper JS escape handling) preserve the strings verbatim.
	var jsPrefix = /^\s*(\/\/|\/\*|function\b|var\b|let\b|const\b|class\b|import\b|export\b|async\b|if\b|for\b|while\b|do\b|switch\b|return\b|throw\b|try\b|\(\s*\)\s*=>|[\[{(])/;
	var bodyAfterBanner = (typeof splitLeadingCommentBlock === 'function')
		? splitLeadingCommentBlock(code).body
		: code;
	if (jsPrefix.test(bodyAfterBanner) && !hasTagsOutsideStrings(code)) {
		return 'js';
	}
	return 'cfml';
}

/* Strip leading CFML markup comments + JS block/line comments from `code`
 * and return {leading, body}. Lets formatJsWithLeadingComments preserve
 * file-header comments verbatim while still routing the JS body through
 * formatBraceCode (which would otherwise reflow indentation inside the
 * comment regions or skip them entirely depending on token-protection).
 *
 * `leading` includes the trailing newline(s) after the last comment so
 * the body's first line starts at column 0. */
function splitLeadingCommentBlock(code) {
	var i = 0;
	var n = code.length;
	while (i < n) {
		// Skip whitespace
		while (i < n && (code[i] === ' ' || code[i] === '\t' || code[i] === '\n' || code[i] === '\r')) i++;
		if (i >= n) break;
		// CFML markup comment <!--- ... --->
		if (code.substr(i, 5) === '<!---') {
			var endC = code.indexOf('--->', i + 5);
			if (endC === -1) break;
			i = endC + 4;
			continue;
		}
		// HTML comment <!-- ... -->
		if (code.substr(i, 4) === '<!--') {
			var endH = code.indexOf('-->', i + 4);
			if (endH === -1) break;
			i = endH + 3;
			continue;
		}
		// JS block comment /* ... */
		if (code.substr(i, 2) === '/*') {
			var endB = code.indexOf('*/', i + 2);
			if (endB === -1) break;
			i = endB + 2;
			continue;
		}
		// JS line comment // ...
		if (code.substr(i, 2) === '//') {
			var endL = code.indexOf('\n', i + 2);
			if (endL === -1) { i = n; break; }
			i = endL;
			continue;
		}
		break;
	}
	return {
		leading: code.slice(0, i),
		body: code.slice(i)
	};
}

/* Format JS-mode input: pass through formatBraceCode, but preserve any
 * leading CFML markup / JS comment header verbatim. This is what makes
 * routing files like sample/ai_chatbox_js_runtime_*.cfm (CFML comment
 * header + bare JS) safe — the comments don't go through brace splitting
 * (which would mangle them) but the JS body gets the full treatment. */
function formatJsWithLeadingComments(code) {
	if (typeof formatBraceCode !== 'function') return code;
	var split = splitLeadingCommentBlock(code);
	if (split.body.trim() === '') {
		// All comments / whitespace — return as-is.
		return code;
	}
	// Normalize trailing whitespace on the leading block to exactly one
	// newline so the boundary is predictable and idempotent.
	var leading = split.leading.replace(/[ \t\r\n]+$/, '');
	var body = formatBraceCode(split.body, false);
	if (leading === '') return body;
	return leading + '\n' + body;
}

function beautifyCodes() {
	var split_html_tag = document.getElementById('split_html_tag').checked;
	var auto_copy = document.getElementById('auto_copy').checked;
	var auto_clear = document.getElementById('auto_clear').checked;
	var auto_clear_output = document.getElementById('auto_clear_output').checked;
	var deep_sql = document.getElementById('deep_sql').checked;
	var deep_css = document.getElementById('deep_css').checked;
	var deep_js = document.getElementById('deep_js').checked;
	var proSqlEl = document.getElementById('pro_sql');
	var pro_sql = proSqlEl ? proSqlEl.checked : false;
	var dialectEl = document.getElementById('pro_sql_dialect');
	var pro_sql_dialect = dialectEl ? dialectEl.value : 'sql';
	var rawCode = document.getElementById('input').value;
	var output = document.getElementById('output');
	var language = document.getElementById('language').value;

	if(language == 'auto'){
		language = detectLanguage(rawCode);
	}

	function finishOutput() {
		var copied = false;
		if(auto_copy == true){
			copied = copy_output_data();
		}
		if(auto_clear == true){
			document.getElementById('input').value = '';
		}
		if(auto_clear_output == true && (auto_copy != true || copied == true)){
			output.value = '';
		}
	}

	function runFormat() {
		if(language == 'js'){
			// Bare JS path — routes through formatBraceCode (deep-format.js)
			// instead of beautifyCFML's per-line brace counter. Wins:
			//   - Template literals  `..${x}..`     parsed correctly, including
			//     nested `${ {a:1} }` expressions.
			//   - Regex literals     /\d+/g         not mistaken for division.
			//   - String content     "if(x){y}"     not counted as braces.
			//   - Parens groups      (a, b, c)     held together, not split.
			// Leading CFML/HTML/JS comment header is preserved verbatim so
			// files like sample/ai_chatbox_js_runtime_*.cfm (CFML comment
			// banner + bare JS) round-trip safely.
			output.value = formatJsWithLeadingComments(rawCode);
		}else if(language == 'sql'){
			var canUseProDirect = pro_sql
				&& typeof formatProSQLSync === 'function'
				&& typeof isProSQLLoaded === 'function'
				&& isProSQLLoaded()
				&& !(typeof bodyHasStructuralCFMLControlFlow === 'function' && bodyHasStructuralCFMLControlFlow(rawCode));
			if (canUseProDirect) {
				try {
					output.value = formatProSQLSync(rawCode, pro_sql_dialect);
				} catch (err) {
					if (typeof console !== 'undefined' && console.warn) {
						console.warn('[beautifier] Pro SQL direct mode threw, falling back to built-in beautifySQL. Error:', err && err.message, '\nDialect:', pro_sql_dialect, '\nSQL excerpt:', rawCode.slice(0, 400));
					}
					output.value = beautifySQL(rawCode);
				}
			} else {
				output.value = beautifySQL(rawCode);
			}
		}else{
			var result = beautifyCFML(rawCode, split_html_tag);
			if(deep_sql || deep_css || deep_js){
				result = deepFormatEmbedded(result, {
					sql: deep_sql,
					css: deep_css,
					js: deep_js,
					sqlPro: pro_sql,
					sqlDialect: pro_sql_dialect
				}, rawCode);
			}
			output.value = result;
		}
		finishOutput();
	}

	if (pro_sql && typeof ensureProSQL === 'function' && (!(typeof isProSQLLoaded === 'function') || !isProSQLLoaded())) {
		ensureProSQL().then(runFormat).catch(function(err) {
			console.warn('[pro-sql] load failed, falling back to built-in formatter:', err);
			runFormat();
		});
		return;
	}

	runFormat();
}
