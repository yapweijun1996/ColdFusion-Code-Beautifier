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
    mode:    'audit',
    file:    null,
    dialect: 'postgresql',
    write:   true,
    corpus:  path.join('sample', 'sample_cfm')
};
for (var ai = 0; ai < argv.length; ai++) {
    var a = argv[ai];
    if      (a === '--audit')    opts.mode = 'audit';
    else if (a === '--targets')  opts.mode = 'targets';
    else if (a === '--sanitize') opts.mode = 'sanitize';
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
    else if (a === '--no-write') opts.write = false;
    else if (a === '--file')     opts.file = argv[++ai];
    else if (a === '--dialect')  opts.dialect = argv[++ai];
    else if (a === '--corpus')   opts.corpus = argv[++ai];
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
                        snippet: extractSnippetForFeature(body, k)
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
    }
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
