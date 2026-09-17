/**
 * Workflow command emitters for GitHub Actions.
 *
 * - `::group::Title\\n...\\n::endgroup::`         — collapsible log section.
 * - `::notice::text`                              — informational line.
 * - `::warning::text`                             — yellow warning (does not fail the step).
 * - `::error::text`                               — red error log line.
 * - `mask=...`, `add-mask=...`, `add-matcher=...` — workflow command directives.
 *
 * $GITHUB_OUTPUT is the modern way to set action outputs (deprecated command is
 * ::set-output::). When tests run outside a GH Actions runner, the file pointer
 * is absent; callers should guard for that case.
 */
export function group(title, fn) {
    console.log(`::group::${escape(title)}`);
    try {
        fn();
    }
    finally {
        console.log('::endgroup::');
    }
}
export function groupAsync(title, fn) {
    console.log(`::group::${escape(title)}`);
    return fn().finally(() => {
        console.log('::endgroup::');
    });
}
export function notice(text) {
    console.log(`::notice::${escape(text)}`);
}
export function warning(text) {
    console.log(`::warning::${escape(text)}`);
}
export function error(text) {
    console.log(`::error::${escape(text)}`);
}
export function writeOutput(name, value) {
    const filePath = process.env.GITHUB_OUTPUT;
    if (!filePath)
        return;
    const safe = escape(String(value ?? ''));
    require('node:fs').appendFileSync(filePath, `${name}=${safe}\n`, 'utf8');
}
export function appendSummary(markdown) {
    const filePath = process.env.GITHUB_STEP_SUMMARY;
    if (!filePath)
        return;
    require('node:fs').appendFileSync(filePath, markdown.endsWith('\n') ? markdown : `${markdown}\n`, 'utf8');
}
function escape(text) {
    return String(text ?? '').replace(/%/g, '%25').replace(/\r?\n/g, '%0A');
}
