# @agentsmarket/pipeline-action

GitHub Action that runs an agentsmarket `pipeline.yaml` inside a step. Streams each stage as a collapsible GH log group, then sets action outputs with stage results, wall-clock duration, and estimated cost.

## Status

v0.3.0 — `context_mode` input (TASKS row 90) + exponential backoff retry for 429/5xx + per-job pipeline source cache + pre-step `agentsmarket validate`. Builds on v0.2.1's provider selection and step-summary report. The pre-step requires `@agentsmarket/cli` (npm, v0.9.0+) — installable from any runner with `npx`. LLM-only stages work; `uses:` skill stages surface "skill not found" (R12.2-R12.4 ship marketplace-fetched skills).

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
