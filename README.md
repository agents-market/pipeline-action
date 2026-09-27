# @agentsmarket/pipeline-action

GitHub Action that runs an agentsmarket `pipeline.yaml` inside a step. Streams each stage as a collapsible GH log group, then sets action outputs with stage results, wall-clock duration, and estimated cost.

## Status

**v0.4.0 — provider fallback + SARIF output.** Adds two opt-in capabilities on top of v0.3.1:

1. **Provider fallback** (`TASKS row 105`): when `fallback_provider` is configured AND its API key is available, the primary provider is wrapped in a `FallbackProvider` that catches transient errors (429 rate-limit, 408 / connection timeout, HTTP 5xx) and retries the same prompt on the fallback. New observability outputs (`provider_used`, `cost_primary_usdc`, `cost_fallback_usdc`, `provider_primary_error`) surface which path served the call. Backward-compatible: when no fallback is configured, the primary is used directly — `buildExecutorDeps` returns the same shape v0.3.x consumers expect.
2. **SARIF output** (`TASKS row 106`): new `output_format` input (`summary` \| `sarif`) emits a SARIF 2.1.0 document on `findings_sarif` for upload to GitHub Code Scanning via `github/codeql-action/upload-sarif@v3`. Pure additive — summary outputs ALWAYS fire regardless of `output_format`, so v0.3.x consumers see no change unless they opt in.

All v0.3.1 outputs preserved (`findings_json`, `summary_only_findings_json`, `findings_count_json`, `status`, `failed_count`, `max_severity`, `result_json`, `total_ms`, `total_cost_usdc`, `stage_count`, per-stage `stage_<id>_ms` + `stage_<id>_output`). v0.3.0 still ships the `context_mode` input, exponential backoff retry, per-job pipeline source cache, pre-step `agentsmarket validate`. **Consumer contract:** v0.4.0 is fully backward-compatible — consumers wiring v0.3.1 outputs continue to work unchanged. New: opt into `output_format: sarif` to surface findings in GitHub's Security tab.

## Usage

```yaml
# .github/workflows/my-pipeline.yml
name: my-pipeline
on: [pull_request]

jobs:
  run:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: agents-market/pipeline-action@v1
        with:
          api_key: ${{ secrets.MINIMAX_API_KEY }}
          pipeline_yaml: |
            name: pr-summary
            stages:
              - id: summarize
                prompt: "Summarize this PR in 1 sentence."
                input: { title: "${{ github.event.pull_request.title }}" }
```

## Inputs

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `api_key` | no | — (uses provider env var, see below) | LLM provider API key |
| `provider` | no | `minimax` | LLM provider: `minimax` \| `openai` \| `anthropic` \| `openrouter` |
| `pipeline_file` | no | — | Path to `pipeline.yaml`. Mutually exclusive with `pipeline_yaml` |
| `pipeline_yaml` | no | — | Inline YAML body. Mutually exclusive with `pipeline_file` |
| `model` | no | `MiniMax-M3` | Default model identifier (must be supported by `provider`) |
| `inputs_json` | no | `{}` | JSON object passed to pipeline `inputs` |
| `fail_fast` | no | `true` | Stop on first stage error |
| `mock` | no | `false` | Use deterministic mock provider (no real API) |
| `context_mode` | no | `imports` | How much code context the LLM sees beyond the PR diff. One of `diff` (PR diff only, ~1x cost), `imports` (diff + imported types, ~3x), `related` (diff + files importing changed files, ~10x), `full` (diff + all `.ts`/`.py` files, ~100x). The actual fetching is `pipeline-runtime`'s responsibility — see TASKS row 90. |
| `output_format` | no | `summary` | v0.4.0 — Format for downstream findings emission. `summary` (default) keeps v0.3.x behaviour: only the `findings_json` + `summary_only_findings_json` outputs. `sarif` additionally emits `findings_sarif` (SARIF 2.1.0 JSON) for upload to GitHub Code Scanning via `github/codeql-action/upload-sarif@v3`. Pure additive — summary outputs ALWAYS fire regardless of this input. |

## Providers

Supported providers: **MiniMax** (default), **OpenAI**, **Anthropic**, **OpenRouter** (multi-model gateway).

The API key resolves from the `api_key` input first, then from the provider-specific env var:

| Provider | Env var | Example models |
|----------|---------|----------------|
| `minimax` (default) | `MINIMAX_API_KEY` | `MiniMax-M3`, `MiniMax-M2.7` |
| `openai` | `OPENAI_API_KEY` | `gpt-4`, `gpt-4-turbo`, `gpt-3.5-turbo` |
| `anthropic` | `ANTHROPIC_API_KEY` | `claude-3-opus-20240229`, `claude-3-sonnet-20240229`, `claude-3-haiku-20240307` |
| `openrouter` | `OPENROUTER_API_KEY` | `openai/gpt-4o`, `anthropic/claude-3.5-sonnet`, … |

```yaml
- uses: agents-market/pipeline-action@v1
  with:
    provider: openai
    model: gpt-4-turbo
    api_key: ${{ secrets.OPENAI_API_KEY }}
    pipeline_yaml: |
      name: pr-summary
      stages:
        - id: summarize
          prompt: "Summarize this PR in 1 sentence."
```

A mismatched key fails fast with a debuggable message, e.g. `provider: openai` with only `MINIMAX_API_KEY` set errors naming the missing `OPENAI_API_KEY` secret. Every error names the provider + model in context.

Each run appends a step-summary report (`$GITHUB_STEP_SUMMARY`) with pipeline name, provider, model, total cost, duration and stage count.

## Outputs

| Name | Description |
|------|-------------|
| `result_json` | JSON-stringified record of `stage_id -> output_text` |
| `total_ms` | Wall-clock pipeline duration |
| `total_cost_usdc` | Estimated cost with 6 decimals |
| `stage_count` | Number of stages declared |
| `stage_<id>_ms` | Per-stage wall-clock |
| `stage_<id>_output` | Per-stage output text |
| `findings_json` | (PR-review only) `JSON.stringify` of `formatFindings(result.outputs)` — flat array of `ReviewFinding` with severity / file / line / message / cwe / confidence / recommendation. Merged across all stages, deduped by `(file, line, cwe)`. |
| `findings_count_json` | (PR-review only) `JSON.stringify` of `{ critical, high, medium, low }` — count by severity across all merged findings. |
| `summary_only_findings_json` | (PR-review only) `JSON.stringify` of `filterBySeverity(findings, severity_threshold)` — only findings at or above the threshold. Empty array if none. |
| `status` | (PR-review only) `'passed'` or `'failed'` — based on `computeStatus(findings, fail_on)`. Default fail-on = `critical`. |
| `failed_count` | (PR-review only) integer — number of findings with severity at or above `fail_on`. |
| `max_severity` | (PR-review only) highest severity seen (`'critical' \| 'high' \| 'medium' \| 'low'`) or empty string when no findings. |
| `findings_sarif` | (v0.4.0, PR-review only) SARIF 2.1.0 JSON document of findings — only emitted when `output_format` is `sarif`. Same findings as `findings_json`, remapped to SARIF shape with `ruleId` (CWE), `level` (error/warning/note), `locations`, `partialFingerprints` for dedup, and severity/confidence/recommendation in `properties`. See [SARIF Output](#sarif-output-v040) below for the upload pattern. |

## PR-review consumer contract

For pipelines that emit `findings[]` (e.g. `code-review-security-audit`, `code-review-vulnerability-detection`, `api-design-reviewer`, `style-review`), the action emits the structured outputs above. **The action does NOT call the GitHub API** — the caller (consumer repo workflow) reads the outputs and posts:

1. **Inline PR review comments** for `critical` / `high` findings via `gh api ... /repos/{owner}/{repo}/pulls/{n}/comments` (or `actions/github-script`). Each comment carries the severity, optional CWE link, and the recommendation. See `examples/integrations/code-review-workflow.yml` for the canonical pattern.
2. **A GitHub status check** via `gh api ... /repos/{owner}/{repo}/statuses/{sha}` (or the Checks API). Read `status`, `failed_count`, and `max_severity` — render `success` when `status == passed`, `failure` when `failed`. This is the consumer wiring Agent A is responsible for in web3eco repos.

### Inputs that drive the PR-review outputs

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `severity_threshold` | no | `low` | Minimum severity to include in `summary_only_findings_json` and the in-summary "Findings above threshold" section. One of `critical \| high \| medium \| low \| all`. Backward-compat: default `low` keeps every finding (same as v0.2.x). Read via env var `INPUT_SEVERITY_THRESHOLD`. |
| `fail_on` | no | `critical` | Severity floor for `status = failed`. Same enum as `severity_threshold`. Unknown values fall back to `critical` (safe — never silently greenwashes a critical finding). Read via env var `INPUT_FAIL_ON`. |

### Assumed pipeline output shape

The dedupe + extract logic in `formatFindings` (`src/output-formatter.ts`) supports two cases:

1. **JSON shape (preferred)** — each stage output is JSON, either:
   - `{ "findings": [...] }` (the `output_format: structured_json` convention used by all 8 wedges), or
   - a bare array `[...]`, or
   - a single finding object.
2. **Plain text (best-effort)** — fallback regex extracts `(critical|high|medium|low) … in <path>[:<line>]` lines. Confidence is fixed at `0.5` so the structured version wins on dedupe. Documented as lossy.

Field-name normalization: wedges vary between `path` / `file`, `description` / `message`, `cwe_id` / `cwe`, `fix_suggestion` / `recommendation`. All variants normalize to the canonical `ReviewFinding` shape.

## SARIF Output (v0.4.0)

Set `output_format: sarif` to emit a SARIF 2.1.0 document on the `findings_sarif` output alongside the existing summary outputs. SARIF is the [OASIS standard](https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html) that GitHub Code Scanning understands natively — upload it and your findings show up in the PR's "Security" tab, same UX as CodeQL / Snyk / Dependabot.

### Severity mapping

Severity maps to SARIF `level` per GitHub Code Scanning guidance:

| `findings[].severity` | SARIF `level` |
|------------------------|---------------|
| `critical`             | `error`       |
| `high`                 | `error`       |
| `medium`               | `warning`     |
| `low`                  | `note`        |

### `ruleId` selection

- When the finding has a `cwe` field (e.g. `CWE-798`), the SARIF `ruleId` is the CWE — the same cross-scanner identifier Code Scanning uses for CodeQL alerts, so consumers can filter Code Scanning views by CWE.
- When `cwe` is absent, the SARIF `ruleId` is `REVIEW-<hash>` derived from a stable hash of `(file, line, cwe, message)` so re-runs on the same finding dedupe to the same rule.

### `partialFingerprints`

Each result carries a `partialFingerprints.agentsmarketPipelineActionV1` field — an FNV-1a 32-bit hash of `(file, line, cwe, message)` encoded as 8 lowercase hex chars. Code Scanning uses this to dedupe alerts across runs.

### `versionControlProvenance`

When the action is invoked from a `pull_request` event (i.e. `GITHUB_REPOSITORY` + `GITHUB_SHA` are set), the SARIF log carries a `versionControlProvenance` block linking the run to `https://github.com/<repo>` + the commit SHA + branch. Code Scanning uses this to anchor alerts to commits and enable the "View on GitHub" affordance.

### Consumer workflow example

```yaml
name: ai-review-with-code-scanning
on: [pull_request]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: agents-market/pipeline-action@v1
        id: review
        with:
          api_key: ${{ secrets.MINIMAX_API_KEY }}
          pipeline_file: ./pipelines/code-review.yaml
          output_format: sarif          # ← opt-in: emits findings_sarif

      - name: Upload findings to GitHub Code Scanning
        if: always()                   # upload even on failures — partial findings still useful
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: ${{ steps.review.outputs.findings_sarif }}
          category: agentsmarket-pipeline-action
```

The `category` input disambiguates alerts from this action from any other Code Scanning tool (CodeQL, third-party scanners) — alerts appear in the Security tab grouped by category.

### Backward compatibility

- `output_format` defaults to `summary` — existing v0.3.x consumers see ZERO behaviour change. The summary outputs (`findings_json`, `summary_only_findings_json`, etc.) ALWAYS fire regardless of `output_format`.
- `findings_sarif` is only written when `output_format='sarif'`. When the input is omitted or `summary`, the SARIF path is never entered — no extra CPU, no extra bundle size at runtime.
- The SARIF JSON is built from the same `findings` array as `findings_json`, so the two outputs are guaranteed consistent (same source, different shape).

## v0.3.0 runtime behavior

### `context_mode`

Controls how much code context the LLM sees beyond the PR diff. Default `imports`. Cost ratios are heuristic guidance — actual fetching is `pipeline-runtime`'s responsibility, so the action simply declares the mode on the executor deps.

```yaml
- uses: agents-market/pipeline-action@v1
  with:
    provider: openai
    model: gpt-4-turbo
    api_key: ${{ secrets.OPENAI_API_KEY }}
    pipeline_file: ./pipelines/review.yaml
    context_mode: related     # diff | imports (default) | related | full
```

Unknown values throw with the supported list + default in the error message.

### Exponential backoff retry

The LLM pipeline call is wrapped in an exponential-backoff retry. Retries fire only on transient errors:

- HTTP 429 (rate limit)
- HTTP 5xx (server error)
- SDK `RateLimitError`-class names (Anthropic, OpenAI, OpenRouter)
- The Anthropic literal `Token Plan usage limit reached`

Non-retryable errors (4xx other than 429, auth errors, validation errors) short-circuit immediately — never waste money retrying a bad request.

Backoff formula: `min(baseDelayMs * 2^attempt, maxDelayMs)` with ±20% jitter. Defaults: `maxRetries=3`, `baseDelayMs=1000ms`, `maxDelayMs=30000ms`.

Each retry emits a `::notice::` line to `$GITHUB_STEP_SUMMARY`:

```
↻ retry 2/3 after 2000ms (RateLimitError: provider returned 429)
```

### Pipeline source cache

When `pipeline_file` is used, the action caches the file content on disk at `$RUNNER_TEMP/pipeline-action-cache/` for the lifetime of the GH Actions job. Matrix builds and multi-step workflows within the same job skip the disk read on subsequent invocations.

Cache invalidation: every read re-stats the source file; a mtime or size mismatch forces a re-fetch. `$RUNNER_TEMP` is wiped between jobs by GH Actions — no manual cleanup required.

The cache is logged to the step summary:

```
↓ pipeline source cache populated: ./pipelines/review.yaml (1247 bytes)
↻ pipeline source cache hit: ./pipelines/review.yaml
```

### Pre-step `agentsmarket validate`

The action runs `npx @agentsmarket/cli@^0.9.0 validate <pipeline_file>` BEFORE the main step. If the spec fails validation, the action fails before any LLM call is made (no money wasted on a malformed spec). Inline `pipeline_yaml` consumers skip the pre-step (the main step's `loadPipelineYaml` still validates the spec).

Requires `@agentsmarket/cli` to be installable from npm (it is — v0.9.0+ is published).

## Local development

```bash
# Install workspace deps
pnpm install

# Build
pnpm --filter @agentsmarket/pipeline-action build

# Test
pnpm --filter @agentsmarket/pipeline-action test

# Run against a pipeline
node packages/pipeline-action/dist/index.js \
  --pseudocode # not yet supported — use GH Actions runner instead
```

## Architecture

```
src/
  index.ts          Entry point: read inputs, resolve pipeline, build deps, run
  inputs.ts         Action input parser/validator (provider, context_mode, etc.)
  pipeline-source.ts  Resolve pipeline_yaml vs pipeline_file
  executor-deps.ts  Build StageExecutorDeps (provider, registry, pricing, model resolver, context_mode)
  run.ts            Main flow: load → expand → execute → emit outputs (wrapped in withRetry)
  streaming.ts      Workflow commands (::group::, ::notice::, ::set-output) + writeActionSummary
  retry.ts          (v0.3.0) withRetry<T>() — exponential backoff for 429/5xx
  source-cache.ts   (v0.3.0) getCachedPipelineSource — per-job memoization of pipeline.yaml reads
  output-formatter.ts  (v0.3.0) formatFindings / filterBySeverity / dedupeFindings / countFindings — PR-review output layer
  status-check.ts   (v0.3.0) computeStatus — pass/fail decision from findings
examples/
  pr-summary.pipeline.yaml  Sample inline pipeline
```

## Roadmap

- **R12.2-R12.4** — marketplace-fetched `uses:` skills (github-pr-context, github-pr-comment, github-review-submit)
- **R12.5** — sample code-review pipeline (uses the GH skills once shipped)
- **R12.6** — public Action repo `agents-market/code-review@v1`
- **R12.7** — Docker image w/ cosign signing (depends on R11)
