# Using `agents-market/pipeline-action` — 5-min install

GitHub Action that runs an [agentsmarket](https://agentsmarket.world)
[pipeline.yaml](../README.md) inside a CI step. Bundles the
runtime — no external dependencies at action time.

> **Source of truth:** this file lives in
> [`agents-market/main`](https://github.com/agents-market/main)
> and is copied into the published
> [`agents-market/pipeline-action`](https://github.com/agents-market/pipeline-action)
> on each release.

---

## Install (5 lines)

```yaml
# .github/workflows/security-review.yml
name: Pipeline security review
on: [pull_request]
permissions:
  contents: read
  pull-requests: read
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: agents-market/pipeline-action@v1
        with:
          pipeline_file: .github/pipelines/my-pipeline.yaml
          mock: 'true'  # remove for real LLM calls
```

That's it. Push, open a PR, watch the action run.

---

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `api_key` | no (yes if not mock) | — | LLM provider API key. Falls back to `MINIMAX_API_KEY` env var. |
| `pipeline_file` | yes* | — | Path to `pipeline.yaml` (relative to `$GITHUB_WORKSPACE` or absolute). |
| `pipeline_yaml` | yes* | — | Inline pipeline YAML string. Mutually exclusive with `pipeline_file`. |
| `model` | no | `MiniMax-M3` | Default model identifier. |
| `inputs_json` | no | `{}` | JSON object of pipeline inputs (passed to `spec.inputs`). |
| `fail_fast` | no | `true` | Stop on first stage error. |
| `mock` | no | `false` | Use deterministic mock provider (no real API). |

\* Exactly one of `pipeline_file` or `pipeline_yaml` is required.

### Outputs

| Output | Description |
|---|---|
| `result_json` | JSON-stringified record of `stage_id -> output text`. |
| `total_ms` | Wall-clock pipeline duration in milliseconds. |
| `total_cost_usdc` | Estimated cost in USDC with 6 decimals (e.g. `"0.001234"`). |
| `stage_count` | Number of stages in the pipeline. |
| `stage_<id>_ms` | Per-stage wall-clock duration. |
| `stage_<id>_output` | Per-stage output text. |

---

## Minimal pipeline example

```yaml
# .github/pipelines/my-pipeline.yaml
name: my-smoke
version: 1.0.0
defaults:
  model: MiniMax-M3

stages:
  - id: summarize
    prompt: |
      Summarize the PR diff in 3 bullet points.
      Diff: ${DIFF:-<no diff>}
    input:
      title: "${PR_TITLE:-<no title>}"
    output_format: text
```

---

## Real LLM call (production)

1. **Remove `mock: 'true'`** from the workflow.
2. **Add API key** to repo/org secrets:
   - `MINIMAX_API_KEY` (default provider) — repo/org Settings → Secrets
3. **Wire API key into the action:**
   ```yaml
   - uses: agents-market/pipeline-action@v1
     with:
       api_key: ${{ secrets.MINIMAX_API_KEY }}
       pipeline_file: .github/pipelines/my-pipeline.yaml
   ```

The action picks the provider by model name:
- `claude`, `gpt`, `mistral`, `llama` → OpenRouter
- anything else → MiniMax

---

## Capturing outputs in workflow logs

```yaml
- uses: agents-market/pipeline-action@v1
  id: pipeline
  with:
    pipeline_file: .github/pipelines/my-pipeline.yaml
- name: Inspect
  if: always()
  env:
    RESULT_JSON: ${{ steps.pipeline.outputs.result_json }}
    TOTAL_MS: ${{ steps.pipeline.outputs.total_ms }}
    TOTAL_COST: ${{ steps.pipeline.outputs.total_cost_usdc }}
  run: |
    echo "::notice::Pipeline finished in ${TOTAL_MS}ms, cost ~$${TOTAL_COST} USDC"
    echo "$RESULT_JSON" | jq .
```

> **Note:** the step must have `id: <something>` for the outputs to be
> referenceable. Use `${{ steps.<id>.outputs.* }}`.

---

## Gotchas (learned the hard way)

### 1. `${VAR}` substitution breaks on YAML-special chars

The action expands `${PR_TITLE}`, `${DIFF}`, etc. inline into the
pipeline YAML **before parsing**. Real PR titles contain `:`, real
PR bodies contain newlines + Markdown — both break YAML structure.

**Two fixes:**

**a. Stub values** (recommended for smoke tests):
```yaml
env:
  PR_TITLE: "Test"
  DIFF: "Test diff"
```

**b. Pass via `inputs_json`** (production):
```yaml
with:
  inputs_json: |
    {
      "PR_TITLE": "${{ github.event.pull_request.title }}",
      "DIFF":     "${{ github.event.pull_request.body }}"
    }
```
Then in the pipeline, access as `spec.inputs.PR_TITLE` (not `${PR_TITLE}`).

### 2. `@v1` requires a floating `v1` tag

`agents-market/pipeline-action@v1` resolves to a Git tag named
exactly `v1`, **not** `v1.0.0`. Maintainers must force-update the
floating tag:
```bash
git tag -fa v1 v1.0.0
git push --force origin v1
```

### 3. Pipeline runtime needs `dist/` to exist

The action bundles everything with `ncc` into a single
`dist/index.js`. If you fork the action, run `pnpm build` (or
`ncc build src/index.ts -o dist`) before committing — otherwise
ncc can't find transitive deps and the action crashes at runtime
with `MODULE_NOT_FOUND`.

### 4. Workspace deps with pnpm filter

If your action source imports a sibling workspace package, you
**must build the dependency first**. The `pnpm --filter ...<pkg>`
prefix syntax does NOT include `link:` deps in pnpm 9. Use explicit
filters:
```bash
pnpm --filter @org/dep-package --filter @org/action-package build
```

---

## Reference

- **Action source:** https://github.com/agents-market/pipeline-action
- **Runtime source:** https://github.com/agents-market/main/tree/main/packages/pipeline-runtime
- **Marketplace API:** https://agentsmarket.world
- **Pipeline spec:** see [agents-market/main README](https://github.com/agents-market/main)
