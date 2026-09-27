# Changelog — `@agentsmarket/pipeline-action`

## v0.3.0 (2026-09-27)

> Single v0.3.0 release consolidating the core plumbing (Agent B) and output layer (Agent C) work. All changes are additive; v0.2.1 consumers see zero behaviour change unless they opt into the new inputs.

### Added — Core plumbing (Agent B)

#### `context_mode` input (TASKS row 90)
- New action input `context_mode` (enum: `diff` | `imports` | `related` | `full`, default `imports`) declaring how much code context the LLM sees beyond the PR diff:
  - `diff` — PR diff only (~1x cost baseline).
  - `imports` — diff + imported types (~3x, default).
  - `related` — diff + files importing changed files (~10x).
  - `full` — diff + every `.ts`/`.py` file in repo (~100x).
- The actual file-fetching is `pipeline-runtime`'s responsibility. This release wires the declaration through `ActionInputs` → `buildExecutorDeps` so a future runtime version that grows a `context_mode` reader picks it up without an action-side change.
- New `ContextMode` type, `SUPPORTED_CONTEXT_MODES`, `DEFAULT_CONTEXT_MODE`, and `normalizeContextMode()` validator in `src/inputs.ts`. Unknown values throw with the supported list + default in the error message.
- The `[provider=… model=…]` log tag in `run.ts` now includes `context=<mode>`.

#### Exponential backoff retry for 429 / 5xx
- New `src/retry.ts` exporting `withRetry<T>(fn, opts)` with a fully-typed `RetryOpts` interface (`maxRetries`, `baseDelayMs`, `maxDelayMs`, `jitter`, `retryableErrors`, `onRetry`, `sleep`).
- Retries ONLY on transient errors: HTTP 429, HTTP 5xx, SDK `RateLimitError`-class names, and the Anthropic literal `Token Plan usage limit reached`. 4xx other than 429 and auth errors short-circuit immediately — never waste money retrying a bad request.
- Backoff: `min(baseDelayMs * 2^attempt, maxDelayMs)` with optional ±20% jitter (defaults to `maxRetries=3`, `baseDelayMs=1000`, `maxDelayMs=30000`, `jitter=true`).
- Wired into `run.ts`: the `runPipelineV2` call is wrapped in `withRetry(...)`. Each retry emits a `::notice::` line to `$GITHUB_STEP_SUMMARY` (`↻ retry N/3 after Xms (ErrorName: message)`) before the next attempt fires.

#### Pipeline source cache (per-job temp)
- New `src/source-cache.ts` exporting `getCachedPipelineSource(file, fetchFn)` that memoizes `pipeline.yaml` reads on disk for the lifetime of a single GH Actions job.
- Cache location: `$RUNNER_TEMP/pipeline-action-cache/` — wiped automatically between jobs by GH Actions, no manual cleanup.
- Cache key: SHA-256 of the absolute file path. Cache value: JSON record `{ content, mtimeMs, size }` written atomically via a unique `.tmp` rename so concurrent readers never see a partial file.
- Invalidation: every read re-stats the source file; mtime or size mismatch forces a re-fetch (defense against clock skew on some filesystems).
- Wired into `run.ts`: when `params.resolved_from === 'file'`, we warm the cache and log `↻ pipeline source cache hit: …` or `↓ pipeline source cache populated: … (N bytes)` to the step summary. Matrix builds and multi-step workflows within the same job skip the disk read.

#### Pre-step `agentsmarket validate`
- New `runs.pre` step in `action.yml` that runs `npx @agentsmarket/cli@^0.9.0 validate <pipeline_file>` BEFORE the main `node20` step.
- Behaviour:
  - `pipeline_file` valid → `validation_status=passed`, main runs.
  - `pipeline_file` invalid → `validation_status=failed`, pre-step exits 1, GH Actions fails the action before main is invoked. No LLM dollars wasted on a malformed spec.
  - `pipeline_yaml` (inline) provided → `validation_status=skipped`; the main step's `loadPipelineYaml` still validates the spec.
- The pre-step's fail-fast exit code is the gate (node actions don't expose `if:` on `runs.main`, but a non-zero exit from a `pre` step short-circuits before main).
- Requires `@agentsmarket/cli` to be installable from npm (it is — v0.9.0+ is published).

### Added — Output layer (Agent C)

#### Structured JSON findings output
- New `src/output-formatter.ts` module — `formatFindings(rawOutput)` parses `Record<stage_id, string>` into a flat `ReviewFinding[]`.
- Normalizes wedge field aliases (`path`/`file`, `description`/`message`, `cwe_id`/`cwe`, `fix_suggestion`/`recommendation`) into the canonical `ReviewFinding` shape: `{ severity, file, line?, message, cwe?, confidence, recommendation? }`.
- Merges findings across stages and dedupes by `(file, line, cwe)` — keeps the highest-confidence occurrence.
- New action outputs `findings_json` (full array) + `findings_count_json` (`{ critical, high, medium, low }`).
- Regex fallback for plain-text stage outputs (best-effort, documented as lossy). Confidence fixed at `0.5` so the structured version wins on dedupe when both exist.

#### Severity filter
- `filterBySeverity(findings, threshold)` exported from `output-formatter.ts`. Threshold = `critical | high | medium | low | all`. Unknown values fall back to `'low'` (backward compat — same as v0.2.x which listed every finding).
- New action input `severity_threshold` (env var `INPUT_SEVERITY_THRESHOLD`, default `'low'`). Read directly via `process.env` in `output-formatter.ts` — bypasses `src/inputs.ts` to keep the module self-contained.
- New action output `summary_only_findings_json` — `JSON.stringify` of the filtered set.
- Step-summary section `### Findings above threshold` lists the filtered findings with severity, file:line, optional CWE, and confidence.

#### GitHub status check pass/fail
- New `src/status-check.ts` module — `computeStatus(findings, failOn)` returns `{ status: 'passed' | 'failed', failed_count, max_severity }`. Default `failOn` = `'critical'` (any critical finding = fail). Unknown values fall back to `'critical'` (safe default — never silently greenwashes).
- New action input `fail_on` (env var `INPUT_FAIL_ON`, default `'critical'`). Same self-contained env-var-read pattern as `severity_threshold`.
- New action outputs `status` (passed/failed), `failed_count` (integer), `max_severity` (highest severity or empty).
- Step-summary adds a `| Status |` row with ✅/❌ badge + failing count + max severity.
- **Pipeline-action itself does NOT call the GitHub API.** Consumer workflows read these outputs and post the status check via `gh api` or `actions/github-script` — see `README.md` "PR-review consumer contract" + `examples/integrations/code-review-workflow.yml` for the canonical pattern.

### Tests (152 passing, 1 skipped)
- `tests/inputs.test.ts` — 8 new tests for `normalizeContextMode`.
- `tests/retry.test.ts` (NEW) — 23 tests for `withRetry`, `computeBackoffMs`, `defaultRetryable`.
- `tests/source-cache.test.ts` (NEW) — 10 tests for miss→hit lifecycle, mtime/size invalidation, concurrent reads, atomic write.
- `tests/output-formatter.test.ts` (NEW) — 56 tests covering structured findings, severity filter, status check, helpers.
- Extended `tests/streaming.test.ts` — 8 new tests for `writeActionSummary` additive rendering.
- Existing test helpers in `tests/{run,provider,provider-integration,pipeline-source}.test.ts` updated to include the new required `context_mode` field — no expectation changes.

### Compatibility
- **Additive only.** All v0.2.1 inputs (`api_key`, `provider`, `pipeline_file`, `pipeline_yaml`, `model`, `inputs_json`, `fail_fast`, `mock`) keep their defaults and semantics.
- All v0.2.1 outputs (`result_json`, `total_ms`, `total_cost_usdc`, `stage_count`, per-stage outputs) keep their shape and values.
- `context_mode` defaults to `imports` (additive — v0.2.1 had no such input).
- `severity_threshold` defaults to `'low'` (equivalent to v0.2.x behaviour of listing every finding).
- `fail_on` defaults to `'critical'` (safe default — never silently greenwashes).
- New inputs are optional with safe defaults. Unknown values fall back to defaults, never throw.
- Retry is a transparent wrapper (no behaviour change for pipelines that never hit 429/5xx).
- Source cache is transparent memoization (no behaviour change; just N-1 fewer disk reads in matrix builds).
- Pre-step is only active when `pipeline_file` is provided; inline `pipeline_yaml` consumers see zero change.
- Existing step-summary format is preserved when callers omit the new `findingsCount` / `filteredFindings` / `status` fields.

## v0.2.1 (2026-09-26) — YAML hotfix

### Fixed
- **Critical:** v0.2.0 `action.yml` line 2 had an unquoted YAML flow mapping
  `(provider: minimax|openai|anthropic|openrouter)`. GitHub Actions rejected
  every consumer at Set-up-job with
  `Mapping values are not allowed here. Line 2, Col 71`. v0.2.0 was
  completely unloadable. One-line quote wrap restores the action.yml
  parser-validity for any consumer pinning `@v0.2.1`.

## v0.2.0 (2026-09-26)

### Added
- `provider` input (`minimax|openai|anthropic|openrouter`, default `minimax`).
- Per-provider API key resolution: `api_key` input, else `MINIMAX_API_KEY` /
  `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `OPENROUTER_API_KEY` by provider.
- Native `openai` (`OpenAIChatProvider`) and `anthropic` (`AnthropicProvider`)
  backends (runtime adapters); `openrouter` gateway unchanged.
- Rich `$GITHUB_STEP_SUMMARY` report: pipeline name, provider, model, total
  cost, wall-clock duration, stage count + per-stage sections.
- `AGENTSMARKET_PROVIDER` plumbed into pipeline env expansion.

### Changed
- Provider is explicit — model-name sniffing removed. A model that does not
  belong to the selected provider fails fast naming supported models + hint.
- All errors include `[provider=… model=…]` context; missing-key errors name
  the expected env var and list which provider keys are set.
- `action.yml` description mentions the provider choice.

### Compatibility
- Additive only: all v0.1.0 inputs keep working; default run
  (`provider: minimax`, `model: MiniMax-M3`) is unchanged.

## v0.1.0 (R12.1 scaffold)

- Initial action: run `pipeline.yaml` in a step, stream stages as GH log
  groups, set `result_json` / `total_ms` / `total_cost_usdc` / `stage_count` /
  per-stage outputs. MiniMax by default, OpenRouter via model-name sniffing,
  `mock` mode for dry-runs. `uses:` skill stages report "skill not found".
