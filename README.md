# @agentsmarket/pipeline-action

GitHub Action that runs an agentsmarket `pipeline.yaml` inside a step. Streams each stage as a collapsible GH log group, then sets action outputs with stage results, wall-clock duration, and estimated cost.

## Status

**v0.4.1 — consolidation hotfix (cumulative of v0.3.x + v0.4.0).** v0.3.1 wired the 6 PR-review outputs (`findings_json`, `summary_only_findings_json`, `findings_count_json`, `status`, `failed_count`, `max_severity`) to action boundaries; v0.3.2 added `cost_usdc` + `timing_json` machine-readable outputs for downstream observability; v0.3.3 shipped **PR Review deduplication** (TASKS row 102): a single PR Review per commit, edited on subsequent runs via GitHub's PR Review API (`octokit.rest.pulls.createReview` + `updateReview`); v0.3.4 added webhook notifications (Slack/Discord/Teams); v0.4.0 added provider fallback (MiniMax → OpenAI/Anthropic) and SARIF 2.1.0 output format for GitHub Code Scanning. **v0.4.1 is the first cumulative release** — five parallel feature branches were shipped as separate releases while main never received their commits; `@v0.4.0` standalone releases were incomplete. v0.4.1 restores the cumulative contract — every input/output from every merged feature is present in `action.yml`. Backward-compat: set `use_dedup_reviews: false` to fall back to the v0.3.1 issue-comment behaviour. The new `src/post-review.ts` exports `postReview({ octokit, owner, repo, pull_number, commit_sha, findings, severity_threshold, fail_on })` for direct use in `actions/github-script` blocks. All v0.3.0/v0.3.1 features remain: `context_mode` input (`diff | imports | related | full`), exponential backoff retry for 429/5xx, per-job pipeline source cache, pre-step `agentsmarket validate` (catches malformed `pipeline.yaml` before any LLM call, saves $). Build on v0.2.1's provider selection. Pre-step requires `@agentsmarket/cli` (npm, v0.9.0+). LLM-only stages work; `uses:` skill stages surface "skill not found" (R12.2-R12.4 ship marketplace-fetched skills). **Consumer contract:** consumers wire v0.3.1 outputs to GH status checks + PR review threads via `actions/github-script` using the `postReview()` helper. See `examples/integrations/code-review-workflow.yml` for the canonical pattern (shipped in `web3eco/shared-actions/.github/workflows/ai-code-review.yml`).

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
| `use_dedup_reviews` | no | `true` | v0.3.3+ — when `true` (default), the bundled `postReview()` helper is the canonical posting path (single PR Review per commit, edited on update via the PR Review API). Set to `false` to opt out and fall back to the v0.3.1 issue-comment behaviour. See [PR Review Dedup (v0.3.3+)](#pr-review-dedup-v033). |
| `primary_provider` | no | `minimax` | v0.4.0+ — explicit primary provider override. Defaults to the `provider` input when unset. |
| `primary_model` | no | `MiniMax-M3` | v0.4.0+ — explicit primary model override. Defaults to the `model` input when unset. |
| `fallback_provider` | no | `openai` | v0.4.0+ — secondary provider that catches transient primary failures (HTTP 429, 408/timeout, 5xx). One of `minimax \| openai \| anthropic`. **Silently disabled** when the matching API key (`OPENAI_API_KEY`, etc.) is unset — v0.3.x consumers see zero change. |
| `fallback_model` | no | `gpt-4o-mini` | v0.4.0+ — model on the fallback provider. Ignored when fallback is disabled. |
| `fallback_on_error` | no | `any` | v0.4.0+ — which primary error classes trigger the fallback attempt. One of `rate_limit \| timeout \| server_error \| any`. |
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
| `total_cost_usdc` | Estimated cost with 6 decimals (e.g. `"0.001234"`). v0.3.0+. |
| `cost_usdc` | (v0.3.2+) Machine-readable USDC cost (same value as `total_cost_usdc`; the new name standardizes on the convention used by the MiniMax x402 micropayment pipeline). For dashboards / billing / runaway-PR detection. |
| `timing_json` | (v0.3.2+) Per-stage wall-clock as JSON: `{"validate_ms":12,"fetch_source_ms":89,"run_pipeline_ms":1240,"format_output_ms":23}`. Stages never measured default to 0 ms. |
| `stage_count` | Number of stages declared |
| `stage_<id>_ms` | Per-stage wall-clock |
| `stage_<id>_output` | Per-stage output text |
| `findings_json` | (PR-review only) `JSON.stringify` of `formatFindings(result.outputs)` — flat array of `ReviewFinding` with severity / file / line / message / cwe / confidence / recommendation. Merged across all stages, deduped by `(file, line, cwe)`. |
| `findings_count_json` | (PR-review only) `JSON.stringify` of `{ critical, high, medium, low }` — count by severity across all merged findings. |
| `summary_only_findings_json` | (PR-review only) `JSON.stringify` of `filterBySeverity(findings, severity_threshold)` — only findings at or above the threshold. Empty array if none. |
| `status` | (PR-review only) `'passed'` or `'failed'` — based on `computeStatus(findings, fail_on)`. Default fail-on = `critical`. |
| `failed_count` | (PR-review only) integer — number of findings with severity at or above `fail_on`. |
| `max_severity` | (PR-review only) highest severity seen (`'critical' \| 'high' \| 'medium' \| 'low'`) or empty string when no findings. |
| `provider_used` | (v0.4.0+) `'primary' \| 'fallback'` — which provider actually served the last LLM call. Always `'primary'` when fallback is disabled (no API key configured for the fallback provider). |
| `cost_primary_usdc` | (v0.4.0+) USDC attributable to primary-provider calls (sum across all stages). When fallback is disabled this equals `total_cost_usdc`. |
| `cost_fallback_usdc` | (v0.4.0+) USDC attributable to fallback-provider calls. Always `0.000000` when fallback never fired. |
| `provider_primary_error` | (v0.4.0+) Message of the most recent primary-provider error that triggered a fallback attempt. Empty string when fallback never fired or fallback is disabled. |
| `webhook_status` | (v0.3.4+) Outcome of the optional webhook notification: `sent` (2xx response), `skipped` (`webhook_url` empty — the default), or `failed` (non-2xx / timeout / network error). Non-fatal — pipeline exit code is unaffected. |

## Webhook Notifications (v0.3.4+)

> **TL;DR** Post the run summary + findings to a Slack / Discord / Teams incoming-webhook after every successful pipeline run. Set `webhook_url` to opt in; leave it empty to keep the existing behaviour.

### What it does

After all v0.3.1 / v0.3.2 outputs have been written, the action calls `notify()` from `src/notifier.ts`. The function:

1. **Auto-detects** the payload format from the URL hostname (override with `webhook_format`):
   - `hooks.slack.com` → **Slack Block Kit** (`blocks` array, `mrkdwn` text, severity emoji + `toUpperCase()`).
   - `discord.com/api/webhooks` (and `*.discord.com` subdomains) → **Discord embeds** (`embeds` array, severity-coloured side bar with hex `color`, `title`, `description`).
   - `outlook.office.com/webhook` and `outlook.office365.com/webhook` → **Microsoft Teams MessageCard** (`@type: MessageCard`, `summary` + `sections` with facts + per-finding blocks, `themeColor`).
   - Anything else → `custom` (plain JSON envelope with `{ source, summary, pr, findings }`).
2. **POSTs** with Node 18+ builtin `fetch` and an `AbortController` timeout of **5 seconds**.
3. **Writes** the `webhook_status` output (`sent` / `skipped` / `failed`) so downstream steps can branch on the outcome.

### Inputs

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `webhook_url` | no | *(empty)* | Incoming-webhook URL. Empty disables the feature. The URL embeds the signing secret — no extra auth header is sent. |
| `webhook_format` | no | `auto` | Force a payload format (`slack` / `discord` / `teams`) or sniff from the URL hostname (`auto`). |

### Auth model

Webhooks are self-authenticated: Slack/Discord/Teams embed the signing token in the URL path (`https://hooks.slack.com/services/T0000/B0000/secret`). The action does **not** send an `Authorization` header and does **not** read `MINIMAX_API_KEY`. These are unrelated concerns — the LLM provider API key is for calling the model; the webhook URL is for posting the result.

### Output

| Name | Values | Description |
|------|--------|-------------|
| `webhook_status` | `sent` \| `skipped` \| `failed` | Outcome of the notification. `skipped` when `webhook_url` is empty (the default — the action never touches the network). `sent` on any 2xx response. `failed` on non-2xx / timeout / network error. The pipeline exit code is **unaffected** by failures — `webhook_status` is the signal for downstream branching. |

### Examples

#### Slack

1. In Slack: **Apps → Incoming Webhooks → Add to Slack → Select channel → Copy webhook URL**.
2. Store it as a GitHub Actions secret (e.g. `SLACK_WEBHOOK_URL`).
3. Wire it into the step:

```yaml
- uses: agents-market/pipeline-action@v0.3.4
  with:
    pipeline_file: .github/pipelines/ai-review.yaml
    webhook_url: ${{ secrets.SLACK_WEBHOOK_URL }}
    webhook_format: slack   # or omit for auto-detect
```

The channel receives a Slack message:

```
pipeline-action — failed
🚨 pipeline failed — 3 findings (1234ms, ~$0.012345 USDC)
PR: <https://github.com/acme/widget/pull/7|acme/widget#7>
————————————————————
:rotating_light: CRITICAL — src/auth.ts:42 `CWE-89` (conf 95%) — SQL injection via unsanitized input
:warning: HIGH — src/api/users.ts:17 (conf 80%) — Missing auth check on /me endpoint
:large_orange_diamond: MEDIUM — src/utils/log.ts (conf 60%) — Logging PII (email) at info level
```

#### Discord

1. In Discord: **Server Settings → Integrations → Webhooks → New Webhook → Copy URL**.
2. Store it as a GitHub Actions secret (e.g. `DISCORD_WEBHOOK_URL`).
3. Wire it into the step:

```yaml
- uses: agents-market/pipeline-action@v0.3.4
  with:
    pipeline_file: .github/pipelines/ai-review.yaml
    webhook_url: ${{ secrets.DISCORD_WEBHOOK_URL }}
    webhook_format: discord
```

The channel receives a Discord embed with a red side bar (critical findings) and a `description` listing each finding.

#### Microsoft Teams

1. In Teams: **Channel → ⋯ → Connectors → Incoming Webhook → Configure → Copy URL**.
2. Store it as a GitHub Actions secret (e.g. `TEAMS_WEBHOOK_URL`).
3. Wire it into the step:

```yaml
- uses: agents-market/pipeline-action@v0.3.4
  with:
    pipeline_file: .github/pipelines/ai-review.yaml
    webhook_url: ${{ secrets.TEAMS_WEBHOOK_URL }}
    webhook_format: teams
```

The channel receives a Teams MessageCard with facts (Status / Total findings / Max severity / Duration / Cost / PR) and one section per finding (capped at 10 — remaining count is summarised).

### Error handling

- **Empty URL** → `notify()` returns `{ status: 'skipped' }` without touching `fetch`. No allocation, no network.
- **Timeout** (> 5s) → `notify()` returns `{ status: 'failed', error: 'timeout after 5000ms: ...' }`. A `::notice::` line logs the failure but the pipeline exit code is unchanged.
- **Non-2xx** → `{ status: 'failed', http_status, error }`. Same non-fatal behaviour.

Use `webhook_status` in a downstream step if you want to branch on the outcome (e.g. create a Jira issue when the webhook fails):

```yaml
- id: notify
  uses: agents-market/pipeline-action@v0.3.4
  with:
    webhook_url: ${{ secrets.SLACK_WEBHOOK_URL }}

- if: steps.notify.outputs.webhook_status == 'failed'
  run: echo "webhook delivery failed — investigating"
```

## PR Review Dedup (v0.3.3+)

> **TL;DR** A single PR Review per commit, edited on subsequent runs — instead of one new issue comment per commit. Anchored to a session marker so the edit path is deterministic.

### What it does

Before v0.3.3, consumer workflows (e.g. `web3eco/shared-actions/.github/workflows/ai-code-review.yml`) used `octokit.rest.issues.createComment` to post a fresh comment on every AI re-run. Every push to the PR produced a new top-level comment → timeline noise.

v0.3.3 introduces `src/post-review.ts` with the `postReview({ octokit, owner, repo, pull_number, commit_sha, findings, severity_threshold, fail_on })` function. It uses the **PR Review API** (`octokit.rest.pulls.createReview` + `pulls.updateReview`) instead of issue comments. The run sequence:

1. **First run on a fresh PR** → `octokit.rest.pulls.listReviews({ per_page: 100 })` finds no review carrying the session marker `<!-- ai-review-session:{commit_sha} -->`. Posts a fresh review via `octokit.rest.pulls.createReview({ commit_id, event: 'COMMENT', body, comments })`. The body is anchored to the commit SHA via the marker + embeds the current findings as a fenced JSON snapshot. Inline review comments are attached for every finding with `file + line`.
2. **Subsequent runs on a new commit** → finds the existing review by marker, **edits it** via `octokit.rest.pulls.updateReview({ review_id, body })`. The new body carries an explicit diff row (new / resolved / changed-severity) computed from the previous JSON snapshot. No duplicate review is ever posted.

### Session marker contract

The marker is the contract between runs:

```
<!-- ai-review-session:{commit_sha} -->
```

Where `{commit_sha}` is a 40-character lowercase hex SHA. Changing the format requires a major version bump — older reviews would be orphaned (treated as "no marker found"), left in place.

### Why the PR Review API (not the issue comment API)

- `pulls.updateReview` is **editable** (PATCH body). `issues.updateComment` works too, but the review form anchors to a specific commit and groups inline comments under a single review — the natural unit for "an AI's review of commit X".
- PR Reviews are a first-class GitHub concept with their own permissions and threading — maintainers can dismiss them, request changes, etc.
- A single review record per PR is easier to reason about than N issue comments.

### Inline comment handling

- On **CREATE**: every finding with a `file + line` becomes an inline review comment (scoped to the review).
- On **UPDATE**: the GitHub REST API does not allow replacing inline comments in bulk via `updateReview`. The new body carries the full diff so maintainers see the changes without scrolling inline threads. Inline comment editing via `updateReviewComment` is tracked as v0.3.4 follow-up work.

### Inputs that drive dedup behaviour

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `use_dedup_reviews` | no | `true` | When `true` (default), the bundled `postReview()` helper is the canonical posting path. Set to `false` to opt out and fall back to the v0.3.1 issue-comment behaviour. |

### Integration example

Inside `actions/github-script@v7`:

```javascript
const findings = JSON.parse(process.env.FINDINGS_JSON || '[]');
const { owner, repo } = context.repo;
const prNumber = context.issue.number;
const commitSha = context.payload.pull_request.head.sha;

const { review_id, action } = await postReview({
  octokit: github,
  owner, repo,
  pull_number: prNumber,
  commit_sha: commitSha,
  findings,
  severity_threshold: 'low',
  fail_on: 'critical',
});
core.info(`PR review ${action} (id=${review_id})`);
```

The `postReview()` function is also exported from `dist/index.js` after `pnpm build` — it's available to any consumer that wants to call the same helper directly.

## Provider Fallback (v0.4.0+)

> **TL;DR** If the primary LLM provider returns a transient error (HTTP 429 rate-limit, HTTP 408 / connection timeout, HTTP 5xx server error), the action retries the same prompt on the configured fallback provider (default `openai`/`gpt-4o-mini`). Resilience: the pipeline finishes even when one provider is having a bad day.

### Rationale

LLM providers occasionally have outages, rate-limit spikes, or capacity issues. Without a fallback, the pipeline fails the entire action run — wasted minutes of wall-clock time, lost context-mode cost uplift, and a noisy red ❌ on the PR. With fallback, the degraded path is invisible: the consumer sees the same outputs, the step summary notes `↻ provider fallback fired N/M calls`, and the new outputs surface which provider actually served each call.

### Example: primary MiniMax + fallback OpenAI

```yaml
- uses: agents-market/pipeline-action@v1
  with:
    provider: minimax                          # primary
    primary_model: MiniMax-M3
    model: MiniMax-M3                          # legacy alias (still works)
    fallback_provider: openai                  # secondary — fires on 429/timeout/5xx
    fallback_model: gpt-4o-mini
    fallback_on_error: any                     # rate_limit | timeout | server_error | any
    api_key: ${{ secrets.MINIMAX_API_KEY }}
    openai_api_key: ${{ secrets.OPENAI_API_KEY }}   # fallback key — required to enable
    pipeline_file: ./pipelines/review.yaml
```

When `OPENAI_API_KEY` is unset, the fallback is **silently disabled** and the action behaves exactly like v0.3.x — no errors, no warnings, just primary-only. Set both keys (or use `secrets.OPENAI_API_KEY`) to opt in.

### Cost trade-off

The fallback provider may be **10–30% pricier** than the primary per call. Documented examples:

| Primary | Fallback | Trade-off |
|---------|----------|-----------|
| MiniMax-M3 | OpenAI gpt-4o-mini | OpenAI is ~10× pricier per input token than MiniMax — fallback adds noticeable cost when it fires |
| MiniMax-M3 | Anthropic claude-3-haiku | Similar to OpenAI — fallback is a cost-premium safety net, not a free upgrade |
| OpenAI gpt-4-turbo | Anthropic claude-3-sonnet | Comparable pricing — fallback is roughly cost-neutral |

When fallback fires, the action exposes the split via `cost_primary_usdc` (0 when the primary call failed) and `cost_fallback_usdc` (the actual fallback cost). `total_cost_usdc` is the truthful sum.

### Behaviour matrix

| `fallback_on_error` | Triggers on | Skips on |
|---------------------|-------------|----------|
| `rate_limit` | HTTP 429, SDK `RateLimitError` class, message literal "rate limit" / "429" / "token plan usage limit reached" | 5xx, timeouts, 4xx other than 429 |
| `timeout` | HTTP 408, ETIMEDOUT, ECONNRESET, ENOTFOUND, EAI_AGAIN, message literal "timeout" / "timed out" | 429, 5xx, 4xx |
| `server_error` | HTTP 500/502/503/504, SDK server-error class, message literal "server error" / "bad gateway" / "service unavailable" / "gateway timeout" | 429, timeouts, 4xx |
| `any` (default) | All of the above + any unclassified error | 4xx other than 408/429 (auth, validation, schema) |

Non-retryable errors (4xx other than 408/429) **never** trigger fallback — retrying a malformed request wastes money. The pipeline fails immediately with the primary's error message, just like v0.3.x.

### Step summary surface

When fallback fires during a run, the `$GITHUB_STEP_SUMMARY` gains a single notice line:

```
↻ provider fallback fired 2/5 calls (primary → fallback due to 'any' error class)
```

The notice is intentionally terse — it tells the operator "we degraded gracefully" without burying the actual outputs.

### Backward compatibility

v0.3.x → v0.4.0 is a **non-breaking upgrade for existing consumers**:

- All v0.3.x inputs (`provider`, `model`, etc.) still work and produce identical behaviour when the new inputs are unset.
- The 5 new inputs (`primary_provider`, `primary_model`, `fallback_provider`, `fallback_model`, `fallback_on_error`) are optional with safe defaults.
- The 4 new outputs (`provider_used`, `cost_primary_usdc`, `cost_fallback_usdc`, `provider_primary_error`) are emitted unconditionally — consumers that ignore them are unaffected.
- The `FallbackProvider` wrapper is transparent when fallback is disabled: `deps.provider.name` continues to mirror the primary (e.g. `minimax`) so existing assertions in test suites still pass.

## PR Review Dedup (v0.3.3+)

> **TL;DR** A single PR Review per commit, edited on subsequent runs — instead of one new issue comment per commit. Anchored to a session marker so the edit path is deterministic.

### What it does

Before v0.3.3, consumer workflows (e.g. `web3eco/shared-actions/.github/workflows/ai-code-review.yml`) used `octokit.rest.issues.createComment` to post a fresh comment on every AI re-run. Every push to the PR produced a new top-level comment → timeline noise.

v0.3.3 introduces `src/post-review.ts` with the `postReview({ octokit, owner, repo, pull_number, commit_sha, findings, severity_threshold, fail_on })` function. It uses the **PR Review API** (`octokit.rest.pulls.createReview` + `pulls.updateReview`) instead of issue comments. The run sequence:

1. **First run on a fresh PR** → `octokit.rest.pulls.listReviews({ per_page: 100 })` finds no review carrying the session marker `<!-- ai-review-session:{commit_sha} -->`. Posts a fresh review via `octokit.rest.pulls.createReview({ commit_id, event: 'COMMENT', body, comments })`. The body is anchored to the commit SHA via the marker + embeds the current findings as a fenced JSON snapshot. Inline review comments are attached for every finding with `file + line`.
2. **Subsequent runs on a new commit** → finds the existing review by marker, **edits it** via `octokit.rest.pulls.updateReview({ review_id, body })`. The new body carries an explicit diff row (new / resolved / changed-severity) computed from the previous JSON snapshot. No duplicate review is ever posted.

### Session marker contract

The marker is the contract between runs:

```
<!-- ai-review-session:{commit_sha} -->
```

Where `{commit_sha}` is a 40-character lowercase hex SHA. Changing the format requires a major version bump — older reviews would be orphaned (treated as "no marker found"), left in place.

### Why the PR Review API (not the issue comment API)

- `pulls.updateReview` is **editable** (PATCH body). `issues.createComment` would also work for body edits but the review form anchors to a specific commit and groups inline comments under a single review — the natural unit for "an AI's review of commit X".
- PR Reviews are a first-class GitHub concept with their own permissions and threading — maintainers can dismiss them, request changes, etc.
- A single review record per PR is easier to reason about than N issue comments.

### Inline comment handling

- On **CREATE**: every finding with a `file + line` becomes an inline review comment (scoped to the review).
- On **UPDATE**: the GitHub REST API does not allow replacing inline comments in bulk via `updateReview`. The new body carries the full diff so maintainers see the changes without scrolling inline threads. Inline comment editing via `updateReviewComment` is tracked as v0.3.4 follow-up work.

### Inputs that drive dedup behaviour

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `use_dedup_reviews` | no | `true` | When `true` (default), the bundled `postReview()` helper is the canonical posting path. Set to `false` to opt out and fall back to the v0.3.1 issue-comment behaviour. |

### Integration example

Inside `actions/github-script@v7`:

```javascript
const findings = JSON.parse(process.env.FINDINGS_JSON || '[]');
const { owner, repo } = context.repo;
const prNumber = context.issue.number;
const commitSha = context.payload.pull_request.head.sha;

const { review_id, action } = await postReview({
  octokit: github,
  owner, repo,
  pull_number: prNumber,
  commit_sha: commitSha,
  findings,
  severity_threshold: 'low',
  fail_on: 'critical',
});
core.info(`PR review ${action} (id=${review_id})`);
```

The `postReview()` function is also exported from `dist/index.js` after `pnpm build` — it's available to any consumer that wants to call the same helper directly.
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
