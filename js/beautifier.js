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
 * Returns extended shape:
 *   {open, close}                  — aggregate {} + [] counts (back-compat)
 *   {braceOpen, braceClose}        — only {}
 *   {bracketOpen, bracketClose}    — only []
 *   {parenOpen, parenClose}        — only ()
 *   {lastTerm}                     — last non-ws masked token (',?:&&||+-* / =([{=>.<>!~^%' or '')
 *   {firstTerm}                    — first non-ws masked token if ∈ joiner set
 *                                    ({':','?','&&','||',',','.','+','-',')',']','}'}), else ''
 * Used by isContinuationLine() for detect-and-anchor continuation alignment. */
function countBracesOutsideStrings(s) {
	var braceOpen = 0, braceClose = 0;
	var bracketOpen = 0, bracketClose = 0;
	var parenOpen = 0, parenClose = 0;
	var lastTerm = '';
	var firstTerm = '';
	var firstTermCaptured = false;
	var JOINER = {':':1,'?':1,'&&':1,'||':1,',':1,'.':1,'+':1,'-':1,')':1,']':1,'}':1};
	function setTerm(t) {
		lastTerm = t;
		if (!firstTermCaptured) {
			firstTermCaptured = true;
			if (JOINER[t]) firstTerm = t;
		}
	}
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
			if (c === inQ) { inQ = null; lastSig = 'value'; setTerm('STR'); i++; continue; }
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
				setTerm('REGEX');
				continue;
			}
			// Not a closed regex on this line — `/` becomes division.
		}
		if (c === '"' || c === "'" || c === '`') { inQ = c; i++; continue; }
		if (c === ' ' || c === '\t') { i++; continue; }
		if (c === '{') { braceOpen++;   lastSig = 'operator'; setTerm('{'); i++; continue; }
		if (c === '[') { bracketOpen++; lastSig = 'operator'; setTerm('['); i++; continue; }
		if (c === '(') { parenOpen++;   lastSig = 'operator'; setTerm('('); i++; continue; }
		if (c === '}') { braceClose++;   lastSig = 'value'; setTerm('}'); i++; continue; }
		if (c === ']') { bracketClose++; lastSig = 'value'; setTerm(']'); i++; continue; }
		if (c === ')') { parenClose++;   lastSig = 'value'; setTerm(')'); i++; continue; }
		// Multi-char operators — peek ahead so `&&`, `||`, `=>`, `==`, `===`,
		// `!=`, `<=`, `>=` are classified correctly. `==`/`===`/`!=`/`!==`
		// are NOT open terminals (they yield a value); `&&`/`||`/`=>` ARE.
		if (c === '&' && s[i + 1] === '&') { setTerm('&&'); lastSig = 'operator'; i += 2; continue; }
		if (c === '|' && s[i + 1] === '|') { setTerm('||'); lastSig = 'operator'; i += 2; continue; }
		if (c === '=' && s[i + 1] === '>') { setTerm('=>'); lastSig = 'operator'; i += 2; continue; }
		if (c === '=' && s[i + 1] === '=') {
			var eq = (s[i + 2] === '=') ? 3 : 2;
			setTerm('=='); lastSig = 'operator'; i += eq; continue;
		}
		if (c === '!' && s[i + 1] === '=') {
			var ne = (s[i + 2] === '=') ? 3 : 2;
			setTerm('!='); lastSig = 'operator'; i += ne; continue;
		}
		if (/[A-Za-z0-9_$]/.test(c)) {
			// Identifier / number run — collect, classify as value.
			var js = i;
			while (i < s.length && /[A-Za-z0-9_$]/.test(s[i])) i++;
			setTerm(s.substring(js, i));
			lastSig = 'value';
			continue;
		}
		// Single-char operators / punctuation.
		setTerm(c);
		lastSig = 'operator';
		i++;
	}
	return {
		open:         braceOpen + bracketOpen,    // back-compat aggregate
		close:        braceClose + bracketClose,  // back-compat aggregate
		braceOpen:    braceOpen,
		braceClose:   braceClose,
		bracketOpen:  bracketOpen,
		bracketClose: bracketClose,
		parenOpen:    parenOpen,
		parenClose:   parenClose,
		lastTerm:     lastTerm,
		firstTerm:    firstTerm
	};
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

/* Column (in character cells, tab = 1 cell) of the first non-whitespace
 * char of `s`. Returns s.length when the line is all whitespace.
 * Tab/space both count as 1 cell — parent and child are measured the
 * same way, so the delta reflects original visual difference without
 * needing to expand tabs to a particular width. */
function getLeadingCol(s) {
	var i = 0;
	while (i < s.length && (s[i] === ' ' || s[i] === '\t')) i++;
	return i;
}

/* Continuation-line classifier. A line is a continuation iff ANY of:
 *   (a) prior logical line's lastTerm is in OPEN_TERMS (trailing-open)
 *   (b) current line's firstTerm is in JOINER (leading-joiner; already
 *       filtered by countBracesOutsideStrings → only non-empty when
 *       firstTerm is a joiner)
 *   (c) paren/bracket depth at line start > 0 (unclosed expression)
 * Returns true iff this line should anchor to the prior parent's column.
 *
 * `{` is deliberately OMITTED from OPEN_TERMS: in JS, a line-trailing `{`
 * almost always opens a statement block whose body is NOT a continuation
 * (its own indent comes from indentLevel++ via braceCounts.open). Object-
 * literal `{` continuations are still caught via the parenDepth>0 signal
 * (when the literal is an argument or array element) or via the next
 * line's firstTerm being a joiner (`,` / `}`). */
function isContinuationLine(tokens, prevLastTerm, parenDepth, bracketDepth) {
	var OPEN_TERMS = {
		',':1,'?':1,':':1,'&&':1,'||':1,'+':1,'-':1,
		'*':1,'/':1,'=':1,'(':1,'[':1,'=>':1,'.':1
	};
	if (prevLastTerm && OPEN_TERMS[prevLastTerm]) return true;
	if (tokens.firstTerm) return true;
	if (parenDepth > 0 || bracketDepth > 0) return true;
	return false;
}

/* Classify each line of a JS body as continuation or non-continuation,
 * remembering each cont line's parent (the last non-cont line). Used by
 * preserveContinuationAlignmentPostPass to re-apply column alignment
 * after formatBraceCode produces canonical tab-indent output.
 *
 * Returns an array parallel to `lines` with entries:
 *   { trimmed, isCont, parentIdx, isBlank }
 * Blank/comment-only lines are skipped for cont state but get an entry
 * with isBlank:true so the caller can index by lineNo. */
function computeJsLineClassification(lines) {
	var out = new Array(lines.length);
	var parenDepth = 0, bracketDepth = 0;
	var prevLastTerm = '';
	var parentIdx = -1;
	var inBlockComment = false;
	var inCfmlComment = false;
	for (var i = 0; i < lines.length; i++) {
		var line = lines[i];
		var trimmed = line.trim();
		if (trimmed === '') { out[i] = { isBlank: true }; continue; }

		/* CFML markup comment tracker — `<!--- ... --->` (and HTML
		 * `<!-- ... -->`). Mid-file CFML comments are common in legacy
		 * ColdFusion files (dated change tags) and would otherwise be
		 * tokenized as code by countBracesOutsideStrings, polluting
		 * paren/bracket depth and lastTerm tracking. */
		if (inCfmlComment) {
			if (trimmed.indexOf('--->') >= 0 || trimmed.indexOf('-->') >= 0) {
				inCfmlComment = false;
			}
			out[i] = { isBlank: true };
			continue;
		}
		var cfOpenIdx  = trimmed.indexOf('<!---');
		var cfCloseIdx = trimmed.indexOf('--->');
		if (cfOpenIdx === -1) {
			cfOpenIdx  = trimmed.indexOf('<!--');
			cfCloseIdx = trimmed.indexOf('-->');
		}
		if (cfOpenIdx >= 0 && cfCloseIdx < cfOpenIdx) {
			inCfmlComment = true;
			out[i] = { isBlank: true };
			continue;
		}
		if (cfOpenIdx >= 0 && cfCloseIdx >= 0 && cfCloseIdx > cfOpenIdx
		    && cfOpenIdx === 0
		    && trimmed.length === cfCloseIdx + (trimmed.substr(cfCloseIdx, 4) === '--->' ? 4 : 3)) {
			/* Whole line is a single-line CFML comment. */
			out[i] = { isBlank: true };
			continue;
		}

		/* Crude JS block-comment tracker — sufficient because JS block
		 * comments cannot contain a close-marker mid-comment and cannot
		 * nest. Comment-internal lines do not update cont state. */
		var commentOpenIdx  = trimmed.indexOf('/*');
		var commentCloseIdx = trimmed.indexOf('*/');
		if (inBlockComment) {
			if (commentCloseIdx >= 0) inBlockComment = false;
			out[i] = { isBlank: true };
			continue;
		}
		if (commentOpenIdx >= 0 && commentCloseIdx < commentOpenIdx) {
			inBlockComment = true;
			out[i] = { isBlank: true };
			continue;
		}
		if (trimmed.indexOf('//') === 0) {
			out[i] = { isBlank: true };
			continue;
		}

		var tokens = countBracesOutsideStrings(trimmed);
		var isCont = (parentIdx >= 0)
			&& isContinuationLine(tokens, prevLastTerm, parenDepth, bracketDepth);

		out[i] = {
			trimmed:   trimmed,
			isCont:    isCont,
			parentIdx: isCont ? parentIdx : -1,
			isBlank:   false
		};

		if (!isCont) {
			parentIdx = i;
		}
		parenDepth   += tokens.parenOpen   - tokens.parenClose;
		bracketDepth += tokens.bracketOpen - tokens.bracketClose;
		if (parenDepth   < 0) parenDepth   = 0;
		if (bracketDepth < 0) bracketDepth = 0;
		prevLastTerm = tokens.lastTerm;
	}
	return out;
}

/* Post-pass: re-applies the original author's continuation column
 * alignment on top of formatBraceCode's canonical-tab output, so that
 *
 *     var rows = Array.isArray(raw.data)    ? raw.data
 *              : Array.isArray(raw.rows)    ? raw.rows;
 *
 * survives the bare-JS-in-CFM beautify path (detectLanguage='js' →
 * formatJsWithLeadingComments → formatBraceCode), which previously
 * collapsed the 9-space `:` alignment to a single tab.
 *
 * Strategy: build a FIFO queue of continuation lines from the original
 * input — each entry holds the line's trimmed content + the raw-prefix
 * delta from its parent line. Walk the formatted output; whenever a
 * continuation line in the formatted output trim-matches the next
 * queue entry, splice in `parentFormattedPrefix + extraWs + trimmed`.
 *
 * Conservative: lines that don't match are left as formatBraceCode
 * produced them. Order-preserving: queue is FIFO so duplicate trim
 * contents (e.g., repeated `: x` in two unrelated chains) still pair up
 * left-to-right between original and formatted. */
function preserveContinuationAlignmentPostPass(formatted, original) {
	var oLines = original.split('\n');
	var fLines = formatted.split('\n');
	var oClass = computeJsLineClassification(oLines);
	var fClass = computeJsLineClassification(fLines);

	/* Build FIFO of original continuation lines with their extra-prefix
	 * relative to the parent.
	 *
	 * Conservative gate (v7.1.1 fine-tuning): ONLY enqueue lines whose
	 * first non-whitespace char is an explicit joiner token. This rules
	 * out body lines inside parens (e.g. callback bodies in
	 * `subscribe(function(evt) { body... })`) which my paren-depth
	 * classifier flags as continuations but where the author did NOT
	 * intend column alignment — they're just nested statements that
	 * formatBraceCode should reflow canonically. The narrower gate
	 * preserves the cases we DO care about (ternary `:`, concat `+`,
	 * boolean `&&`/`||`, comma-leading `,`) without over-reaching. */
	/* First-char gate — only enqueue lines whose first non-ws character
	 * is an unambiguous **expression-continuation operator**:
	 *   `:` `?` `,` `.` `+` `-` `&` `|`
	 *
	 * Closers (`}` `]` `)`) are deliberately excluded: formatBraceCode
	 * may reorganize structure (e.g. split `var x = { a:1, b:2 };` so
	 * `{` lives on its own line), at which point the author's original
	 * "close at column N" intent becomes ambiguous in the new layout.
	 * Letting formatBraceCode's canonical close-indent stand is the
	 * safest call; if the original structure WASN'T split, the closer
	 * naturally lands at the canonical level anyway. */
	var OPERATOR_FIRSTCHAR = {':':1, '?':1, ',':1, '.':1, '+':1, '-':1, '&':1, '|':1};
	var queue = [];
	for (var oi = 0; oi < oClass.length; oi++) {
		var info = oClass[oi];
		if (!info || info.isBlank || !info.isCont) continue;
		var firstChar = info.trimmed.charAt(0);
		if (!OPERATOR_FIRSTCHAR[firstChar]) continue;
		var parentLn  = oLines[info.parentIdx] || '';
		var childLn   = oLines[oi];
		var parentPfx = (parentLn.match(/^[ \t]*/) || [''])[0];
		var childPfx  = (childLn.match(/^[ \t]*/)  || [''])[0];
		var extra;
		if (childPfx.indexOf(parentPfx) === 0) {
			extra = childPfx.substring(parentPfx.length);
		} else {
			var delta = childPfx.length - parentPfx.length;
			extra = delta > 0 ? new Array(delta + 1).join(' ') : '';
		}
		if (extra === '') continue;
		queue.push({ trimmed: info.trimmed, extra: extra });
	}

	if (queue.length === 0) return formatted;

	/* Walk formatted output. For each continuation line whose trim
	 * matches the queue head, splice in preserved alignment. */
	for (var fi = 0; fi < fClass.length; fi++) {
		if (queue.length === 0) break;
		var fInfo = fClass[fi];
		if (!fInfo || fInfo.isBlank || !fInfo.isCont) continue;
		if (fInfo.trimmed !== queue[0].trimmed) continue;
		var head = queue.shift();
		var fParent = fLines[fInfo.parentIdx] || '';
		var fParentPfx = (fParent.match(/^[ \t]*/) || [''])[0];
		fLines[fi] = fParentPfx + head.extra + fInfo.trimmed;
	}

	return fLines.join('\n');
}

function beautifyCFML(rawCode, split_html_tag, preserve_continuation_alignment) {

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

	/* Detect-and-anchor continuation alignment state.
	 *   preserveContAlign       — config gate (UI checkbox, default ON)
	 *   inJsBlock               — true only inside <script>...</script>;
	 *                             gates SQL/<cfquery> from leaking into
	 *                             continuation logic (Risk R3 in plan).
	 *   parenDepth/bracketDepth — running ()/[] depth across JS lines;
	 *                             {} depth lives in indentLevel.
	 *   prevLastTerm            — lastTerm of prior non-comment JS line
	 *                             (open terminal triggers continuation).
	 *   parentAnchorOrigPrefix  — raw leading-whitespace prefix string of
	 *                             the most recent non-continuation JS
	 *                             line; '' = no anchor recorded yet.
	 *                             Stored as a STRING (not a column count)
	 *                             so we can slice the continuation's
	 *                             extra-whitespace verbatim — preserving
	 *                             tab-vs-space choice in alignment.
	 *   parentAnchorActive      — explicit flag (since '' is a valid
	 *                             prefix for col-0 parents).
	 *   parentAnchorIndentLevel — indentLevel at which parent was emitted
	 *                             (so continuation can inherit it). */
	var preserveContAlign = (preserve_continuation_alignment === undefined)
		? true : !!preserve_continuation_alignment;
	/* `inJsBlock` defaults TRUE so bare-JS-in-.cfm files (no enclosing
	 * <script> wrapper — common in legacy ColdFusion projects where JS
	 * fragments live directly inside .cfm files with CFML comment
	 * headers) get continuation alignment too. Toggled OFF only inside
	 * <cfquery> (SQL) and <style> (CSS) regions, where the JS-shaped
	 * continuation classifier would misfire. */
	var inJsBlock = true;
	var parenDepth = 0;
	var bracketDepth = 0;
	var prevLastTerm = '';
	var parentAnchorOrigPrefix = '';
	var parentAnchorActive = false;
	var parentAnchorIndentLevel = 0;

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
		/* Capture original leading whitespace BEFORE trim — needed by
		 * continuation alignment to compute the relative prefix from
		 * the parent anchor. Stored as a raw string (not column count)
		 * so tab-vs-space mixture is preserved verbatim when sliced. */
		var origCol    = getLeadingCol(lines[i]);
		var origPrefix = lines[i].substring(0, origCol);
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

			/* inJsBlock boundary tracking (Risk R3 gate). Toggle when we
			 * see <script> open or </script> close. Reset continuation
			 * state on entry AND exit so a fresh script body starts with
			 * no anchor, and SQL/markup that follows is never accidentally
			 * classified as a continuation of dangling JS state. */
			/* Tag boundaries that affect inJsBlock + reset continuation
			 * state. <script>: always JS, reset anchors on entry/exit.
			 * <cfquery>/<style>: NOT JS, suppress continuation logic
			 * inside the body. Other tags don't change inJsBlock. */
			if (tag_name === 'script') {
				inJsBlock = true;
				parenDepth = 0;
				bracketDepth = 0;
				prevLastTerm = '';
				parentAnchorOrigPrefix  = '';
				parentAnchorActive      = false;
				parentAnchorIndentLevel = 0;
			} else if (tag_name === 'cfquery' || tag_name === 'style') {
				if (line_data.startsWith('</')) {
					inJsBlock = true;
				} else {
					inJsBlock = false;
				}
				parenDepth = 0;
				bracketDepth = 0;
				prevLastTerm = '';
				parentAnchorOrigPrefix  = '';
				parentAnchorActive      = false;
				parentAnchorIndentLevel = 0;
			}

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

			/* Detect-and-anchor continuation alignment. Three OR'd signals
			 * (see isContinuationLine): prior line ends in open terminal,
			 * current line starts with joiner, or unclosed ()/[] depth.
			 * Only active inside <script>...</script> (inJsBlock gate)
			 * with at least one anchor recorded.
			 *
			 * Emission strategy — preserve the *raw whitespace* suffix
			 * that the child added beyond the parent's prefix, so the
			 * author's tab/space mixture survives verbatim:
			 *   parentNewPrefix + (childOrigPrefix - parentOrigPrefix) + trim(line)
			 * When the child's prefix doesn't start with the parent's
			 * (different whitespace style), fall back to space-padding by
			 * the column delta. When delta is negative (child outdented
			 * past parent, e.g. `})` on its own line), fall back to
			 * applyIndent so leadingClosersOf pre-decrement applies. */
			var isCont = preserveContAlign
				&& inJsBlock
				&& parentAnchorActive
				&& isContinuationLine(braceCounts, prevLastTerm, parenDepth, bracketDepth);

			if (isCont) {
				var extraWs;
				if (origPrefix.indexOf(parentAnchorOrigPrefix) === 0) {
					extraWs = origPrefix.substring(parentAnchorOrigPrefix.length);
				} else {
					var deltaCols = origCol - parentAnchorOrigPrefix.length;
					extraWs = deltaCols > 0 ? ' '.repeat(deltaCols) : '';
				}
				/* Bail to applyIndent when:
				 *   (a) child outdented past parent (delta < 0), or
				 *   (b) child has same prefix as parent (extraWs empty) —
				 *       implies child is at parent's level, NOT extending
				 *       it; pre-decrement via leadingClosersOf must apply
				 *       (e.g. bare `}` closing a function block where the
				 *       parent is a prior statement at the same column). */
				if (origCol < parentAnchorOrigPrefix.length || extraWs === '') {
					applyIndent();
					if (inJsBlock) {
						parentAnchorOrigPrefix  = origPrefix;
						parentAnchorActive      = true;
						parentAnchorIndentLevel = indentLevel;
					}
				} else {
					indentSpace = parentAnchorIndentLevel * indentSize;
					lines[i] = ''.padStart(indentSpace, '\t') + extraWs + line;
					// Anchor unchanged — chain continues to same parent.
				}
			} else {
				applyIndent();
				if (inJsBlock) {
					parentAnchorOrigPrefix  = origPrefix;
					parentAnchorActive      = true;
					parentAnchorIndentLevel = indentLevel;
				}
			}

			/* Update running state for next iteration's continuation
			 * classifier. Floor depths at 0 to recover gracefully from
			 * stray closers without a matching opener (e.g. mid-string
			 * `)` that the regex masker missed). */
			parenDepth   += braceCounts.parenOpen   - braceCounts.parenClose;
			bracketDepth += braceCounts.bracketOpen - braceCounts.bracketClose;
			if (parenDepth   < 0) parenDepth   = 0;
			if (bracketDepth < 0) bracketDepth = 0;
			prevLastTerm = braceCounts.lastTerm;

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
	// `lastSig` tracks whether the previous significant token was a
	// VALUE (identifier, number, `)`, `]`, string close) or an OPERATOR
	// (`=`, `(`, `,`, `:`, `;`, `+`, etc.). `/` in operator position
	// starts a regex literal — its body is opaque (in particular `'`/`"`
	// inside the regex are NOT string delimiters). `/` in value position
	// is the division operator. Without this, a line like
	//   src.domain.replace(/'/g, '')
	// loses string parity: walker enters a "fake string" at the `'`
	// inside `/'/g`, exits on the next real `'`, and from then on every
	// `<TAG>` it sees is mis-classified as "outside a string". Real-
	// world repro: sample/ai_chatbox_js_runtime_send.cfm L177 — without
	// regex protection, detectLanguage incorrectly returned 'cfml' for
	// a bare-JS file, triggering the same content-corruption pipeline
	// commits 8bf1843 and 6e668e8 already partially fixed.
	var lastSig = null;    // null | 'value' | 'operator'
	while (i < n) {
		var c = code[i], c2 = code[i + 1];
		if (inLC) { if (c === '\n') inLC = false; i++; continue; }
		if (inBC) { if (c === '*' && c2 === '/') { inBC = false; i += 2; continue; } i++; continue; }
		if (inQ) {
			if (c === '\\') { i += 2; continue; }  // JS escape
			if (c === inQ) { inQ = null; lastSig = 'value'; i++; continue; }
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
		// Regex literal — `/` in operator position. Scan to matching `/`
		// respecting `\` escapes and `[...]` character classes (where
		// `/` is literal). Mirrors the same logic in
		// countBracesOutsideStrings.
		if (c === '/' && (lastSig === null || lastSig === 'operator')) {
			var rs = i + 1, inClass = false, closed = false;
			while (rs < n) {
				var rc = code[rs];
				if (rc === '\\') { rs += 2; continue; }
				if (rc === '\n') break;
				if (rc === '[') inClass = true;
				else if (rc === ']') inClass = false;
				else if (rc === '/' && !inClass) { rs++; closed = true; break; }
				rs++;
			}
			if (closed) {
				while (rs < n && /[gimsuy]/.test(code[rs])) rs++;
				i = rs;
				lastSig = 'value';
				continue;
			}
			// Not a closed regex on this line — `/` becomes division.
		}
		if (c === '"' || c === "'" || c === '`') { inQ = c; i++; continue; }
		// Real tag opener: `<` + letter or `<` + `/`. NOT `<!` (handled
		// above) and NOT `<` followed by space/digit/punctuation.
		if (c === '<' && c2 && /[a-zA-Z\/]/.test(c2)) return true;
		// Update lastSig for next iteration.
		if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
		if (c === ')' || c === ']' || /[A-Za-z0-9_$]/.test(c)) { lastSig = 'value'; }
		else { lastSig = 'operator'; }
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

// Strip leading CFML/HTML markup comments from `code` and return
// {leading, body}. CFML markup <!--- ---> and HTML <!-- --> are
// peeled off because formatBraceCode doesn't understand those —
// they're emitted verbatim back at the top of the output.
//
// JS-style comments (block /* ... */ and line //) are NOT peeled.
// They stay in the body where protectBraceCodeText /
// restoreBraceCodeText handle them — including the multi-line block
// comment re-indent that aligns continuation lines with the current
// output baseIndent (introduced 2026-05-14 commit-followup).
// Previously we peeled all 4 comment forms into `leading`, which got
// emitted verbatim and kept the source's outer-wrap indent even
// after the body was dedented — producing a comment at indent 1
// above code at indent 0. Real-world repro:
// sample/ai_chatbox_js_runtime_send.cfm L14-16 block comment.
//
// `leading` includes the trailing newline(s) after the last
// <!--- ---> / <!-- --> so the body's first line starts at column 0.
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

	/* v7.1.1 — formatBraceCode emits canonical tab-indent and strips any
	 * column alignment the author used on continuation lines (ternary
	 * chains, +-concat, &&||, comma-leading). Re-apply preservation as
	 * a post-pass over the ORIGINAL split.body. Gated by the same UI
	 * checkbox as beautifyCFML's inline path. */
	var preserveEl = (typeof document !== 'undefined' && document.getElementById)
		? document.getElementById('preserve_continuation_alignment')
		: null;
	var preserveContAlign = preserveEl ? !!preserveEl.checked : true;
	if (preserveContAlign && typeof preserveContinuationAlignmentPostPass === 'function') {
		body = preserveContinuationAlignmentPostPass(body, split.body);
	}

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
	var preserveContEl = document.getElementById('preserve_continuation_alignment');
	var preserve_continuation_alignment = preserveContEl ? preserveContEl.checked : true;
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
			var result = beautifyCFML(rawCode, split_html_tag, preserve_continuation_alignment);
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
