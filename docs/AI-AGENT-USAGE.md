# AI Agent Usage

This project provides a serverless command-line beautifier for AI coding
agents. It does not require MCP or a custom server: the agent starts a local
Node.js process and passes source through stdin or a local file.

## NPM usage

After the package is published, use the versioned NPM CLI directly:

```bash
npx coldfusion-code-beautifier source.cfm --stdout
```

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

## Agent instruction example

> Use `coldfusion-code-beautifier` through NPM when available; otherwise clone
> the GitHub repository and run `node tools/beautify-file.js`. Use `--stdout`
> for buffer formatting, inspect the result, preserve the original source, and
> do not commit proprietary source fixtures from `sample_codebase/`.
