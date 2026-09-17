# @agentsmarket/pipeline-action

GitHub Action that runs an agentsmarket `pipeline.yaml` inside a step. Streams each stage as a collapsible GH log group, then sets action outputs with stage results, wall-clock duration, and estimated cost.

## Status

v0.1.0 — R12.1 scaffold. LLM-only stages work; `uses:` skill stages surface "skill not found" (R12.2-R12.4 ship marketplace-fetched skills).

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
| `api_key` | no | — (uses `MINIMAX_API_KEY` env) | LLM provider API key |
| `pipeline_file` | no | — | Path to `pipeline.yaml`. Mutually exclusive with `pipeline_yaml` |
| `pipeline_yaml` | no | — | Inline YAML body. Mutually exclusive with `pipeline_file` |
| `model` | no | `MiniMax-M3` | Default model identifier |
| `inputs_json` | no | `{}` | JSON object passed to pipeline `inputs` |
| `fail_fast` | no | `true` | Stop on first stage error |
| `mock` | no | `false` | Use deterministic mock provider (no real API) |

## Outputs

| Name | Description |
|------|-------------|
| `result_json` | JSON-stringified record of `stage_id -> output_text` |
| `total_ms` | Wall-clock pipeline duration |
| `total_cost_usdc` | Estimated cost with 6 decimals |
| `stage_count` | Number of stages declared |
| `stage_<id>_ms` | Per-stage wall-clock |
| `stage_<id>_output` | Per-stage output text |

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
  inputs.ts         Action input parser/validator
  pipeline-source.ts  Resolve pipeline_yaml vs pipeline_file
  executor-deps.ts  Build StageExecutorDeps (provider, registry, pricing, model resolver)
  run.ts            Main flow: load → expand → execute → emit outputs
  streaming.ts      Workflow commands (::group::, ::notice::, ::set-output)
examples/
  pr-summary.pipeline.yaml  Sample inline pipeline
```

## Roadmap

- **R12.2-R12.4** — marketplace-fetched `uses:` skills (github-pr-context, github-pr-comment, github-review-submit)
- **R12.5** — sample code-review pipeline (uses the GH skills once shipped)
- **R12.6** — public Action repo `agents-market/code-review@v1`
- **R12.7** — Docker image w/ cosign signing (depends on R11)
