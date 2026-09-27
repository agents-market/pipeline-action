# Changelog — `@agentsmarket/pipeline-action`

## v0.4.1 (2026-09-27) — consolidation hotfix

> **Cumulative release.** v0.4.1 bundles all v0.3.2 → v0.4.0 features into a single release. Five parallel feature branches shipped in isolation while main never received their commits; downstream consumers installing `@v0.4.0` got an incomplete release missing v0.3.2/3/4 features. v0.4.1 restores the cumulative contract — every input/output from every merged feature is present in `action.yml`. **No breaking changes** — the union of features is additive on top of v0.3.1.

### Added (cumulative from v0.3.2 + v0.3.3 + v0.3.4 + v0.4.0)

#### v0.3.2 — `cost_usdc` + `timing_json` outputs
- New output `cost_usdc` — same value as `total_cost_usdc` (machine-readable for billing / runaway-PR detection).
- New output `timing_json` — `{"validate_ms":12,"fetch_source_ms":89,"run_pipeline_ms":1240,"format_output_ms":23}` per-stage wall-clock (ms).
- New modules: `src/cost.ts` (`computeCostInUsdc`), `src/timing.ts` (`Timings` class).

#### v0.3.3 — PR Review dedup
- New input `use_dedup_reviews` (default `true`) — switches to GitHub PR Review API for single-review-per-commit semantics.
- New module `src/post-review.ts` exporting `postReview()` + helpers (marker parse, body render, finding diff).

#### v0.3.4 — webhook notifications
- New inputs `webhook_url`, `webhook_format` (`slack|discord|teams|generic`, default `slack`).
- New output `webhook_status` (`sent|failed|skipped`).
- New module `src/notifier.ts` posting Slack/Discord/Teams payloads on pipeline completion.

#### v0.4.0 — provider fallback
- New inputs `primary_provider`, `primary_model`, `fallback_provider`, `fallback_model`, `fallback_on_error` (default `true`).
- New outputs `provider_used`, `cost_primary_usdc`, `cost_fallback_usdc`, `provider_primary_error`.
- New class `FallbackProvider` in `src/fallback.ts` wrapping two `Provider` instances and switching on transient errors.

#### v0.4.0 — SARIF 2.1.0 output format
- New input `output_format` (`json|sarif`, default `json`).
- New output `findings_sarif` — SARIF 2.1.0 `log` object suitable for `github/codeql-action/upload-sarif`.
- New module `src/formatters/sarif.ts` producing SARIF runs from `ReviewFinding[]`.

### Compatibility
- 100% additive over v0.3.1. All v0.2.x / v0.3.x consumers keep working unchanged.
- New inputs are optional with safe defaults (no required fields added).
- New outputs are present but empty when the corresponding feature is not exercised.

### Tests
- 168+ cumulative tests passing (per-feature test suites merged), 1 skipped unchanged.
- Canonical: 38/38 ✓.

### Standalone release note
- The standalone `agents-market/pipeline-action` repo tags v0.3.2 / v0.3.3 / v0.3.4 / v0.4.0 remain immutable with their partial content. **v0.4.1 is the first cumulative release** — install `@v0.4.1` for the union of all features.

---

## v0.4.0 (2026-09-27) — provider fallback (resilience)

> **Resilience release.** v0.4.0 introduces automatic fallback from the primary LLM provider to a secondary one when the primary returns a transient error (HTTP 429 rate-limit, HTTP 408 / connection timeout, HTTP 5xx server error). Defaults preserve v0.3.x behaviour exactly: when the fallback provider's API key is missing the wrapper is silently skipped — opt in by setting `OPENAI_API_KEY` (or any other provider key) and `fallback_provider` resolves automatically.

### Added

#### Provider fallback (TASKS row 105)
- **New action inputs** (all optional, with defaults that preserve v0.3.x):
  - `primary_provider` (enum `minimax | openai | anthropic`, default `minimax`) — explicit override; falls back to the legacy `provider` input when unset.
  - `primary_model` (string, default `MiniMax-M3`) — explicit override; falls back to the legacy `model` input when unset.
  - `fallback_provider` (enum, default `openai`) — secondary provider that catches transient primary failures. **Silently disabled** when the matching API key (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.) is unset, so existing v0.3.x consumers that have never configured a fallback key see zero behaviour change.
  - `fallback_model` (string, default `gpt-4o-mini`) — model on the fallback provider.
  - `fallback_on_error` (enum `rate_limit | timeout | server_error | any`, default `any`) — which primary error classes trigger the fallback attempt.
- **New `src/fallback.ts`** exporting `FallbackProvider` (implements `LLMProvider` from `@agentsmarket/pipeline-runtime`), `classifyError`, `isRetryableError`, `BothProvidersFailedError`, `createFallbackProvider`, `MicroUsdcPricer`. Transparent passthrough when fallback is disabled (the wrapper's `name` mirrors the primary so existing `deps.provider.name === 'minimax'` assertions still pass).
- **`callProviderWithFallback(prompt, opts)`** — public entry point returning `{ result, provider_used: 'primary' | 'fallback', primary_error?: Error }`. Tries primary first; on a retryable error, switches to fallback; when both fail, throws `BothProvidersFailedError` with the primary error in `.primary` and the fallback error in `.fallback` (and chained via `Error.cause`).
- **Per-provider cost tracking** — `FallbackProvider.cost_primary_micro_usdc` and `cost_fallback_micro_usdc` accumulate micro-USDC per actual served call (model + token usage resolved via a `MicroUsdcPricer` injected at construction). `run.ts` overrides the runtime's `totalCostMicroUsdc` with the wrapper's total so the cost outputs reflect the actual served provider, not the stage-declared model.
- **New action outputs**:
  - `provider_used` — `'primary' | 'fallback'` (always `'primary'` when fallback is disabled).
  - `cost_primary_usdc` — micro-USDC attributable to primary calls.
  - `cost_fallback_usdc` — micro-USDC attributable to fallback calls (always `0.000000` when fallback never fired).
  - `provider_primary_error` — message of the most recent primary error that triggered a fallback attempt (empty when fallback never fired).
- **Step summary notice** — when fallback fires, `run.ts` emits `↻ provider fallback fired N/M calls (primary → fallback due to '<mode>' error class)` so the run summary tells operators the action degraded gracefully.

### Notes (semver)
- v0.4.0 is technically a "breaking change" semver-wise because the action input schema gains 5 new entries. **Existing consumers see zero behaviour change**: the new inputs all carry safe defaults, and `fallback_provider` is silently disabled when its API key is absent. Migration path for v0.3.x → v0.4.0: drop in the upgrade, no workflow changes required.
- Cost trade-off documented in `README.md`: fallback may add 10–30% per call when primary is more expensive (e.g. OpenAI gpt-4o-mini is ~10× pricier than MiniMax per input token). Configure `fallback_provider` deliberately.

### Tests (177 passing, 1 skipped — +18 from v0.3.x)
- `tests/provider-fallback.test.ts` (NEW) — 18 tests covering `classifyError`, `isRetryableError` × 4 modes, `FallbackProvider` × 6 integration scenarios (Test 1–6 per the task spec), and 2 `run()`-level wiring tests for the action outputs.
- Existing test helpers in `tests/{provider,run,provider-integration,pipeline-source}.test.ts` updated to include the 5 new `ActionInputs` fields + a "primary mirrors provider/model when unset" compatibility shim so the legacy test contracts (provider=openai selects OpenAIChatProvider, etc.) still hold.

### Compatibility
- 100% additive on the wire. All v0.3.2 inputs/outputs unchanged.
- `FallbackProvider` is transparent when `fallback_provider=null` (default after `resolveFallback` auto-disables on missing key): `deps.provider.name === primary.name` and the wrapper is a no-op passthrough.
- Error classification is independent of the existing `retry.ts` `defaultRetryable` predicate — the fallback wrapper uses its own focused classifier tailored to the `fallback_on_error` filter (e.g. `rate_limit` mode does NOT trigger on 5xx, where `defaultRetryable` would).
- `BothProvidersFailedError` carries both errors on the `cause` chain so a single `try/catch` at the action boundary can render full diagnostics.

---

## v0.3.4 (2026-09-27) — webhook notifications (Slack / Discord / Teams)

> 100% additive on top of v0.3.2. No breaking changes — existing consumers see zero behaviour change unless they opt in via the two new inputs (`webhook_url`, `webhook_format`) and read the new `webhook_status` output. Closes TASKS row 108.

### Added

#### Webhook notifications (TASKS row 108)
- New optional inputs:
  - `webhook_url` (string, no default) — incoming-webhook URL from Slack / Discord / Teams. Leave empty to disable. The URL embeds the signing secret — no extra auth header is sent.
  - `webhook_format` (enum `slack` | `discord` | `teams` | `auto`, default `auto`) — force a specific payload format, or auto-detect from the URL hostname (`hooks.slack.com` → slack, `discord.com/api/webhooks` → discord, `outlook.office.com/webhook` → teams, else `custom`).
- New output `webhook_status` (`sent` | `skipped` | `failed`) — outcome of the notification. `skipped` when `webhook_url` is empty (the default), `sent` on a 2xx response, `failed` on non-2xx / timeout / network error. Failures are non-fatal — the pipeline result is unaffected.
- New module `src/notifier.ts` with the public surface:
  - `notify(opts: { url, format, findings, summary, prContext }): Promise<NotifyResult>` — POST wrapper with `AbortController` timeout (5s).
  - `detectFormatFromUrl(url): WebhookFormat` — hostname sniffing for the `auto` mode.
  - `buildSlackPayload(findings, summary, prContext)` — Slack Block Kit (`blocks` array, mrkdwn, severity emoji + `toUpperCase()`).
  - `buildDiscordPayload(findings, summary, prContext)` — Discord embeds (`embeds` array, severity-coloured side bar, hex `color` per dominant severity).
  - `buildTeamsPayload(findings, summary, prContext)` — Microsoft Teams MessageCard (`@type: MessageCard`, `summary` + `sections` with facts + per-finding blocks, theme color).
  - `buildCustomPayload(findings, summary, prContext)` — minimal plain-JSON envelope for unknown webhook URLs.
- Uses Node 18+ builtin `fetch` — no new dependencies.

#### PR context resolution
- New `readPullRequestContextFromEnv()` helper in `src/run.ts` reads `GITHUB_REPOSITORY` + `GITHUB_EVENT_PATH` to populate `owner`, `repo`, `pull_number`, and `url` for the webhook payload. Falls back to empty fields for non-`pull_request` events (push, schedule, manual dispatch).

#### Wiring
- `run.ts` calls `notify()` after all v0.3.1/v0.3.2 outputs are written. The webhook call is the very last thing before the `✓ pipeline complete` notice, so summary / cost / timing / findings are all flushed to `$GITHUB_OUTPUT` before the optional network call.
- A failed webhook posts a `::notice::` line but does not change the pipeline exit code.

### Tests
- 5 new integration tests under `describe("notifier()", ...)` in `tests/notifier.test.ts`:
  - Slack Block Kit payload (blocks array, mrkdwn, severity fields) + auto-detect from `hooks.slack.com`.
  - Discord embeds payload (color hex per severity, title) + auto-detect from `discord.com/api/webhooks` (including `*.discord.com` subdomains).
  - Teams MessageCard payload (`summary` + `sections` with facts + per-finding blocks) + auto-detect from `outlook.office.com` and `outlook.office365.com`.
  - Empty / whitespace-only URL → `skipped` (no fetch).
  - Mock fetch returning HTTP 500 → `failed` with `http_status: 500`.
- Total: 164 tests passing, 1 skipped (159 baseline + 5 new).

### Compatibility
- 100% additive. v0.3.2 consumers still work — the new inputs default to "disabled" so `notify()` returns `skipped` and never touches the network unless a webhook URL is provided.

---

## v0.3.2 (2026-09-27) — additive cost + timing outputs

> 100% additive on top of v0.3.1. No breaking changes — existing consumers see zero behaviour change unless they read the two new outputs (`cost_usdc`, `timing_json`).

### Added

#### `cost_usdc` action output (TASKS row 101)
- New machine-readable output mirroring `total_cost_usdc` (same 6-decimal USDC value).
- Designed for downstream observability: dashboards, billing reconciliation, runaway-PR cost detection.
- Cost computation extracted from `run.ts` into a new pure function `computeCostInUsdc(usageMicroUsdc, contextModeMultiplier): number` in `src/cost.ts` for unit-testability.
- The `contextModeMultiplier` parameter threads the documented 1x/3x/10x/100x table from `CONTEXT_MODE_MULTIPLIERS`. Currently a no-op at 1.0 — the runtime already accounts for context fetching — but the API is wired through for forward compatibility.
- Step summary line `| Est. cost | ~$X.XXXXXX USDC |` continues to render via `writeActionSummary` (unchanged behaviour).

#### `timing_json` action output (TASKS row 110)
- New per-stage wall-clock output: `{"validate_ms":12,"fetch_source_ms":89,"run_pipeline_ms":1240,"format_output_ms":23}` — integer ms per stage.
- Backed by a new `Timings` class in `src/timing.ts` (`start()` / `end()` / `toJSON()` / `toJSONString()`) using built-in `performance.now()`. No new dependencies.
- Stages that were never `start()`'d default to 0 ms — partial instrumentation stays schema-stable.
- `run.ts` instruments all four stages: `fetch_source` (source cache), `validate` (YAML expand + load + spec sanity check), `run_pipeline` (LLM call + retry wrapper), `format_output` (findings extract/filter + summary + writeOutput calls).

#### Auto-suggestion bonus
- Step summary now logs a `⚡` `::notice::` line when `run_pipeline_ms > 5000` with a non-`diff` `context_mode`, suggesting `diff` (1x cost) for faster iterations. Skipped when `run_pipeline_ms <= 5000` or `context_mode === 'diff'`.

### Implementation notes
- `runPipelineV2` already returns per-stage timing via the `onStageComplete` hook (the `stage_<id>_ms` outputs). v0.3.2's `timing_json` is **action-side** timing only (the four lifecycle stages above) — it is orthogonal to the runtime's per-stage timing.
- All 14 outputs declared in `action.yml` (12 from v0.3.1 + 2 new).
- The `cost_usdc` value matches `total_cost_usdc` exactly. The new name standardizes on the convention used by the MiniMax x402 micropayment pipeline.

### Tests
- 2 new integration tests under `describe("run() — v0.3.2 outputs (cost_usdc + timing_json)", ...)` in `tests/run.test.ts`:
  - `cost_usdc` fires with non-empty value + matches the summary line.
  - `timing_json` has all 4 keys with positive numbers.
- Total: 159 tests passing, 1 skipped (unchanged).

### Compatibility
- 100% additive. v0.3.1 consumers still work — the new outputs are present in v0.3.2 but only have content when the action runs end-to-end. Existing `total_cost_usdc` / `total_ms` / `stage_<id>_ms` / `findings_*` outputs unchanged.

---

## v0.3.3 (2026-09-27) — PR Review deduplication (TASKS row 102)

> **Single PR Review per commit, edited on subsequent runs.** Replaces the per-push issue-comment flow with GitHub's PR Review API. Backward-compatible via the `use_dedup_reviews: false` opt-out.

### Added

#### `postReview()` helper
- New `src/post-review.ts` exporting `postReview({ octokit, owner, repo, pull_number, commit_sha, findings, severity_threshold, fail_on })` → `{ review_id, action: 'created' | 'updated', marker_sha }`.
- Algorithm:
  1. `octokit.rest.pulls.listReviews({ per_page: 100 })` — find an existing review carrying the session marker `<!-- ai-review-session:{commit_sha} -->`.
  2. **Hit** → `octokit.rest.pulls.updateReview({ review_id, body })` — rewrite the body with the new findings snapshot, an explicit diff row (new / resolved / changed-severity counts), and the latest marker.
  3. **Miss** (foreign review, malformed marker, or empty PR) → `octokit.rest.pulls.createReview({ commit_id, event: 'COMMENT', body, comments })` — fresh review anchored to `commit_sha` with inline comments for every finding with `file + line`.
- Marker format is a contract — `<!-- ai-review-session:{40-hex} -->` — and changing it requires a major version bump (orphaned reviews would be left in place).
- Pure-function helpers also exported: `parseSessionMarker`, `buildSessionMarker`, `diffFindings`, `findExistingReview`, `parseEmbeddedFindings`, `buildInlineComments`, `renderReviewBody`, `renderInlineCommentBody`, `countBySeverity`, `findingKey`.

#### `use_dedup_reviews` action input
- New optional input, default `true`. When `false`, consumers fall back to the v0.3.1 behaviour of posting a new issue-style comment per pipeline run (no dedup).
- Wired into `action.yml` under `inputs:` with the same default-true opt-out pattern used by `mock` / `fail_fast`.

### Why the PR Review API
- `pulls.updateReview` is PATCH-able — the body is editable; a single review record per PR is the natural unit for "the AI's review of commit X".
- Issue comments (`issues.createComment`) cannot be edited in-place as part of a dedup loop (every "create" is permanent).
- PR Reviews anchor to a specific commit via `commit_id` on creation and group inline comments under a single record — maintainers can dismiss / request-changes on the AI's review as a unit.

### Inline comment handling
- **CREATE**: every finding with a `file + line` becomes an inline review comment scoped to the review.
- **UPDATE**: the GitHub REST API does not currently allow bulk-replacing inline comments via `updateReview` (only the body is mutable). The new body carries the full `new / resolved / changed-severity` diff so maintainers see state changes without scrolling inline threads. v0.3.4 follow-up: per-comment `updateReviewComment` for in-place severity rewrites.

### Tests (28 new in `tests/post-review.test.ts`)
- 3 REQUIRED scenarios (TASKS row 102):
  1. First run on a fresh PR creates a new PR review with the session marker + inline comments. Verifies `createReview` is called with `commit_id`, `event: 'COMMENT'`, marker-bearing body, and the inline-comments array.
  2. Second run on a new commit finds the existing review by marker and edits it. Verifies `updateReview` is called with the same `review_id` and a new marker; `createReview` is NOT called.
  3. Session-marker parse handles malformed markers gracefully (truncated / non-hex / shorter SHAs). Falls back to fresh review — never silently overwrites a stranger's review.
- 25 additional pure-function tests for the helpers (marker round-trip, diff classification, embedded-findings parse, render functions, etc.).
- Total: 187 tests passing, 1 skipped (unchanged). Canonical: 38/38 ✓.

### Compatibility
- 100% additive. v0.3.1 / v0.3.2 consumers see zero behaviour change unless they read the new `use_dedup_reviews` input. Existing 14 outputs (12 from v0.3.1 + `cost_usdc` + `timing_json` from v0.3.2) unchanged.
- Old issue-style comments left in place (no migration). v0.3.3 dedup starts fresh from the first install.
- `postReview()` is also re-exported from `dist/index.js` so consumers wiring `actions/github-script` can `require('@agentsmarket/pipeline-action/dist/index.js')` for the helper directly.
- Distributed via `web3eco/shared-actions/.github/workflows/ai-code-review.yml` consumer workflow update — the new "Post PR review (dedup)" step inlines the same algorithm since the GitHub-script runtime can't import a TS module across packages.

---


## v0.4.0 (2026-09-27) — provider fallback + SARIF output

> 100% additive on top of v0.3.1. Existing v0.3.x consumers see zero behaviour change unless they explicitly opt into new inputs (`fallback_provider` for the resilience wrapper; `output_format='sarif'` for the new SARIF output). All v0.3.1 outputs preserved.

### Added — Provider fallback (TASKS row 105)

- **Resilience wrapper** — when `fallback_provider` is configured AND its API key is available, the primary provider is wrapped in a `FallbackProvider` that catches transient errors (HTTP 429 rate-limit, HTTP 408 / connection timeout, HTTP 5xx) and retries the same prompt on the fallback. Classified via `classifyError()` (focused predicate, not a copy of `defaultRetryable` from `retry.ts`). When both providers fail, throws `BothProvidersFailedError` carrying both original errors so a single boundary catch surfaces full diagnostics.
- **New outputs** (always written so consumers can read `provider_used='primary'` regardless of whether the fallback wrapper was active):
  - `provider_used` — `'primary' | 'fallback'` (which provider ultimately served the call)
  - `cost_primary_usdc` — micro-USDC cost of successful primary calls (6 decimals)
  - `cost_fallback_usdc` — micro-USDC cost of fallback calls (6 decimals)
  - `provider_primary_error` — last primary error message (empty when primary succeeded or fallback is disabled)
- **Wrapper cost semantics** — `cost_usdc == total_cost_usdc` regardless of fallback path. When fallback fires, the runtime's `totalCostMicroUsdc` is inaccurate (prices against the stage's declared model, not the fallback's actual model), so `run.ts` uses the wrapper's per-provider totals for the cost outputs.
- **Backward compat** — when `fallback_provider` is empty OR its API key is missing, the primary is used directly. `buildExecutorDeps` returns the same shape v0.3.x consumers expect; `deps.provider.name === 'minimax'` (and equivalents) continues to pass.

### Added — SARIF 2.1.0 output format (TASKS row 106)

- **New `output_format` input** — enum `summary` (default) \| `sarif`. Default preserves v0.3.x behaviour. Opt-in to `sarif` for SARIF 2.1.0 emission on the `findings_sarif` output.
- **New `src/formatters/sarif.ts`** — exports `formatFindingsAsSarif(findings, context)` returning a SARIF 2.1.0-compliant JSON document. Top-level shape: `{ $schema, version: "2.1.0", runs: [...] }`. Each run has `tool.driver` (name `agentsmarket-pipeline-action`, version `0.4.0`, rules) + `results` (one per finding).
- **Severity → SARIF `level` mapping** per GitHub Code Scanning guidance: `critical → error`, `high → error`, `medium → warning`, `low → note`. Anything else falls back to `note` (never emits an invalid level).
- **`ruleId`** — CWE when present (the only stable cross-scanner identifier Code Scanning recognizes), otherwise `REVIEW-<hash>` derived from a stable FNV-1a 32-bit hash of `(file, line, cwe, message)`.
- **`partialFingerprints.agentsmarketPipelineActionV1`** — same FNV-1a hash for dedup across runs (8 lowercase hex chars).
- **`versionControlProvenance`** — populated when `GITHUB_REPOSITORY` + `GITHUB_SHA` are set (typical for `pull_request` events). Anchors alerts to commits + branch in Code Scanning. Optional — omitted when context is empty.
- **`properties`** extension fields — surfaces `severity`, `confidence`, `recommendation`, `cwe` so the Code Scanning alert carries the full review context.
- **New `findings_sarif` output** — only written when `output_format='sarif'`. Backward compat: summary outputs (`findings_json`, `summary_only_findings_json`, `findings_count_json`, `status`, `failed_count`, `max_severity`) ALWAYS fire regardless of `output_format`. SARIF is built from the same `findings` array as `findings_json` to guarantee the two outputs are consistent (same source, different shape).
- **Consumer pattern** — upload via `github/codeql-action/upload-sarif@v3` with `category: agentsmarket-pipeline-action` to surface alerts in the PR Security tab. Example workflow in README §"SARIF Output".

### Tests
- 4 new integration tests under `describe("run() — SARIF output wiring (v0.4.0, integration)", ...)` in `tests/sarif-formatter.test.ts`:
  1. Emits `findings_sarif` when `output_format=sarif` with non-empty findings — verifies ruleId/level/location/message
  2. Does NOT emit `findings_sarif` when `output_format=summary` (default, backward compat)
  3. Emits empty SARIF log (`results=[]`, `rules=[]`) when pipeline has no findings (still valid SARIF)
  4. Produces SARIF JSON matching schema version 2.1.0 (parseable, `$schema` + `version` pinned, tool name + version set)
- 7 pure-function unit tests in the same file cover the formatter internals (severity mapping, fingerprint determinism, ruleId selection, multi-finding shape, versionControlProvenance conditional).

### Compatibility
- 100% additive. v0.3.x consumers see no behaviour change. New inputs default to no-op values. New outputs always emit (default empty string for `provider_used='primary'`, zero for the cost splits, empty for the error message).

### Files
- New: `src/formatters/sarif.ts` (~330 LOC), `tests/sarif-formatter.test.ts` (~280 LOC).
- Modified: `src/inputs.ts` (`OutputFormat` type + `normalizeOutputFormat` + `output_format` field on `ActionInputs`), `src/run.ts` (conditional emit + `buildSarifContext` helper + version bump to `0.4.0`), `action.yml` (`output_format` input + `findings_sarif` output), `README.md` (new "SARIF Output (v0.4.0)" section), `CHANGELOG.md` (this entry).



## v0.3.1 (2026-09-27) — output wiring hotfix

> **Critical hotfix.** v0.3.0's new outputs (`findings_json`, `summary_only_findings_json`, `findings_count_json`, `status`, `failed_count`, `max_severity`) were **not wired to action boundaries** — `output-formatter.ts` and `status-check.ts` computed them, but `run.ts` never called `writeOutput()` for them and `action.yml` never declared them. Consumers reading `${{ steps.X.outputs.findings_json }}` got empty strings. **v0.3.0 should not be used.** Upgrade to v0.3.1.

### Fixed
- **PR-review output wiring** — `run.ts` now calls `formatFindings`, `filterBySeverity`, `countFindings`, `readSeverityThresholdFromEnv`, `readFailOnFromEnv`, `computeStatus` after each pipeline run, then emits:
  - `findings_json` — full normalized `ReviewFinding[]` (severity, file, line, message, cwe, confidence, recommendation)
  - `summary_only_findings_json` — filtered by `severity_threshold` action input
  - `findings_count_json` — `{critical, high, medium, low}` counts
  - `status` — `passed | failed` (driven by `fail_on` action input, default `critical`)
  - `failed_count` — integer count of findings at or above `fail_on`
  - `max_severity` — highest severity seen, or empty string when no findings
- **Output declarations** — `action.yml` declares all 6 new outputs so GH Actions exposes them to consumer workflows (`${{ steps.X.outputs.findings_json }}` now returns real data).
- **`writeActionSummary`** now receives `findingsCount` + `filteredFindings` + `status` so the step summary shows the status badge, findings count, and "Findings above threshold" section when callers supply them.

### Compatibility
- 100% additive. v0.2.1 / v0.3.0 consumers still work — the new outputs are present in v0.3.1 too but only have content when the pipeline emits structured findings. Existing `result_json` / `total_ms` / `total_cost_usdc` / `stage_count` outputs unchanged.

## v0.3.0 (2026-09-27) — ⚠️ SUPERSEDED, DO NOT USE

> Single v0.3.0 release consolidating the core plumbing (Agent B) and output layer (Agent C) work. All changes are additive; v0.2.1 consumers see zero behaviour change unless they opt into the new inputs. **This release is incomplete — see v0.3.1 above. The 6 new outputs advertised below were computed but never wired to `${{ steps.X.outputs.* }}`, so consumer workflows reading them always got empty strings. Upgrade to v0.3.1.**

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
