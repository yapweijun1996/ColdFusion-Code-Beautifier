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
function countBracesOutsideStrings(s, options) {
	var useJsStringEscapes = !options || options.useJsStringEscapes !== false;
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
			if (useJsStringEscapes && c === '\\') { i += 2; continue; }
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

/* Count consecutive CFML expression closers — ) ] } — at the start of a
 * trimmed continuation line (after any leading whitespace). Used by the
 * inline-tag paren-depth indent path to pre-decrement the displayed depth
 * so a line like `),` sits at the same column as its matching opener. */
function leadingCloseTokensOf(s) {
	var n = 0, i = 0;
	while (i < s.length && (s[i] === ' ' || s[i] === '\t')) i++;
	while (i < s.length && (s[i] === ')' || s[i] === ']' || s[i] === '}')) { n++; i++; }
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

/* Returns true when a CFML/HTML tag-closing `>` appears outside quoted
 * text. Multi-line tags can contain HTML snippets inside CFML strings, e.g.
 * `valueHtml : '<span>...</span>'`; those inner `>` chars must not end the
 * outer `<cfset ...` tag. */
function hasTagCloseOutsideStrings(s) {
	var quote = null;
	for (var i = 0; i < s.length; i++) {
		var c = s[i];
		if (quote) {
			if (c === quote) {
				if (s[i + 1] === quote) { i++; continue; }
				quote = null;
			}
			continue;
		}
		/* Skip markup-comment spans so a `>` inside `<!--- ... --->`
		 * (or HTML `<!-- ... -->`) is NOT mistaken for a tag-closing `>`.
		 * Without this, a continuation line of a multi-line tag such as
		 *   <cfset _msg = {
		 *       "k": v, <!--- note --->
		 * is misread as closing the <cfset> tag (the `>` in `--->`), which
		 * pops indentLevel early and collapses the rest of the struct.
		 * `<!---` (CFML, 5 chars) must be tested before `<!--` (HTML, 4). */
		if (c === '<' && s.substr(i, 5) === '<!---') {
			var endC = s.indexOf('--->', i + 5);
			if (endC === -1) return false; // unterminated → no tag close after
			i = endC + 3;                  // loop's i++ lands past `--->`
			continue;
		}
		if (c === '<' && s.substr(i, 4) === '<!--') {
			var endH = s.indexOf('-->', i + 4);
			if (endH === -1) return false;
			i = endH + 2;
			continue;
		}
		if (c === '"' || c === "'") {
			quote = c;
			continue;
		}
		if (c === '>') return true;
	}
	return false;
}

/* String-state-carrying scan of ONE physical line of a multi-line tag,
 * looking for the tag-closing `>`. Unlike hasTagCloseOutsideStrings (which
 * assumes every line starts OUTSIDE any string), this threads the open-quote
 * state from the previous continuation line via `startQuote`.
 *
 * Why it matters — a multi-line CFML tag whose expression contains a string
 * literal that spans lines, e.g.
 *     <cfset q = dbgQuery(
 *         "SELECT ... WHERE created >= now()      <- `>=` is INSIDE the string
 *          ... FROM t", _dsn)>                    <- closing `"` then real `>`
 * With per-line isolation the SQL `>` is mistaken for the tag close (false
 * early close, indent drops a line early) AND the closing `"` is mistaken for
 * an opening quote (so the real trailing `>` is hidden → the tag is never
 * recognised as closed → its +1 continuation indent leaks to every following
 * sibling until some later line happens to expose a bare `>`). Carrying the
 * quote state fixes both.
 *
 * CFML escapes quotes by doubling ("" / ''), so a doubled quote stays inside
 * the string. Markup-comment spans are skipped (their `>`/quotes are inert)
 * but only when OUTSIDE a string. Returns { closes, endQuote }: `closes` is
 * true once a `>` is seen outside strings/comments — that `>` ends the tag so
 * endQuote is irrelevant (caller exits multi-line mode); otherwise `endQuote`
 * is the open-quote char to carry into the next line, or null. */
function scanMultiLineTagClose(s, startQuote) {
	var quote = startQuote || null;
	for (var i = 0; i < s.length; i++) {
		var c = s[i];
		if (quote) {
			if (c === quote) {
				if (s[i + 1] === quote) { i++; continue; } // "" / '' escape
				quote = null;
			}
			continue;
		}
		if (c === '<' && s.substr(i, 5) === '<!---') {
			var endC = s.indexOf('--->', i + 5);
			if (endC === -1) return { closes: false, endQuote: null };
			i = endC + 3;
			continue;
		}
		if (c === '<' && s.substr(i, 4) === '<!--') {
			var endH = s.indexOf('-->', i + 4);
			if (endH === -1) return { closes: false, endQuote: null };
			i = endH + 2;
			continue;
		}
		if (c === '"' || c === "'") { quote = c; continue; }
		if (c === '>') return { closes: true, endQuote: null };
	}
	return { closes: false, endQuote: quote };
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

/* Does a tag of this (lowercase) name move the indent level? Mirrors the
 * single-tag rule the per-line loop historically used:
 *   - HTML void tags (br/img/meta/…)  → no (self-contained)
 *   - inline CF tags (cfset/cfparam/…) → no
 *   - middle markers (cfelse/cfelseif) → no (they divide, never net)
 *   - unknown cf* tag not in the block list → no (treated as inline)
 *   - everything else (HTML non-void OR a known CF block tag) → yes
 * Used by tagIndentDelta so every tag on a line is classified the same
 * way the old code classified the single line-leading tag. */
function isIndentingTag(name) {
	if (!name) return false;
	if (HTML_VOID_TAGS.indexOf(name) !== -1) return false;
	if (CF_TAGS.inline.indexOf(name) !== -1) return false;
	if (CF_TAGS.middle.indexOf(name) !== -1) return false;
	if (name.indexOf('cf') === 0 && CF_TAGS.block.indexOf(name) === -1) return false;
	return true;
}

/* Bug #2 — net block-tag indent delta for ONE already-trimmed CFML/HTML
 * line, counting EVERY tag on the line rather than only the one at line
 * start. The old heuristic looked at a single leading tag, so a packed
 * markup line like
 *     <h2>Heatmap <span …>(<cfoutput>#x#</cfoutput>; more <span …>
 * was scored +1 when it really opens THREE blocks (h2 + two spans); the
 * three matching `</span>/</h2>` closes then arrive on later lines and
 * drag the whole file's indent down by the missing count.
 *
 * Guardrails (a `<` is only a tag when it genuinely starts one):
 *   - `<!--- --->` / `<!-- -->` comment spans are skipped wholesale.
 *   - `<!…>` declarations (DOCTYPE) are skipped (net-zero).
 *   - Inside an opening tag we scan to its own `>` honoring quoted
 *     attribute values, so a `>` in class="a>b" or a `<` in a CFML
 *     expression `<cfif a < b>` is never mistaken for a tag boundary.
 *   - A `<` followed by space/digit/operator (a less-than, `i < n`) is
 *     consumed as a plain char — it never starts a tag.
 *   - Only isIndentingTag() names move the count; void/inline/middle and
 *     unknown cf* tags are inert, exactly as before.
 *   - A trailing OPEN tag with no `>` on the line is ignored (it is a
 *     multi-line tag the caller handles separately), matching the old
 *     single-tag behaviour.
 *
 * Returns {net, lead, openRawBlock}:
 *   net          — opens minus closes over indenting tags
 *   lead         — count of consecutive leading close tags (display
 *                  pre-dedent, mirrors leadingClosersOf for braces)
 *   openRawBlock — 'style'|'script'|'cfquery' when such a raw-body block
 *                  is opened and left unclosed on this line, so the
 *                  caller can watch for its (possibly glued) close. */
function tagIndentDelta(line) {
	var net = 0, lead = 0, leadActive = true, rawOpen = '';
	/* `openStack` holds the opening tags whose `>` we have not yet seen,
	 * so a `>` is matched to the correct tag. This is what makes the CFML
	 * conditional-attribute pattern
	 *     <option value="#x#"<cfif C> selected</cfif>>…</option>
	 * count correctly: the inner <cfif>'s `>` pops the cfif (not the
	 * option), and the option only closes at its own later `>`. Quotes are
	 * string delimiters ONLY while a tag is open (openStack non-empty), so
	 * an apostrophe in text content (`it's`) never starts a fake string. */
	var openStack = [];
	var i = 0, n = line.length;
	while (i < n) {
		var c = line.charAt(i);
		if (c === '<' && line.substr(i, 5) === '<!---') {        // CFML comment
			var ce = line.indexOf('--->', i + 5);
			if (ce === -1) break;
			i = ce + 4; continue;
		}
		if (c === '<' && line.substr(i, 4) === '<!--') {         // HTML comment
			var he = line.indexOf('-->', i + 4);
			if (he === -1) break;
			i = he + 3; continue;
		}
		// Quoted attribute value — only meaningful inside an open tag.
		if (openStack.length > 0 && (c === '"' || c === "'")) {
			i++;
			while (i < n && line.charAt(i) !== c) i++;
			i++; continue;                                       // past closer
		}
		if (c === '>') {                                         // closes an opener
			if (openStack.length > 0) {
				var popped = openStack.pop();
				if (line.charAt(i - 1) === '/' && popped.counted) net -= 1;  // self-close
			}
			i++; continue;
		}
		if (c === '<') {
			var c2 = line.charAt(i + 1);
			if (c2 === '/') {                                    // close tag </name>
				var cm = line.substr(i + 2).match(/^([a-zA-Z][\w:.-]*)/);
				if (cm && isIndentingTag(cm[1].toLowerCase())) {
					net -= 1;
					if (leadActive) lead += 1;
					if (rawOpen === cm[1].toLowerCase()) rawOpen = '';
				} else {
					leadActive = false;
				}
				var cgt = line.indexOf('>', i);                 // consume its own `>`
				i = (cgt === -1) ? n : cgt + 1; continue;
			}
			/* Inside another tag's attributes (openStack non-empty), a `<`
			 * is only a NESTED tag when it is a CF tag — the CFML
			 * conditional-attribute idiom `<option …<cfif C> sel</cfif>>`.
			 * Any other `<` there is a less-than OPERATOR inside a CFML
			 * expression, e.g. `<cfset x = a<b>` (the `<b` is `a < b`, not
			 * a <b> tag). Treating it as a tag is the exact regression the
			 * advisor flagged, so guard against it. */
			if (openStack.length > 0) {
				var isCf = (c2 === 'c' || c2 === 'C')
					&& (line.charAt(i + 2) === 'f' || line.charAt(i + 2) === 'F');
				if (!isCf) { leadActive = false; i++; continue; }
			}
			if (c2 === '!') {                                    // <!DOCTYPE …> (top level)
				var de = line.indexOf('>', i);
				leadActive = false;
				i = (de === -1) ? n : de + 1; continue;
			}
			if (/[a-zA-Z]/.test(c2)) {                           // open tag <name …>
				var om = line.substr(i + 1).match(/^([a-zA-Z][\w:.-]*)/);
				var oname = om[1].toLowerCase();
				var counts = isIndentingTag(oname);
				if (counts) net += 1;
				leadActive = false;
				openStack.push({ name: oname, counted: counts });
				if (oname === 'style' || oname === 'script' || oname === 'cfquery') rawOpen = oname;
				i += 1 + om[1].length; continue;
			}
			// `<` + space/digit/operator → a literal less-than, not a tag.
			leadActive = false;
			i++; continue;
		}
		if (leadActive && c !== ' ' && c !== '\t') leadActive = false;
		i++;
	}
	return { net: net, lead: lead, openRawBlock: rawOpen };
}

/* Normalize leading whitespace on every line: detect the file's indent unit
 * (smallest non-zero all-space leading run), then re-encode every line's
 * leading whitespace as tabs + any remainder spaces. Tabs already present
 * are first expanded to the detected unit before re-encoding, so mixed
 * space/tab lines are handled correctly. Content after the first non-
 * whitespace character is never touched. Falls back to a no-op when the
 * file has no space-indented lines (already all-tab). */
function normalizeLeadingSpacesToTabs(code, unitOverride) {
	var lines = code.split('\n');

	// Manual override: user chose a specific tab width (2 / 4 / 8). Skip detection.
	var unit;
	if (unitOverride > 0) {
		unit = unitOverride;
	} else {
		// Phase 1: detect from pure-space-leading lines (original, un-beautified file).
		unit = Infinity;
		for (var d = 0; d < lines.length; d++) {
			var dm = lines[d].match(/^( +)\S/);
			if (dm && dm[1].length < unit) unit = dm[1].length;
		}

		// Phase 2: if no pure-space lines found (file was already run through the
		// beautifier and uses tab+space alignment), detect the original indent unit
		// from the space portion of tab+space lines. The beautifier emits
		// (N*origUnit - 1) spaces for N levels of depth, so minSpaces + 1 recovers
		// the original unit.
		if (unit === Infinity) {
			var minSpc = Infinity;
			for (var d2 = 0; d2 < lines.length; d2++) {
				var dm2 = lines[d2].match(/^\t+( +)\S/);
				if (dm2 && dm2[1].length < minSpc) minSpc = dm2[1].length;
			}
			if (minSpc < Infinity) unit = minSpc + 1;
		}

		if (unit === Infinity) return code; // purely tab-only file — no-op
	}

	return lines.map(function(line) {
		var ws = 0;
		while (ws < line.length && (line[ws] === ' ' || line[ws] === '\t')) ws++;
		if (ws === 0) return line;

		// Expand leading whitespace to virtual columns using the detected unit.
		var raw = line.substring(0, ws);
		var expanded = 0;
		for (var ci = 0; ci < raw.length; ci++) {
			expanded += raw[ci] === '\t' ? (unit - (expanded % unit)) : 1;
		}

		// ceil: already-beautified lines have (N*unit - 1) spaces so they sit
		// just below a tab stop; ceil maps them to the correct N tabs. For
		// pure-space files expanded is an exact multiple so ceil == floor.
		return '\t'.repeat(Math.ceil(expanded / unit)) + line.substring(ws);
	}).join('\n');
}

/* Expand a leading-whitespace prefix string to a visual column count,
 * treating each tab as advancing to the next 8-column tab stop (standard
 * POSIX/terminal convention). Used to normalize mixed-whitespace prefixes
 * for comparison when the opener and continuation lines of a multi-line
 * inline CF tag use different styles (spaces vs tabs). */
function expandPrefixToVisualCols(prefix) {
	var col = 0;
	for (var pi = 0; pi < prefix.length; pi++) {
		if (prefix[pi] === '\t') { col = col + 8 - (col % 8); }
		else { col++; }
	}
	return col;
}

function beautifyCFML(rawCode, split_html_tag, preserve_continuation_alignment, normalize_indent, normalize_tab_width) {

	if (normalize_indent) {
		rawCode = normalizeLeadingSpacesToTabs(rawCode, normalize_tab_width || 0);
	}

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
	var multiLineTagOrigPrefix = "";
	/* Open-quote char ('"' or "'") carried across the continuation lines of a
	 * multi-line tag so a string literal that spans those lines is tracked;
	 * null when not inside such a string. Drives scanMultiLineTagClose so the
	 * real tag-closing `>` is found (and an in-string `>` is ignored). */
	var multiLineTagQuote = null;

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
	var inCfscriptBlock = false;
	var parenDepth = 0;
	var bracketDepth = 0;
	var prevLastTerm = '';
	var parentAnchorOrigPrefix = '';
	var parentAnchorActive = false;
	var parentAnchorIndentLevel = 0;

	/* Bug #1 state — a raw-body block (`<style>`/`<script>`/`<cfquery>`)
	 * opened on an earlier line whose matching `</tag>` we still owe a
	 * dedent for. The close can arrive GLUED to the end of a CSS/JS/SQL
	 * content line (e.g. `h1{…}</style>`); because that line does NOT
	 * start with `<`, the normal tag-close path never sees it and the
	 * open's `+1` leaks to every following sibling. Holds the lowercase
	 * tag name we are waiting to close, or '' when none is pending. */
	var pendingRawClose = '';

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
			/* Scan WITH the carried open-quote state so a string spanning
			 * these continuation lines is tracked. Update the carry only
			 * while the tag stays open. */
			var mlScan = scanMultiLineTagClose(line, multiLineTagQuote);
			var closesMultiLineTag = mlScan.closes;
			if (!closesMultiLineTag) {
				multiLineTagQuote = mlScan.endQuote;
			}
			var inlineExpressionClose = closesMultiLineTag
				&& CF_TAGS.inline.indexOf(multiLineTagName) !== -1
				&& /^[})\]]/.test(line);
			var inlineContExtraWs = "";
			if (CF_TAGS.inline.indexOf(multiLineTagName) !== -1) {
				if (origPrefix.indexOf(multiLineTagOrigPrefix) === 0) {
					/* Same whitespace style as opener — use verbatim prefix slice. */
					var inlineRelPrefix = origPrefix.substring(multiLineTagOrigPrefix.length);
					if (inlineRelPrefix.length > 1) {
						inlineContExtraWs = inlineRelPrefix.substring(1);
					}
				} else {
					/* Mixed whitespace (e.g. opener uses spaces, continuation uses tabs).
					 * Expand both to 8-column tab stops and compute the visual column
					 * delta, then emit spaces so siblings that used different whitespace
					 * styles still land at the same output column. The `- 1` mirrors the
					 * `.substring(1)` in the same-style path so both produce identical
					 * extra-space counts for the same visual offset. */
					var openerVisualCols = expandPrefixToVisualCols(multiLineTagOrigPrefix);
					var contVisualCols   = expandPrefixToVisualCols(origPrefix);
					var extraVisualCols  = contVisualCols - openerVisualCols;
					if (extraVisualCols > 1) {
						inlineContExtraWs = ' '.repeat(extraVisualCols - 1);
					}
				}
			}
			if (inlineExpressionClose) {
				indentLevel -= 1;
			}
			applyIndent();
			if (inlineContExtraWs !== "") {
				lines[i] = ''.padStart(indentSpace, '\t') + inlineContExtraWs + line;
			}
			if (inlineExpressionClose) {
				indentLevel += 1;
			}
			if (closesMultiLineTag) {
				var selfClose = /\/\s*>/.test(line);
				inMultiLineTag = false;
				if (selfClose || HTML_VOID_TAGS.indexOf(multiLineTagName) !== -1 || CF_TAGS.inline.indexOf(multiLineTagName) !== -1) {
					indentLevel -= 1;
				}
				multiLineTagName = "";
				multiLineTagOrigPrefix = "";
				multiLineTagQuote = null;
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
		var hasOuterTagClose = hasTagCloseOutsideStrings(line);
		if (line_data.startsWith("<") && !hasOuterTagClose && tag_name && !line_data.startsWith('<!')) {
			applyIndent();
			multiLineTagName = tag_name;
			multiLineTagOrigPrefix = origPrefix;
			/* Seed the cross-line quote state: if the opening line leaves a
			 * string literal open (e.g. `<cfset q = dbgQuery(` then a later
			 * line opens `"...`), the next iteration's scan must start inside
			 * that string. The opening line has no tag close (we are in the
			 * !hasOuterTagClose branch), so .closes is false and .endQuote is
			 * the state to carry. */
			multiLineTagQuote = scanMultiLineTagClose(line, null).endQuote;
			inMultiLineTag = true;
			indentLevel += 1;
			continue;
		}

		if (line_data.startsWith("<") && hasOuterTagClose) { // Handle HTML Coldfusion
			/* Middle markers (<cfelse>/<cfelseif>) keep their bespoke
			 * display dedent + same-line </cfif> net handling — the net
			 * tag counter below would otherwise place them one column too
			 * deep (a middle marker divides a block, it does not open one). */
			if (CF_TAGS.middle.includes(tag_name)) {
				indentLevel -= 1;
				applyIndent();
				indentLevel += 1;
				/* A middle tag can share its line with the parent block's
				 * close, e.g. `<cfelse>NULL</cfif>` in an inline SQL VALUES
				 * list. The `continue` skips the normal `</cfif>` decrement,
				 * so apply the net block-close delta here. `<cfif\b` does not
				 * match `<cfelseif`, so the marker is not miscounted. */
				var midNet = (line_data.match(/<\/cfif\b/g) || []).length
				           - (line_data.match(/<cfif\b/g) || []).length;
				indentLevel -= midNet;
				continue;
			}

			/* Net block-tag delta across EVERY tag on the line (Bug #2),
			 * replacing the old single-tag maintain/increase/decrease
			 * heuristic. Packed markup like `<h2>x<span>y<span>z` (three
			 * opens) and mixed open/close lines are now counted in full, so
			 * indent no longer drifts down the rest of the file. Display
			 * sits at the post-leading-close depth (mirrors the brace
			 * branch's leadingClosersOf pre-dedent); the full net delta is
			 * carried to the next line below. */
			var tagInfo = tagIndentDelta(line);
			indentLevel -= tagInfo.lead;
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
				inCfscriptBlock = false;
				parenDepth = 0;
				bracketDepth = 0;
				prevLastTerm = '';
				parentAnchorOrigPrefix  = '';
				parentAnchorActive      = false;
				parentAnchorIndentLevel = 0;
			} else if (tag_name === 'cfscript') {
				inJsBlock = true;
				inCfscriptBlock = !line_data.startsWith('</');
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
				inCfscriptBlock = false;
				parenDepth = 0;
				bracketDepth = 0;
				prevLastTerm = '';
				parentAnchorOrigPrefix  = '';
				parentAnchorActive      = false;
				parentAnchorIndentLevel = 0;
			}

			/* Carry the full net delta to the next line, and remember any
			 * raw-body block (<style>/<script>/<cfquery>) left open on this
			 * line so a later GLUED `</tag>` on a content line still gets
			 * its dedent (Bug #1). */
			indentLevel += tagInfo.lead + tagInfo.net;
			if (tagInfo.openRawBlock) {
				pendingRawClose = tagInfo.openRawBlock;
			}
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
			var braceCounts = countBracesOutsideStrings(line, {
				useJsStringEscapes: !inCfscriptBlock
			});
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

	/* Bug #1 — settle a pending raw-block close. Fires for BOTH the
	 * own-line case (`</style>` on its own line, already dedented by the
	 * tag-close path → here we only clear the flag) and the GLUED case
	 * (`h1{…}</style>` handled by the JS/CSS branch, which never dedented
	 * → apply the missing −1 now). A LITERAL `</tag>` match is used
	 * deliberately: it can never false-fire on a `<` operator such as
	 * `i<n` the way a generic tag scan would. */
	if (pendingRawClose && line_data.indexOf('</' + pendingRawClose) !== -1) {
		if (!line_data.startsWith('</' + pendingRawClose)) {
			indentLevel -= 1;
		}
		pendingRawClose = '';
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
	// Identifier assignment patterns like `_dict.en = {`, `window.X = {`,
	// `module.exports = [` are also unambiguous JS. The guard
	// !hasTagsOutsideStrings() below ensures CFML files with similar
	// top-level assignments (e.g. cfset-free scripts later followed by
	// CFML tags) still route correctly to cfml.
	var jsPrefix = /^\s*(\/\/|\/\*|function\b|var\b|let\b|const\b|class\b|import\b|export\b|async\b|if\b|for\b|while\b|do\b|switch\b|return\b|throw\b|try\b|\(\s*\)\s*=>|[A-Za-z_$][A-Za-z0-9_.]*\s*=\s*[{\[(]|[\[{(])/;
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
	var normalizeIndentEl = document.getElementById('normalize_indent');
	var normalize_indent = normalizeIndentEl ? normalizeIndentEl.checked : false;
	var normalizeTabWidthEl = document.getElementById('normalize_tab_width');
	var normalize_tab_width = normalizeTabWidthEl ? parseInt(normalizeTabWidthEl.value, 10) || 0 : 0;
	var semanticIndentEl = document.getElementById('semantic_indent');
	var semantic_indent = semanticIndentEl ? semanticIndentEl.checked : false;
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
			var result = beautifyCFML(rawCode, split_html_tag, preserve_continuation_alignment, normalize_indent, normalize_tab_width);
			if(deep_sql || deep_css || deep_js){
				result = deepFormatEmbedded(result, {
					sql: deep_sql,
					css: deep_css,
					js: deep_js,
					sqlPro: pro_sql,
					sqlDialect: pro_sql_dialect
				}, rawCode);
			}
			/* Semantic-indent post-pass — re-indents flat multi-line
			 * <cfset>/<cfparam> nested-call chains by call_expression CST
			 * depth. Only runs when the user opted in AND the grammar is
			 * already loaded (the lazy-load gate below pre-fetches it before
			 * calling runFormat). If the parser isn't ready we silently skip,
			 * leaving the line-scanner output untouched. */
			if (semantic_indent
				&& typeof isTreeSitterCFMLLoaded === 'function' && isTreeSitterCFMLLoaded()
				&& typeof applySemanticIndentPostPass === 'function'
				&& typeof getCfmlParser === 'function') {
				var tsParser = getCfmlParser();
				if (tsParser) {
					try {
						result = applySemanticIndentPostPass(result, tsParser);
					} catch (e) {
						if (typeof console !== 'undefined' && console.warn) {
							console.warn('[tree-sitter] semantic indent post-pass threw, using line-scanner output:', e && e.message);
						}
					}
				}
			}
			output.value = result;
		}
		finishOutput();
	}

	/* Lazy-load any async resources the chosen options need, THEN format.
	 * Each preload swallows its own failure (resolves) so a single bad load
	 * never blocks the others — runFormat then degrades gracefully (built-in
	 * SQL formatter / line-scanner indent). */
	var preloads = [];

	if (pro_sql && typeof ensureProSQL === 'function' && (!(typeof isProSQLLoaded === 'function') || !isProSQLLoaded())) {
		preloads.push(ensureProSQL().catch(function(err) {
			console.warn('[pro-sql] load failed, falling back to built-in formatter:', err);
		}));
	}

	/* Fetch the 2.6 MB CFML grammar ONLY when semantic indent is on, the input
	 * is CFML, and a flat multi-line inline-tag block is actually present —
	 * users who never hit that case pay zero bytes. */
	if (semantic_indent
		&& language == 'cfml'
		&& typeof hasFlatInlineTagBlock === 'function' && hasFlatInlineTagBlock(rawCode)
		&& typeof ensureTreeSitterCFML === 'function'
		&& typeof isTreeSitterCFMLLoaded === 'function' && !isTreeSitterCFMLLoaded()) {
		preloads.push(ensureTreeSitterCFML().catch(function(err) {
			console.warn('[tree-sitter] load failed, skipping semantic indent:', err);
		}));
	}

	if (preloads.length) {
		Promise.all(preloads).then(runFormat);
		return;
	}

	runFormat();
}
