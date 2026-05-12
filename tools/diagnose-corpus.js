#!/usr/bin/env node
/*
 * tools/diagnose-corpus.js — corpus audit for the ColdFusion-Code-Beautifier.
 *
 * Runs the browser beautifier under Node (via vm.runInContext) against every
 * .cfm file under sample/sample_cfm/, classifies each <cfquery> body by
 * dispatch outcome, and prints a Markdown-table summary + grand totals.
 *
 * Consolidates three earlier diagnostic scripts that lived under sample/:
 *   - _corpus_audit.js   → baseline run + per-file table
 *   - _corpus_audit2.js  → better classifier (handles UPDATE/INSERT/DELETE/WITH,
 *                         preserves "already-Pro-SQL-formatted" verdict)
 *   - _phase4_targets.js → dumps full body of every Tier 2 verbatim cfquery
 *                         (Phase 4 candidates)
 *
 * The corpus folder (sample/) is gitignored. This tool stays in tools/ so
 * it gets committed and any contributor can re-run the audit when new
 * sample files are dropped in.
 *
 * Usage:
 *   node tools/diagnose-corpus.js                  # default: --audit
 *   node tools/diagnose-corpus.js --audit          # run all + summary table
 *   node tools/diagnose-corpus.js --targets        # print full body of every Tier 2 candidate
 *   node tools/diagnose-corpus.js --sanitize       # SQL syntax coverage gap report (corpus vs token-equivalence tests)
 *   node tools/diagnose-corpus.js --file foo.cfm   # restrict to one file (basename or full path)
 *   node tools/diagnose-corpus.js --dialect mysql  # default postgresql
 *   node tools/diagnose-corpus.js --no-write       # skip writing *.beautified.cfm
 *   node tools/diagnose-corpus.js --help
 */

'use strict';

var fs   = require('fs');
var vm   = require('vm');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
process.chdir(ROOT);

// ---------- CLI ----------
var argv = process.argv.slice(2);
var opts = {
    mode:        'audit',
    autoSuggest: false,
    file:        null,
    dialect:     'postgresql',
    write:       true,
    corpus:      path.join('sample', 'sample_cfm')
};
for (var ai = 0; ai < argv.length; ai++) {
    var a = argv[ai];
    if      (a === '--audit')        opts.mode = 'audit';
    else if (a === '--targets')      opts.mode = 'targets';
    else if (a === '--sanitize')     opts.mode = 'sanitize';
    else if (a === '--auto-suggest') opts.autoSuggest = true;
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
    else if (a === '--no-write')     opts.write = false;
    else if (a === '--file')         opts.file = argv[++ai];
    else if (a === '--dialect')      opts.dialect = argv[++ai];
    else if (a === '--corpus')       opts.corpus = argv[++ai];
    else { console.error('Unknown arg: ' + a + '\nRun --help for usage.'); process.exit(2); }
}

function printHelp() {
    console.log([
        'Usage: node tools/diagnose-corpus.js [--audit|--targets] [options]',
        '',
        'Modes:',
        '  --audit       Run beautifier on all corpus files, write .beautified.cfm,',
        '                classify each cfquery, print summary table + grand totals (default).',
        '  --targets     Print full body of every Tier 2 verbatim cfquery (Phase 4 candidates).',
        '  --sanitize    SQL syntax coverage gap report. Detects features used in corpus',
        '                cfqueries vs features covered by Pro SQL token-equivalence tests',
        '                in tests/run-tests.js, and surfaces corpus locations for any',
        '                uncovered feature so a human can sanitize → add as a new case.',
        '                Combine with --auto-suggest to ALSO emit pasteable JS code:',
        '                  node tools/diagnose-corpus.js --sanitize --auto-suggest',
        '                which auto-applies sanitization rules (real_table → t1/t2,',
        '                real_col → a/b/c, real strings → val1/val2, #real_expr# → #x#/#y#)',
        '                and prints ready-to-paste assertEqual fixtures for each gap.',
        '',
        'Options:',
        '  --file NAME       Restrict to one file (basename or full path).',
        '  --dialect NAME    Pro SQL dialect (default: postgresql).',
        '  --no-write        Skip writing *.beautified.cfm output files.',
        '  --corpus DIR      Corpus directory (default: sample/sample_cfm).',
        '  -h, --help        This help.'
    ].join('\n'));
}

// ---------- corpus discovery ----------
function listCorpus(dir, fileFilter) {
    if (!fs.existsSync(dir)) {
        console.error('Corpus dir not found: ' + dir);
        process.exit(1);
    }
    var all = fs.readdirSync(dir).filter(function(n) {
        return /\.cfm$/i.test(n) && !/\.beautified\.cfm$/i.test(n);
    });
    if (fileFilter) {
        var basename = path.basename(fileFilter);
        all = all.filter(function(n) { return n === basename; });
        if (all.length === 0) {
            console.error('No corpus file matched --file ' + fileFilter);
            process.exit(1);
        }
    }
    return all.sort();
}

// ---------- browser bootstrap ----------
var scripts = [
    'js/cf-tags.js', 'js/sql-keywords.js', 'js/sql-beautifier.js',
    'js/deep-format.js', 'js/tag-utils.js', 'js/toast.js',
    'js/clipboard.js', 'js/beautifier.js'
];
var browserCode = scripts.map(function(f) { return fs.readFileSync(f, 'utf8'); }).join('\n');
var proSrc      = fs.readFileSync('js/pro-sql.js', 'utf8');

var sqlFormatter = null;
var vendorPath = path.join('vendor', 'sql-formatter.min.js');
if (fs.existsSync(vendorPath)) {
    sqlFormatter = require(path.join(ROOT, vendorPath));
} else {
    console.warn('WARN: vendor/sql-formatter.min.js missing — Pro SQL will fall through to Lite.');
}

function runBeautifier(input, dialect) {
    var elements = {
        language:          { value: 'cfml' },
        split_html_tag:    { checked: false },
        auto_copy:         { checked: false },
        auto_clear:        { checked: false },
        auto_clear_output: { checked: false },
        deep_sql:          { checked: true },
        deep_css:          { checked: false },
        deep_js:           { checked: false },
        pro_sql:           { checked: !!sqlFormatter },
        pro_sql_dialect:   { value: dialect },
        input:             { value: input },
        output:            { value: '', select: function() {} }
    };
    var warns = [];
    var ctx = {
        console: {
            log:   function() {},
            warn:  function() { warns.push(Array.prototype.slice.call(arguments).map(String).join(' ')); },
            error: function() { warns.push('[ERROR] ' + Array.prototype.slice.call(arguments).map(String).join(' ')); }
        },
        window: sqlFormatter ? { sqlFormatter: sqlFormatter } : {},
        document: {
            getElementById: function(id) { return elements[id]; },
            execCommand:    function() { return true; },
            querySelector:  function() { return { prepend: function() {}, textContent: '' }; },
            createElement:  function() {
                return {
                    className: '', innerHTML: '',
                    style: { setProperty: function() {} },
                    classList: { add: function() {}, remove: function() {} },
                    addEventListener: function() {},
                    remove: function() {}
                };
            },
            addEventListener: function() {},
            readyState: 'complete'
        },
        setTimeout: setTimeout, clearTimeout: clearTimeout
    };
    vm.createContext(ctx);
    vm.runInContext((sqlFormatter ? proSrc + '\n' : '') + browserCode, ctx);
    var t0 = Date.now();
    var threw = null;
    try { ctx.beautifyCodes(); } catch (e) { threw = e; }
    return { output: elements.output.value, warnings: warns, ms: Date.now() - t0, threw: threw };
}

// ---------- cfquery range + classifier ----------
function findCfqueryRanges(src) {
    var lines = src.split('\n');
    var r = [];
    var open = -1;
    for (var i = 0; i < lines.length; i++) {
        var ll = lines[i].toLowerCase();
        if (open === -1 && /<cfquery[\s>]/.test(ll)) open = i;
        if (open !== -1 && ll.indexOf('</cfquery>') !== -1) {
            var nm = lines[open].match(/name=['"]([^'"]+)['"]/i);
            r.push({ start: open, end: i, name: nm ? nm[1] : '(anon)' });
            open = -1;
        }
    }
    return r;
}

// Pro SQL output signature: an own-line uppercase SQL verb. Recognizes
// SELECT / SELECT DISTINCT / UPDATE / INSERT / INSERT INTO / DELETE /
// WITH / MERGE / TRUNCATE.
function isProSqlFormatted(body) {
    return body.split('\n').some(function(l) {
        return /^\s*(SELECT(\s+DISTINCT)?|UPDATE|INSERT(\s+INTO)?|DELETE|WITH|MERGE|TRUNCATE)\s*$/.test(l);
    });
}

// Verdict taxonomy:
//   IDENTICAL_NOOP         input === output (rare; empty/comment cfquery body)
//   FULL_REFORMAT          no cfif inside, Pro SQL kicked in end-to-end
//   PHASE3_HOIST_OR_MARKER cfif inside + Pro SQL fully restructured backbone
//   PRESERVED_AS_FORMATTED input was already Pro-SQL-formatted, output kept it
//   TIER2_VERBATIM_NOCASE  cfif inside + body word-identical to input (no case change)
//   TIER2_VERBATIM_LITE    cfif inside + body word-identical EXCEPT keyword case (Lite upper)
//   WHITESPACE_ONLY        no cfif, only whitespace differs
//   NO_PRO_SQL_BUT_CHANGED no cfif, content changed but not Pro-SQL-shaped
function classify(inBody, outBody) {
    if (inBody === outBody) return 'IDENTICAL_NOOP';
    var inPro  = isProSqlFormatted(inBody);
    var outPro = isProSqlFormatted(outBody);
    var hasInputCfif = /<cfif\b/i.test(inBody);

    if (outPro && !inPro) return hasInputCfif ? 'PHASE3_HOIST_OR_MARKER' : 'FULL_REFORMAT';
    if (outPro && inPro)  return 'PRESERVED_AS_FORMATTED';

    var inWords  = inBody.replace(/\s+/g, ' ').trim();
    var outWords = outBody.replace(/\s+/g, ' ').trim();
    if (inWords === outWords) {
        return hasInputCfif ? 'TIER2_VERBATIM_NOCASE' : 'WHITESPACE_ONLY';
    }
    if (hasInputCfif) return 'TIER2_VERBATIM_LITE';
    return 'NO_PRO_SQL_BUT_CHANGED';
}

// Tier 2 verbatim verdicts mark cfqueries Phase 4 (split-format-recombine)
// would help. Used by --targets mode.
var TIER2_VERDICTS = { TIER2_VERBATIM_NOCASE: true, TIER2_VERBATIM_LITE: true };

// ---------- modes ----------
function modeAudit() {
    var corpus = listCorpus(opts.corpus, opts.file);
    var grand = {
        files: 0, total_bytes: 0, total_lines: 0, total_cfquery: 0,
        total_ms: 0, total_warns: 0, total_threw: 0,
        by_verdict: {}
    };
    console.log('Pro SQL dialect: ' + opts.dialect + (sqlFormatter ? '' : '  (Pro SQL DISABLED — vendor bundle missing)'));
    console.log('Corpus folder  : ' + opts.corpus);
    console.log('Files          : ' + corpus.length + (opts.file ? ' (filtered)' : ''));
    console.log('');
    console.log('| File | Lines | cfquery | ms | warns | Verdict breakdown |');
    console.log('|------|-------|---------|----|----|-------------------|');

    corpus.forEach(function(name) {
        var p = path.join(opts.corpus, name);
        var src = fs.readFileSync(p, 'utf8');
        var inLines = src.split('\n').length;
        var bytes = src.length;
        var result = runBeautifier(src, opts.dialect);

        if (result.threw) {
            console.log('| ' + name + ' | ' + inLines + ' | THREW | ' + result.ms + ' | - | ' +
                        (result.threw.message || String(result.threw)).replace(/\|/g, '\\|') + ' |');
            grand.total_threw++;
            return;
        }

        if (opts.write) {
            fs.writeFileSync(p.replace(/\.cfm$/i, '.beautified.cfm'), result.output, 'utf8');
        }

        var inQ  = findCfqueryRanges(src);
        var outQ = findCfqueryRanges(result.output);
        var verdicts = {};
        var minLen = Math.min(inQ.length, outQ.length);
        var inSrcLines  = src.split('\n');
        var outSrcLines = result.output.split('\n');
        for (var i = 0; i < minLen; i++) {
            var inBody  = inSrcLines.slice(inQ[i].start + 1, inQ[i].end).join('\n');
            var outBody = outSrcLines.slice(outQ[i].start + 1, outQ[i].end).join('\n');
            var v = classify(inBody, outBody);
            verdicts[v] = (verdicts[v] || 0) + 1;
            grand.by_verdict[v] = (grand.by_verdict[v] || 0) + 1;
        }
        if (inQ.length !== outQ.length) {
            verdicts['COUNT_MISMATCH'] = inQ.length + 'in/' + outQ.length + 'out';
        }

        var vstr = Object.keys(verdicts).sort().map(function(k) { return k + '=' + verdicts[k]; }).join(', ');
        console.log('| ' + name + ' | ' + inLines + ' | ' + inQ.length + ' | ' +
                    result.ms + ' | ' + result.warnings.length + ' | ' + (vstr || '(none)') + ' |');

        grand.files++;
        grand.total_bytes   += bytes;
        grand.total_lines   += inLines;
        grand.total_cfquery += inQ.length;
        grand.total_ms      += result.ms;
        grand.total_warns   += result.warnings.length;
    });

    console.log('\n=== GRAND TOTAL ===');
    console.log('files     : ' + grand.files);
    console.log('lines     : ' + grand.total_lines);
    console.log('bytes     : ' + grand.total_bytes);
    console.log('cfquery   : ' + grand.total_cfquery);
    console.log('elapsed ms: ' + grand.total_ms);
    console.log('warnings  : ' + grand.total_warns);
    console.log('threw     : ' + grand.total_threw);
    if (grand.total_cfquery > 0) {
        console.log('\nVerdict breakdown (across all cfqueries):');
        Object.keys(grand.by_verdict)
            .sort(function(a, b) { return grand.by_verdict[b] - grand.by_verdict[a]; })
            .forEach(function(k) {
                var pct = (grand.by_verdict[k] * 100 / grand.total_cfquery).toFixed(1);
                console.log('  ' + k.padEnd(28) + ' ' + String(grand.by_verdict[k]).padStart(5) + '  (' + pct + '%)');
            });
    }
    // Non-zero exit if anything broke — useful for CI.
    if (grand.total_threw > 0) process.exit(1);
}

function modeTargets() {
    var corpus = listCorpus(opts.corpus, opts.file);
    var targets = [];
    corpus.forEach(function(name) {
        var p = path.join(opts.corpus, name);
        var src = fs.readFileSync(p, 'utf8');
        var result = runBeautifier(src, opts.dialect);
        if (result.threw) return;
        var inQ  = findCfqueryRanges(src);
        var outQ = findCfqueryRanges(result.output);
        var inSrcLines  = src.split('\n');
        var outSrcLines = result.output.split('\n');
        var minLen = Math.min(inQ.length, outQ.length);
        for (var i = 0; i < minLen; i++) {
            var inBody  = inSrcLines.slice(inQ[i].start + 1, inQ[i].end).join('\n');
            var outBody = outSrcLines.slice(outQ[i].start + 1, outQ[i].end).join('\n');
            var v = classify(inBody, outBody);
            if (TIER2_VERDICTS[v]) {
                targets.push({
                    file: name, idx: i + 1, name: inQ[i].name, verdict: v,
                    lineStart: inQ[i].start + 1, lineEnd: inQ[i].end + 1,
                    bodyLines: inQ[i].end - inQ[i].start - 1,
                    fullSrc: inSrcLines.slice(inQ[i].start, inQ[i].end + 1)
                });
            }
        }
    });
    console.log('=== Tier 2 verbatim cfqueries (' + targets.length + ' total — Phase 4 candidates) ===');
    targets.forEach(function(t) {
        console.log('\n--- ' + t.file + ' #' + t.idx + '  name=' + t.name + '  verdict=' + t.verdict);
        console.log('    lines ' + t.lineStart + '-' + t.lineEnd + '  (body ' + t.bodyLines + ' lines)');
        t.fullSrc.forEach(function(l, n) {
            console.log(String(t.lineStart + n).padStart(5) + ' | ' + l);
        });
    });
    if (targets.length === 0) {
        console.log('No Tier 2 verbatim cfqueries — Phase 4 has nothing to do on this corpus.');
    }
}

// ---------- SQL syntax coverage gap report (--sanitize) ----------
//
// SQL feature catalog. Each entry is a key + regex that detects the
// feature inside a cfquery body. Patterns are case-insensitive and
// designed to be conservative (low false-positive rate). Order matters
// only for output stability; categories are otherwise independent.
//
// When you add a new token-equivalence test for an uncovered feature,
// add the feature here too so this report stays the source of truth.
var SQL_FEATURES = [
    // Set operations
    { key: 'UNION',           pattern: /\bunion\b(?!\s+all)/i },
    { key: 'UNION_ALL',       pattern: /\bunion\s+all\b/i },
    { key: 'INTERSECT',       pattern: /\bintersect\b/i },
    { key: 'EXCEPT',          pattern: /\bexcept\b/i },
    // CTE + window functions
    { key: 'WITH_CTE',        pattern: /\bwith\s+\w+\s+as\s*\(/i },
    { key: 'RECURSIVE_CTE',   pattern: /\bwith\s+recursive\b/i },
    { key: 'WINDOW_OVER',     pattern: /\)\s*over\s*\(/i },
    { key: 'PARTITION_BY',    pattern: /\bpartition\s+by\b/i },
    { key: 'ROW_NUMBER',      pattern: /\brow_number\s*\(\s*\)/i },
    // DML other than SELECT
    { key: 'INSERT_VALUES',   pattern: /\binsert\s+into\s+\S+[\s\S]{0,300}?\bvalues\s*\(/i },
    { key: 'INSERT_SELECT',   pattern: /\binsert\s+into\s+\S+(?:\s*\([^)]*\))?\s*select\b/i },
    { key: 'UPDATE_SET',      pattern: /\bupdate\s+\S+\s+set\b/i },
    { key: 'DELETE_FROM',     pattern: /\bdelete\s+from\b/i },
    { key: 'MERGE_INTO',      pattern: /\bmerge\s+into\b/i },
    { key: 'TRUNCATE',        pattern: /\btruncate\s+table\b/i },
    // Query shape
    { key: 'SELECT_DISTINCT', pattern: /\bselect\s+distinct\b/i },
    { key: 'JOIN_3PLUS',      pattern: /(?:inner|left|right|full|outer|cross)\s+(?:outer\s+)?join[\s\S]{0,500}?(?:inner|left|right|full|outer|cross)\s+(?:outer\s+)?join[\s\S]{0,500}?(?:inner|left|right|full|outer|cross)\s+(?:outer\s+)?join/i },
    { key: 'CROSS_JOIN',      pattern: /\bcross\s+join\b/i },
    { key: 'FULL_OUTER_JOIN', pattern: /\bfull\s+outer\s+join\b/i },
    { key: 'SUBQUERY_FROM',   pattern: /\bfrom\s*\(\s*select\b/i },
    { key: 'EXISTS_SUBQ',     pattern: /\bexists\s*\(\s*select\b/i },
    { key: 'NOT_EXISTS_SUBQ', pattern: /\bnot\s+exists\s*\(\s*select\b/i },
    { key: 'IN_SUBQUERY',     pattern: /\bin\s*\(\s*select\b/i },
    { key: 'NOT_IN_SUBQUERY', pattern: /\bnot\s+in\s*\(\s*select\b/i },
    { key: 'GROUP_BY',        pattern: /\bgroup\s+by\b/i },
    { key: 'HAVING',          pattern: /\bhaving\b/i },
    { key: 'ORDER_BY',        pattern: /\border\s+by\b/i },
    { key: 'LIMIT_OFFSET',    pattern: /\b(limit|offset)\s+\d/i },
    { key: 'FOR_UPDATE',      pattern: /\bfor\s+update\b/i },
    // Predicates
    { key: 'BETWEEN',         pattern: /\bbetween\b/i },
    { key: 'LIKE',            pattern: /\blike\b/i },
    { key: 'ILIKE',           pattern: /\bilike\b/i },
    { key: 'IS_NULL',         pattern: /\bis\s+(?:not\s+)?null\b/i },
    // Conditional
    { key: 'CASE_WHEN',       pattern: /\bcase\s+when\b/i },
    { key: 'NESTED_CASE',     pattern: /\bcase\s+when\b[\s\S]{0,300}?\bcase\s+when\b/i },
    // Aggregates
    { key: 'AGG_SUM',         pattern: /\bsum\s*\(/i },
    { key: 'AGG_COUNT',       pattern: /\bcount\s*\(/i },
    { key: 'AGG_AVG',         pattern: /\bavg\s*\(/i },
    { key: 'AGG_MAX',         pattern: /\bmax\s*\(/i },
    { key: 'AGG_MIN',         pattern: /\bmin\s*\(/i },
    { key: 'GROUP_CONCAT',    pattern: /\b(?:group_concat|string_agg|listagg)\s*\(/i },
    // Type / casting
    { key: 'CAST_AS',         pattern: /\bcast\s*\([\s\S]{1,200}?\s+as\s+\w/i },
    { key: 'CAST_DOUBLE_COLON', pattern: /::\w/ },
    // CFML integration
    { key: 'CFQUERYPARAM',    pattern: /<cfqueryparam\b/i },
    { key: 'CFIF_IN_BODY',    pattern: /<cfif\b/i },
    { key: 'CFLOOP_IN_BODY',  pattern: /<cfloop\b/i },
    { key: 'PRESERVESINGLEQUOTES', pattern: /\bPreserveSingleQuotes\s*\(/i },
    // Comments
    { key: 'BLOCK_COMMENT',   pattern: /\/\*[\s\S]*?\*\// },
    { key: 'LINE_COMMENT',    pattern: /(?:^|\s)--[^\n]/m },
    { key: 'CFM_MARKUP_COMMENT', pattern: /<!---[\s\S]*?--->/ }
];

function detectFeatures(body) {
    var hits = {};
    SQL_FEATURES.forEach(function(f) {
        if (f.pattern.test(body)) hits[f.key] = true;
    });
    return hits;
}

// Scan the token-equivalence test inputs in tests/run-tests.js to find
// which features are already covered. Done by locating the
// `runProSQLTokenEquivalenceTests` IIFE and reading every string-literal
// argument that follows a `runProSQL(...)`-style fixture. We extract the
// `cases = [...]` array via a balanced-bracket scan, then run feature
// detection on each fixture string.
function loadTestedFeatures() {
    var src;
    try { src = fs.readFileSync('tests/run-tests.js', 'utf8'); }
    catch (e) { return { fixtures: [], features: {}, error: 'tests/run-tests.js unreadable' }; }

    // Find the runProSQLTokenEquivalenceTests block.
    var blockStart = src.indexOf('runProSQLTokenEquivalenceTests');
    if (blockStart === -1) return { fixtures: [], features: {}, error: 'runProSQLTokenEquivalenceTests block not found' };

    // Find the `var cases = [` inside the block.
    var casesStart = src.indexOf('var cases = [', blockStart);
    if (casesStart === -1) return { fixtures: [], features: {}, error: 'var cases = [ not found' };
    var arrStart = casesStart + 'var cases = ['.length;

    // Balanced-bracket scan to find matching ].
    var depth = 1, i = arrStart, inStr = null;
    while (i < src.length && depth > 0) {
        var c = src[i];
        if (inStr) {
            if (c === '\\') { i += 2; continue; }
            if (c === inStr) inStr = null;
            i++;
            continue;
        }
        if (c === '"' || c === "'") { inStr = c; i++; continue; }
        if (c === '[') depth++;
        else if (c === ']') depth--;
        i++;
    }
    var arrEnd = i - 1; // position of matching ]
    var arrText = src.slice(arrStart, arrEnd);

    // Parse string literals. Each fixture is the 2nd string of a pair
    // like ['name', '...sql input...']. We pull every JS string literal
    // (single OR double quoted, JS escapes processed) out of arrText.
    var fixtures = [];
    var p = 0;
    while (p < arrText.length) {
        var quote = arrText[p];
        if (quote !== "'" && quote !== '"') { p++; continue; }
        var lit = '';
        p++;
        while (p < arrText.length) {
            var ch = arrText[p];
            if (ch === '\\') {
                var nx = arrText[p + 1];
                if      (nx === 'n')  lit += '\n';
                else if (nx === 't')  lit += '\t';
                else if (nx === 'r')  lit += '\r';
                else if (nx === '\\') lit += '\\';
                else if (nx === "'")  lit += "'";
                else if (nx === '"')  lit += '"';
                else                  lit += nx;
                p += 2;
                continue;
            }
            if (ch === quote) { p++; break; }
            lit += ch;
            p++;
        }
        fixtures.push(lit);
    }

    // Drop the first string of each pair (the description). Heuristic:
    // strings shorter than 40 chars without "<cfquery" prefix are likely
    // descriptions; everything else is a SQL fixture. We aggregate
    // features over BOTH sets — descriptions can't trigger feature
    // patterns reliably, but cfquery fixtures will.
    var features = {};
    var sqlFixtures = fixtures.filter(function(s) { return /<cfquery\b/i.test(s); });
    sqlFixtures.forEach(function(s) {
        var hits = detectFeatures(s);
        Object.keys(hits).forEach(function(k) { features[k] = (features[k] || 0) + 1; });
    });
    return { fixtures: sqlFixtures, features: features, error: null };
}

function modeSanitize() {
    var corpus = listCorpus(opts.corpus, opts.file);
    var corpusFeatureCount = {};       // feature → number of cfqueries with it
    var corpusFeatureExamples = {};    // feature → up to 3 {file, name, lineStart, snippet}

    corpus.forEach(function(name) {
        var p = path.join(opts.corpus, name);
        var src = fs.readFileSync(p, 'utf8');
        var ranges = findCfqueryRanges(src);
        var srcLines = src.split('\n');
        ranges.forEach(function(r) {
            var body = srcLines.slice(r.start, r.end + 1).join('\n');
            var hits = detectFeatures(body);
            Object.keys(hits).forEach(function(k) {
                corpusFeatureCount[k] = (corpusFeatureCount[k] || 0) + 1;
                if (!corpusFeatureExamples[k]) corpusFeatureExamples[k] = [];
                if (corpusFeatureExamples[k].length < 3) {
                    corpusFeatureExamples[k].push({
                        file: name, name: r.name, lineStart: r.start + 1, lineEnd: r.end + 1,
                        snippet: extractSnippetForFeature(body, k),
                        fullBody: body  // for --auto-suggest sanitization
                    });
                }
            });
        });
    });

    var tested = loadTestedFeatures();
    if (tested.error) {
        console.error('WARN: ' + tested.error);
        console.error('Coverage column will show "?" for all features.');
    }

    // Print coverage table.
    console.log('=== SQL syntax coverage report ===\n');
    console.log('Corpus dir       : ' + opts.corpus);
    console.log('Token-equiv test : tests/run-tests.js (runProSQLTokenEquivalenceTests)');
    if (tested.fixtures) console.log('Test fixtures    : ' + tested.fixtures.length + ' Pro SQL token-equivalence cases parsed');
    console.log('');
    console.log('Feature              Corpus  Tests   Status');
    console.log('────────────────────────────────────────────────────────────');
    SQL_FEATURES.forEach(function(f) {
        var c = corpusFeatureCount[f.key] || 0;
        var t = (tested.features && tested.features[f.key]) || 0;
        var status;
        if (c === 0 && t === 0)        status = '·';
        else if (c > 0 && t > 0)       status = 'covered';
        else if (c > 0 && t === 0)     status = '⚠  GAP — corpus has, tests don\'t';
        else                           status = 'tested (no corpus example)';
        console.log('  ' + f.key.padEnd(22) + String(c).padStart(4) + '   ' + String(t).padStart(4) + '   ' + status);
    });

    // Surface gaps with concrete examples.
    var gaps = SQL_FEATURES
        .map(function(f) { return f.key; })
        .filter(function(k) {
            var c = corpusFeatureCount[k] || 0;
            var t = (tested.features && tested.features[k]) || 0;
            return c > 0 && t === 0;
        });

    if (gaps.length === 0) {
        console.log('\n✓ No coverage gaps. Every SQL feature present in corpus has at least one token-equivalence test.');
    } else {
        console.log('\n=== ' + gaps.length + ' coverage gap(s) — sanitize candidates for human review ===');
        console.log('For each gap, up to 3 corpus examples are shown. Pick one, sanitize it');
        console.log('(table names → t1/t2/..., columns → a/b/c/..., literals → generic),');
        console.log('and add as a new case in tests/run-tests.js runProSQLTokenEquivalenceTests.\n');
        gaps.forEach(function(k) {
            console.log('────────────────────────────────────────────────────────────');
            console.log('GAP: ' + k + '   (corpus occurrences: ' + corpusFeatureCount[k] + ')');
            corpusFeatureExamples[k].forEach(function(ex, idx) {
                console.log('  [' + (idx + 1) + '] ' + ex.file + ' cfquery=' + ex.name + ' lines ' + ex.lineStart + '-' + ex.lineEnd);
                ex.snippet.split('\n').forEach(function(l) { console.log('      | ' + l); });
            });
        });
        console.log('────────────────────────────────────────────────────────────');

        if (opts.autoSuggest) emitAutoSuggestions(gaps, corpusFeatureExamples);
    }
}

// Emit pasteable JS code blocks for the first corpus example of each gap.
// Each block is an array literal of the form ['description', 'sanitized cfquery'].
// Drop into tests/run-tests.js inside the runProSQLTokenEquivalenceTests
// `cases` array. The output is best-effort — the human should still review
// the diff for false-rename collisions (e.g. function names that happened
// to look like custom funcs because the catalog missed them).
function emitAutoSuggestions(gaps, corpusFeatureExamples) {
    console.log('\n=== --auto-suggest: pasteable JS fixtures for tests/run-tests.js ===');
    console.log('Each block below is one ready-to-paste case for the runProSQLTokenEquivalenceTests');
    console.log('`cases` array. Sanitization is best-effort:');
    console.log('  • real table names → t1, t2, ...');
    console.log('  • real column names → a, b, c, ...');
    console.log('  • custom functions → fn1, fn2, ...');
    console.log('  • string literals → \'val1\', \'val2\', ...');
    console.log('  • CFML expressions #foo# → #x#, #y#, ...');
    console.log('Known SQL functions (sum/count/lower/etc.) are kept verbatim.');
    console.log('Review the diff before pasting — false-renames are possible if the');
    console.log('catalog missed a known function or scope prefix.');
    console.log('────────────────────────────────────────────────────────────\n');

    gaps.forEach(function(featureKey) {
        var examples = corpusFeatureExamples[featureKey] || [];
        if (examples.length === 0) return;
        var ex = examples[0];  // sanitize first example only — keeps output compact
        var sanitized;
        try {
            sanitized = sanitizeSnippet(ex.fullBody);
        } catch (e) {
            console.log('// GAP ' + featureKey + ' — sanitization failed: ' + (e.message || e));
            return;
        }
        // Collapse trailing whitespace lines that came from the cfquery wrapper.
        sanitized = sanitized.replace(/\n[\t ]*\n/g, '\n').trim();
        var desc = 'corpus-derived gap: ' + featureKey + ' (auto-sanitized from ' + ex.file +
                   ' #' + ex.name + ' lines ' + ex.lineStart + '-' + ex.lineEnd + ', REVIEW BEFORE PASTE)';
        console.log('// ----- GAP: ' + featureKey + ' -----');
        console.log('[' + JSON.stringify(desc) + ',');
        console.log('\t"' + jsStringEscape(sanitized) + '"],');
        console.log('');
    });
    console.log('────────────────────────────────────────────────────────────');
    console.log('Workflow: copy the desired block(s) above, paste into the `cases`');
    console.log('array near the end of runProSQLTokenEquivalenceTests, run');
    console.log('`node tests/run-tests.js` to confirm, then `node tools/diagnose-corpus.js');
    console.log('--sanitize` to verify the gap is closed.');
}

// ============================================================================
// Sanitizer for --auto-suggest. Best-effort, pragmatic 80/20 implementation:
//
//   real_table_name (after FROM/JOIN/UPDATE/INTO)  →  t1, t2, t3, ...
//   alias for that table (immediately after, AS or whitespace)  →  same tN
//   real_column_name (anywhere else as IDENT)      →  a, b, c, d, ...
//   custom_function(...)  (IDENT followed by `(`, not in known SQL funcs)
//                                                  →  fn1, fn2, ...
//   'real string literal'                          →  'val1', 'val2', ...
//   #real_cfml_expr#                               →  #x#, #y#, #z#, ...
//   datasource attrs / cfqueryparam values / etc.  →  best-effort sanitized
//
// PRESERVED VERBATIM:
//   - SQL keywords (SELECT, FROM, WHERE, AND, OR, JOIN, etc.)
//   - Well-known SQL function names (sum, count, lower, ltrim, ...)
//   - CFML tag NAMES and ATTRIBUTE NAMES (cfquery / name= / cfsqltype=)
//   - Numeric literals
//   - Punctuation, operators
//   - SQL/CFML comments
//
// Output is structurally identical to input — only proprietary identifiers
// are renamed. A human reviewer can spot-check by skimming the diff.
// ============================================================================

var SANITIZE_SQL_KEYWORDS = {};
[
    'select','distinct','from','where','and','or','not','in','between','like','ilike','is','null','as',
    'on','using','join','inner','left','right','full','outer','cross','natural',
    'group','by','having','order','asc','desc',
    'limit','offset','fetch','next','rows','only','first',
    'union','intersect','except','all',
    'case','when','then','else','end',
    'insert','into','values','returning',
    'update','set','delete',
    'with','recursive','merge','truncate',
    'true','false',
    'cast','over','partition','within','filter',
    'exists'
].forEach(function(k) { SANITIZE_SQL_KEYWORDS[k] = 1; });

// Well-known SQL functions — kept verbatim because they carry no business info.
var SANITIZE_KNOWN_FUNCS = {};
[
    'sum','count','avg','min','max','count_big',
    'lower','upper','ltrim','rtrim','trim','length','char_length',
    'substring','substr','left','right','replace','concat','coalesce','nullif',
    'cast','convert','to_char','to_date','to_number','to_timestamp',
    'date_format','str_to_date','format',
    'now','current_date','current_timestamp','sysdate','getdate',
    'year','month','day','hour','minute','second','dayofweek','dayofmonth','dayofyear',
    'datediff','dateadd','datepart','date_add','date_sub','date_trunc','date_part',
    'abs','ceil','ceiling','floor','round','mod','power','sqrt','exp','ln','log','sign',
    'group_concat','string_agg','listagg',
    'row_number','rank','dense_rank','lag','lead','first_value','last_value','nth_value','ntile',
    'json_extract','jsonb_extract_path','json_value',
    'isnull','ifnull','nvl','decode',
    'preservesinglequotes' // CF-specific, but commonly used; preserve verbatim
].forEach(function(k) { SANITIZE_KNOWN_FUNCS[k] = 1; });

// Position-tracking SQL/CFML tokenizer. Returns {kind, text, start, end}.
function sanitizeTokenize(text) {
    var toks = [];
    var i = 0;
    var n = text.length;
    while (i < n) {
        var c = text[i];
        var startPos = i;
        // CFML markup comment
        if (text.substr(i, 5) === '<!---') {
            var ce = text.indexOf('--->', i + 5);
            if (ce === -1) { toks.push({kind:'COMMENT_CFM', text:text.slice(i), start:i, end:n}); i = n; break; }
            toks.push({kind:'COMMENT_CFM', text:text.slice(i, ce + 4), start:i, end:ce + 4});
            i = ce + 4; continue;
        }
        // SQL line comment
        if (c === '-' && text[i+1] === '-') {
            var j = i;
            while (j < n && text[j] !== '\n') j++;
            toks.push({kind:'COMMENT_SQL', text:text.slice(i, j), start:i, end:j});
            i = j; continue;
        }
        // SQL block comment
        if (c === '/' && text[i+1] === '*') {
            var be = text.indexOf('*/', i + 2);
            if (be === -1) { toks.push({kind:'COMMENT_SQL', text:text.slice(i), start:i, end:n}); i = n; break; }
            toks.push({kind:'COMMENT_SQL', text:text.slice(i, be + 2), start:i, end:be + 2});
            i = be + 2; continue;
        }
        // CFML tag
        if (c === '<' && /^<\/?cf[a-z]/i.test(text.substr(i, 12))) {
            var te = text.indexOf('>', i);
            if (te === -1) { toks.push({kind:'CFML_TAG', text:text.slice(i), start:i, end:n}); i = n; break; }
            toks.push({kind:'CFML_TAG', text:text.slice(i, te + 1), start:i, end:te + 1});
            i = te + 1; continue;
        }
        // CFML expression #...# (## is escape)
        if (c === '#') {
            var j = i + 1;
            while (j < n) {
                if (text[j] === '#') {
                    if (text[j+1] === '#') { j += 2; continue; }
                    break;
                }
                j++;
            }
            toks.push({kind:'CFML_EXPR', text:text.slice(i, j + 1), start:i, end:j + 1});
            i = j + 1; continue;
        }
        // Whitespace — emit as WS token so we can preserve formatting
        if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
            var j = i;
            while (j < n && (text[j]===' '||text[j]==='\t'||text[j]==='\n'||text[j]==='\r')) j++;
            toks.push({kind:'WS', text:text.slice(i, j), start:i, end:j});
            i = j; continue;
        }
        // Strings
        if (c === "'" || c === '"') {
            var q = c;
            var j = i + 1;
            while (j < n) {
                if (text[j] === q) {
                    if (text[j+1] === q) { j += 2; continue; }
                    break;
                }
                j++;
            }
            toks.push({kind: q === "'" ? 'STRING_SQ' : 'STRING_DQ', text:text.slice(i, j + 1), start:i, end:j + 1});
            i = j + 1; continue;
        }
        // Numbers
        if (c >= '0' && c <= '9') {
            var j = i;
            while (j < n && ((text[j] >= '0' && text[j] <= '9') || text[j] === '.')) j++;
            if (j < n && (text[j] === 'e' || text[j] === 'E')) {
                j++;
                if (j < n && (text[j] === '+' || text[j] === '-')) j++;
                while (j < n && text[j] >= '0' && text[j] <= '9') j++;
            }
            toks.push({kind:'NUMBER', text:text.slice(i, j), start:i, end:j});
            i = j; continue;
        }
        // Identifier
        if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_') {
            var j = i;
            while (j < n && /[A-Za-z0-9_]/.test(text[j])) j++;
            var word = text.slice(i, j);
            var lower = word.toLowerCase();
            toks.push({kind: SANITIZE_SQL_KEYWORDS[lower] ? 'KEYWORD' : 'IDENT', text:word, start:i, end:j});
            i = j; continue;
        }
        // Punct (single char — multi-char operators handled by adjacent puncts)
        toks.push({kind:'PUNCT', text:c, start:i, end:i+1});
        i++;
    }
    return toks;
}

function sanitizeSnippet(text) {
    var tokens = sanitizeTokenize(text);
    var n = tokens.length;

    // Mappings (consistent across the whole snippet)
    var maps = { table: {}, column: {}, cfunc: {}, sstr: {}, dstr: {}, expr: {} };
    var counters = { table: 0, column: 0, cfunc: 0, sstr: 0, dstr: 0, expr: 0 };
    var POOL = {
        table: ['t1','t2','t3','t4','t5','t6','t7','t8','t9','t10','t11','t12'],
        column: ['a','b','c','d','e','f','g','h','i','j','k','l','m','n','o','p','q','r','s'],
        cfunc: ['fn1','fn2','fn3','fn4','fn5','fn6'],
        sstr: ['val1','val2','val3','val4','val5','val6','val7','val8'],
        dstr: ['Val1','Val2','Val3','Val4','Val5','Val6'],
        expr: ['x','y','z','w','u','v','p','q']
    };
    function pick(category, original) {
        if (maps[category][original]) return maps[category][original];
        var pool = POOL[category];
        var name = pool[counters[category]] || (category[0] + counters[category]);
        counters[category]++;
        maps[category][original] = name;
        return name;
    }

    // Helper: next non-WS token index (or -1)
    function nextNonWs(from) {
        for (var k = from; k < n; k++) {
            if (tokens[k].kind !== 'WS') return k;
        }
        return -1;
    }
    function prevNonWs(from) {
        for (var k = from; k >= 0; k--) {
            if (tokens[k].kind !== 'WS') return k;
        }
        return -1;
    }

    // Pass 1: tag IDENT tokens with semantic role.
    // States: AFTER_FROM_OR_JOIN → next IDENT is TABLE; the IDENT right
    // after a TABLE (separated only by WS, not a comma/keyword) is its ALIAS
    // (mapped to the same tN). AS keyword between TABLE and ALIAS is OK.
    var roles = new Array(n);  // 'TABLE' | 'TABLE_ALIAS' | 'CUSTOM_FUNC' | 'COLUMN' | undefined
    var awaitingTable = false;
    var lastTableIdx = -1;
    var awaitingAlias = false;

    for (var i = 0; i < n; i++) {
        var t = tokens[i];
        if (t.kind === 'WS' || t.kind === 'COMMENT_SQL' || t.kind === 'COMMENT_CFM') continue;
        if (t.kind === 'KEYWORD') {
            var k = t.text.toLowerCase();
            if (k === 'from' || k === 'join' || k === 'update' || (k === 'into' && i > 0)) {
                awaitingTable = true;
                awaitingAlias = false;
                continue;
            }
            if (k === 'as' && awaitingAlias) {
                continue; // keep awaitingAlias
            }
            // Any other keyword breaks the alias / table-tracking state
            awaitingTable = false;
            awaitingAlias = false;
            continue;
        }
        if (t.kind === 'PUNCT') {
            // `,` after table starts a new table position (if in FROM list)
            if (t.text === ',' && lastTableIdx !== -1 && awaitingAlias) {
                // Comma after `FROM t1, ...` → next IDENT is another table
                awaitingTable = true;
                awaitingAlias = false;
                continue;
            }
            // `(` immediately after IDENT was already handled below
            if (t.text === '(') {
                awaitingAlias = false;
            }
            continue;
        }
        if (t.kind === 'IDENT') {
            var nx = nextNonWs(i + 1);
            var isCall      = nx !== -1 && tokens[nx].kind === 'PUNCT' && tokens[nx].text === '(';
            var isQualifier = nx !== -1 && tokens[nx].kind === 'PUNCT' && tokens[nx].text === '.';
            if (isCall) {
                var lc = t.text.toLowerCase();
                roles[i] = SANITIZE_KNOWN_FUNCS[lc] ? 'KNOWN_FUNC' : 'CUSTOM_FUNC';
                awaitingTable = false;
                awaitingAlias = false;
                continue;
            }
            if (isQualifier) {
                // `tablealias.column` — left side is a table alias regardless
                // of whether we've seen FROM yet. SQL allows forward references.
                roles[i] = 'TABLE_ALIAS';
                awaitingTable = false;
                awaitingAlias = false;
                continue;
            }
            if (awaitingTable) {
                roles[i] = 'TABLE';
                lastTableIdx = i;
                awaitingTable = false;
                awaitingAlias = true;
                continue;
            }
            if (awaitingAlias) {
                roles[i] = 'TABLE_ALIAS';
                awaitingAlias = false;
                continue;
            }
            roles[i] = 'COLUMN';
            continue;
        }
    }

    // Pass 2: build output, preserving original whitespace/punctuation/comments.
    var out = '';
    for (var i2 = 0; i2 < n; i2++) {
        var tok = tokens[i2];
        switch (tok.kind) {
            case 'WS':
            case 'COMMENT_SQL':
            case 'COMMENT_CFM':
            case 'KEYWORD':
            case 'PUNCT':
            case 'NUMBER':
                out += tok.text;
                break;
            case 'IDENT':
                if (roles[i2] === 'TABLE') {
                    // Look ahead for an adjacent TABLE_ALIAS that might already
                    // be mapped (because a `gl.col` qualifier appeared earlier
                    // in the SELECT clause before this `FROM ... gl` line).
                    // If found, reuse its slot so `FROM gen_ledger_detail gl`
                    // becomes `FROM t1 t1` (alias and table point to same name).
                    var tblLc = tok.text.toLowerCase();
                    var aliasIdx = -1;
                    for (var fwd = i2 + 1; fwd < n; fwd++) {
                        if (tokens[fwd].kind === 'WS') continue;
                        if (tokens[fwd].kind === 'KEYWORD' && tokens[fwd].text.toLowerCase() === 'as') continue;
                        if (roles[fwd] === 'TABLE_ALIAS') { aliasIdx = fwd; break; }
                        break;  // hit something else — no alias here
                    }
                    var aliasLc = aliasIdx !== -1 ? tokens[aliasIdx].text.toLowerCase() : null;
                    if (aliasLc && maps.table[aliasLc]) {
                        maps.table[tblLc] = maps.table[aliasLc];
                        out += maps.table[aliasLc];
                    } else {
                        out += pick('table', tblLc);
                    }
                }
                else if (roles[i2] === 'TABLE_ALIAS') {
                    var aliasLc2 = tok.text.toLowerCase();
                    if (maps.table[aliasLc2]) {
                        out += maps.table[aliasLc2];
                    } else {
                        // Find nearest preceding TABLE — share its mapping
                        var tableText = null;
                        for (var bk2 = i2 - 1; bk2 >= 0; bk2--) {
                            if (roles[bk2] === 'TABLE') { tableText = tokens[bk2].text.toLowerCase(); break; }
                        }
                        if (tableText && maps.table[tableText]) {
                            maps.table[aliasLc2] = maps.table[tableText];
                            out += maps.table[tableText];
                        } else {
                            out += pick('table', aliasLc2);
                        }
                    }
                }
                else if (roles[i2] === 'CUSTOM_FUNC')      out += pick('cfunc', tok.text.toLowerCase());
                else if (roles[i2] === 'KNOWN_FUNC')       out += tok.text;
                else                                       out += pick('column', tok.text.toLowerCase());
                break;
            case 'STRING_SQ':
                // 'foo' → 'val1' but preserve #...# CFML interpolation INSIDE.
                out += "'" + sanitizeStringInner(tok.text.slice(1, -1), maps, counters, pick, "'") + "'";
                break;
            case 'STRING_DQ':
                out += '"' + sanitizeStringInner(tok.text.slice(1, -1), maps, counters, pick, '"') + '"';
                break;
            case 'CFML_EXPR':
                // #foo_bar# → #x# (sanitize inner identifier path)
                out += '#' + sanitizeCfmlExprInner(tok.text.slice(1, -1), maps, counters, pick) + '#';
                break;
            case 'CFML_TAG':
                out += sanitizeCfmlTagText(tok.text, maps, counters, pick);
                break;
            default:
                out += tok.text;
        }
    }
    return out;
}

// Inside a string literal, preserve #...# interpolation chunks (sanitize the
// inner expression) but replace the static text with a single 'valN' marker.
// Heuristic: if the string contains at least one '#', split on #...#-runs and
// keep them; otherwise replace the whole string with 'valN'.
function sanitizeStringInner(content, maps, counters, pick, quote) {
    if (content.indexOf('#') === -1) {
        return pick(quote === "'" ? 'sstr' : 'dstr', content);
    }
    // Walk and replace bare text segments with valN, sanitize #...# chunks
    var out = '';
    var i = 0;
    var hadText = false;
    while (i < content.length) {
        if (content[i] === '#') {
            // collect #...# block
            var j = i + 1;
            while (j < content.length && content[j] !== '#') j++;
            out += '#' + sanitizeCfmlExprInner(content.slice(i+1, j), maps, counters, pick) + '#';
            i = j + 1;
            continue;
        }
        // walk to next # or end
        var k = i;
        while (k < content.length && content[k] !== '#') k++;
        var chunk = content.slice(i, k);
        if (chunk.trim() !== '') {
            // replace static chunk with %V where V is val placeholder, but only first time
            if (!hadText) {
                out += '%' + pick(quote === "'" ? 'sstr' : 'dstr', chunk) + '%';
                hadText = true;
            } else {
                out += '%' + pick(quote === "'" ? 'sstr' : 'dstr', chunk) + '%';
            }
        } else {
            out += chunk;
        }
        i = k;
    }
    return out;
}

// Inside #...#, sanitize identifier chain. e.g. `cookie.cookcfnunique` →
// `cookie.x`. Preserve `cookie.` / `session.` / `request.` / `url.` /
// `form.` / `arguments.` prefixes (scopes are not proprietary).
var CF_SCOPE_PREFIXES = { cookie:1, session:1, request:1, url:1, form:1, arguments:1, application:1, server:1, variables:1 };
function sanitizeCfmlExprInner(expr, maps, counters, pick) {
    // If pure function call like fn('...') keep function structure but sanitize args
    // For simplicity: replace any identifier with x/y/z (consistent), keep
    // operators, function calls, scope prefixes, and string literals inside.
    var subToks = sanitizeTokenize(expr);
    var out = '';
    for (var i = 0; i < subToks.length; i++) {
        var st = subToks[i];
        if (st.kind === 'IDENT') {
            var lc = st.text.toLowerCase();
            // Function-call check
            var nx = i + 1;
            while (nx < subToks.length && subToks[nx].kind === 'WS') nx++;
            if (nx < subToks.length && subToks[nx].kind === 'PUNCT' && subToks[nx].text === '(') {
                out += SANITIZE_KNOWN_FUNCS[lc] ? st.text : pick('cfunc', lc);
                continue;
            }
            if (CF_SCOPE_PREFIXES[lc]) {
                out += lc;
                continue;
            }
            out += pick('expr', lc);
        } else if (st.kind === 'STRING_SQ') {
            out += "'" + sanitizeStringInner(st.text.slice(1, -1), maps, counters, pick, "'") + "'";
        } else if (st.kind === 'STRING_DQ') {
            out += '"' + sanitizeStringInner(st.text.slice(1, -1), maps, counters, pick, '"') + '"';
        } else {
            out += st.text;
        }
    }
    return out;
}

// Sanitize a CFML tag's inner text. Most tags have attribute values that
// may contain proprietary data: `<cfquery datasource="real_ds_name" name="qs_real">`.
// We sanitize:
//   - datasource="..." → datasource="ds"
//   - name="..."       → name="q"
//   - value="#...#"    → value="#x#"  (via sanitizeStringInner / sanitizeCfmlExprInner)
//   - template="..."   → template="t.cfm"
// Preserve attribute NAMES and cfsqltype values (they're CFML constants, not data).
function sanitizeCfmlTagText(tag, maps, counters, pick) {
    return tag
        .replace(/datasource\s*=\s*"[^"]*"/gi, 'datasource="ds"')
        .replace(/datasource\s*=\s*'[^']*'/gi, "datasource='ds'")
        .replace(/template\s*=\s*"[^"]*"/gi, 'template="t.cfm"')
        .replace(/template\s*=\s*'[^']*'/gi, "template='t.cfm'")
        .replace(/name\s*=\s*"([^"]*)"/gi, 'name="q"')
        .replace(/name\s*=\s*'([^']*)'/gi, "name='q'")
        .replace(/query\s*=\s*"([^"]*)"/gi, 'query="loop_q"')
        .replace(/value\s*=\s*"([^"]*)"/gi, function(m, v) {
            return 'value="' + sanitizeStringInner(v, maps, counters, pick, '"') + '"';
        })
        .replace(/value\s*=\s*'([^']*)'/gi, function(m, v) {
            return "value='" + sanitizeStringInner(v, maps, counters, pick, "'") + "'";
        })
        .replace(/value\s*=\s*(#[^>\s]*?#)/gi, function(m, v) {
            // bare-#expr# attribute value
            return 'value=#' + sanitizeCfmlExprInner(v.slice(1, -1), maps, counters, pick) + '#';
        });
}

// Escape a string for embedding inside a JS double-quoted literal
// (the form used in tests/run-tests.js token-equivalence cases).
function jsStringEscape(s) {
    return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t').replace(/\r/g, '\\r');
}

// Pull a small (≤ 6-line) snippet around the first match of feature f.key.
// Used to give the human a quick visual sense of what to sanitize.
function extractSnippetForFeature(body, featureKey) {
    var feat = SQL_FEATURES.filter(function(f) { return f.key === featureKey; })[0];
    if (!feat) return '(no pattern)';
    var m = feat.pattern.exec(body);
    if (!m) return '(pattern fell through)';
    feat.pattern.lastIndex = 0; // reset stateful regex
    var lines = body.split('\n');
    // Find which line the match starts on.
    var idx = m.index;
    var sumLen = 0, hitLine = 0;
    for (var i = 0; i < lines.length; i++) {
        sumLen += lines[i].length + 1; // + newline
        if (sumLen > idx) { hitLine = i; break; }
    }
    var ctxStart = Math.max(0, hitLine - 1);
    var ctxEnd   = Math.min(lines.length, hitLine + 4);
    return lines.slice(ctxStart, ctxEnd).map(function(l) { return l.replace(/\t/g, '  '); }).join('\n');
}

// ---------- dispatch ----------
if (opts.mode === 'audit')         modeAudit();
else if (opts.mode === 'targets')  modeTargets();
else if (opts.mode === 'sanitize') modeSanitize();
else { console.error('Unknown mode: ' + opts.mode); process.exit(2); }
