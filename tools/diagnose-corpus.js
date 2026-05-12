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

// ---------- dispatch ----------
if (opts.mode === 'audit')   modeAudit();
else if (opts.mode === 'targets') modeTargets();
else { console.error('Unknown mode: ' + opts.mode); process.exit(2); }
