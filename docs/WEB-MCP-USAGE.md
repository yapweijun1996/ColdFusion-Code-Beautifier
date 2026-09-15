# Web MCP Usage

The GitHub Pages demo can be used by a Web MCP agent through browser
automation. This path does not require an MCP server, API key, deployment, or
additional hosting cost.

Demo: <https://yapweijun1996.github.io/ColdFusion-Code-Beautifier/>

## Browser workflow

1. Open the demo link in the agent's browser.
2. Paste source code into the input editor.
3. Select `Auto`, `CFML / HTML`, `JavaScript`, or `SQL`.
4. Enable or disable Deep SQL, Deep CSS, and Deep JS as required.
5. Click **Beautify**.
6. Read the output editor and compare it with the original source.
7. Copy or save the result only after reviewing the change.

CSS is formatted through `<style>` blocks in CFML/HTML input. SQL is formatted
standalone or inside `<cfquery>`. PHP is not supported.

## When to use Web MCP

Use Web MCP when the agent has browser access but cannot run local Node.js.
For repeatable repository edits, batch processing, CI, or large files, prefer
the NPM CLI because it avoids DOM selectors, clipboard permissions, browser
timeouts, and page-update prompts.

The browser path is an interaction workflow, not a native `beautify_code` MCP
tool. The page runs the formatter locally in the browser and does not upload
the source.

## Safety checklist

- Keep the original source until the output has been reviewed.
- Turn off Auto-copy for sensitive code when clipboard access is unnecessary.
- Use Safe Mode when only conservative CFML indentation is desired.
- Review the diff; formatting output is not a semantic compiler check.
