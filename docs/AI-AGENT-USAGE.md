# AI Agent Usage

This project provides a local command-line beautifier for AI coding agents. It
does not require an MCP server or a custom hosted service: the agent starts a
local Node.js process and passes source through stdin or a local file.

The same CLI works with Codex CLI, Gemini CLI, Claude Code, and any other agent
that can run `npx`, npm, or a Node.js command. The formatter supports CFML,
HTML, JavaScript, CSS, and SQL. PHP is not currently supported.

## Recommended agent workflow

1. Preserve the original source and inspect the repository instructions.
2. Run the formatter with `--stdout` for a buffer, or write a separate output
   file for a file-based change.
3. Review the formatted result and diff before applying it.
4. Run the project's tests or language-specific validation after the change.

The CLI performs formatting locally. Source code is not uploaded.

## NPM usage

Use the published NPM CLI directly:

```bash
npx coldfusion-code-beautifier source.cfm --stdout
```

To pin the current release in automation:

```bash
npx --yes --package coldfusion-code-beautifier@1.0.1 \
  coldfusion-code-beautifier source.cfm --stdout
```

PowerShell equivalents:

```powershell
Get-Content .\source.cfm -Raw |
  npx --yes --package coldfusion-code-beautifier@1.0.1 `
    coldfusion-code-beautifier - --stdout --language cfml

npx --yes --package coldfusion-code-beautifier@1.0.1 `
  coldfusion-code-beautifier .\source.cfm --stdout --language cfml `
  | Set-Content .\source_beautified.cfm -Encoding utf8
```

When the package is installed globally, replace the `npx --yes --package ...`
prefix with `coldfusion-code-beautifier`.

For macOS/Linux automation, fail fast and keep the original recoverable:

```bash
set -Eeuo pipefail

input="source.cfm"
output="$(mktemp "${TMPDIR:-/tmp}/cfml-beautified.XXXXXX")"
trap 'rm -f "$output"' EXIT

npx --yes --package coldfusion-code-beautifier@1.0.1 \
  coldfusion-code-beautifier "$input" --stdout --language cfml > "$output"

test -s "$output"
diff -u "$input" "$output" || true  # review before applying
```

Only replace the source after reviewing the diff and when the repository
workflow explicitly permits it. Do not use `|| true` on the formatter command;
in the example it is used only so a non-identical diff does not abort review.

For repeated use, install it globally or add it to the agent's environment:

```bash
npm install --global coldfusion-code-beautifier
coldfusion-code-beautifier source.cfm --stdout
```

`npx` downloads the package from NPM, then runs it locally. Source code is not
uploaded to this project or to a custom service.

## GitHub fallback

If NPM is unavailable, clone the repository and run the same CLI:

```bash
git clone https://github.com/yapweijun1996/ColdFusion-Code-Beautifier.git
cd ColdFusion-Code-Beautifier
node tools/beautify-file.js source.cfm --stdout
```

For file output, omit `--stdout`:

```bash
node tools/beautify-file.js path/to/source.cfm
```

The source remains unchanged and the default output is:

```text
path/to/source_beutifier.cfm
```

For an agent working with a buffer:

```bash
printf '%s' '<cfset x = 1>' | coldfusion-code-beautifier - --stdout
```

## Useful options

```bash
# Force a language
coldfusion-code-beautifier source.cfm --language cfml --stdout
coldfusion-code-beautifier source.sql --language sql --stdout
coldfusion-code-beautifier source.js --language js --stdout

# Use the committed multi-dialect SQL formatter
coldfusion-code-beautifier source.cfm --pro-sql --dialect postgresql --stdout

# Normalize leading spaces before formatting
coldfusion-code-beautifier source.cfm --normalize-indent --indent-width 4 --stdout
```

The default pipeline uses Auto language detection, Deep SQL/CSS/JS, and
continuation-alignment preservation. Disable stages with `--no-deep-sql`,
`--no-deep-css`, `--no-deep-js`, or `--no-preserve-continuation-alignment`.

## Privacy and limitations

- Formatting runs locally; source code is not uploaded.
- The CLI uses the same production formatter scripts as the web UI through a
  small Node VM-backed DOM harness.
- UTF-8 (with/without BOM) and BOM-marked UTF-16LE/UTF-16BE inputs are decoded
  and written back using the same encoding/BOM; LF/CRLF style is also preserved.
- Semantic Indent is currently browser-only and remains opt-in.
- The `_beutifier.cfm` spelling is intentional for compatibility with the
  existing project output convention.

## Provider-specific setup

No provider-specific plugin is required. Give the agent the same instruction:

> Use `coldfusion-code-beautifier` through NPM when available. Use `--stdout`
> for buffer formatting, preserve the original source, inspect the diff, and
> do not commit proprietary source fixtures.

Examples:

- **Codex CLI** — ask Codex to run the NPM command in the repository and review
  the diff.
- **Gemini CLI** — allow the local shell command, then ask Gemini to validate
  the resulting file and tests.
- **Claude Code** — instruct Claude Code to use the same NPM command before
  editing or committing formatted files.

The command and safety workflow are identical across these agents.

## Copyable prompts

These prompts are intentionally provider-neutral and can be pasted into the
corresponding CLI.

### Codex CLI

```text
Use coldfusion-code-beautifier@1.0.1 to format the requested CFML, HTML,
JavaScript, CSS, or SQL files. Preserve the original source, use --stdout or a
separate _beutifier.cfm output when appropriate, inspect the diff, and run the
relevant project tests before reporting completion. Do not commit unrelated
changes or proprietary fixtures.
```

### Gemini CLI

```text
Format the requested source locally with:
npx --yes --package coldfusion-code-beautifier@1.0.1 coldfusion-code-beautifier
Use the correct --language when needed. Keep the original file recoverable,
review the diff for unintended changes, and run the relevant tests or syntax
checks. Report the files changed and validation performed.
```

### Claude Code

```text
Before editing the requested files, use the local NPM CLI
coldfusion-code-beautifier@1.0.1 for CFML, HTML, JavaScript, CSS, or SQL.
Prefer stdin/stdout for previews and separate output files for file mode.
Never overwrite the original without an explicit request. Review the final
diff, run relevant tests, and summarize any formatter limitations.
```

### Generic Node/npm agent

```text
Use the published local formatter package
coldfusion-code-beautifier@1.0.1. It requires Node.js and does not require an
MCP server. Format only the requested files, preserve originals, inspect the
diff, and validate the result before applying or committing it.
```

## Agent instruction example

> Use `coldfusion-code-beautifier` through NPM when available; otherwise clone
> the GitHub repository and run `node tools/beautify-file.js`. Use `--stdout`
> for buffer formatting, inspect the result, preserve the original source, and
> do not commit proprietary source fixtures from `sample_codebase/`.
