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
	var SPLITTABLE_RE = /^<(\/?cf(?!queryparam\b|argument\b)[a-z]+\b|!---|!--)/i;
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

		// (C) CFML tag — only at tag-to-tag boundary (preceding `>`)
		if (!SPLITTABLE_RE.test(slice)) return false;
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
			/* Decrease [start] */
			// JavaScript CSS
			if(line_data.startsWith("}")){
				indentLevel -= 1;
			}
			else if(line_data.startsWith("]")){
				indentLevel -= 1;
			}
			else if(line_data.includes("}") && !line_data.includes("{")){
				indentLevel -= 1;
			}
			/* Decrease [end  ] */


			// indentation
			//lines[i] = ''.padStart(indentLevel * indentSize) + line;
			applyIndent();

			/* Increase [start] */
			// JavaScript CSS
			if(line_data.endsWith("{")){
				indentLevel += 1;
			}else if(line_data.endsWith("[")){
				indentLevel += 1;
				/* Increase [end  ] */
			}
			else if(line_data.includes("{") && !line_data.includes("}")){
				indentLevel += 1;
				/* Increase [end  ] */
			}

		}

	}

	//console.log("line_data." + line_data);
	//console.log("indentLevel." + indentLevel);
}

return lines.join('\n');

}

function detectLanguage(code) {
	if (/^\s*(select|insert|update|delete|with|create|alter|drop)\b/i.test(code)) {
		return 'sql';
	}
	return 'cfml';
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
		if(language == 'sql'){
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
