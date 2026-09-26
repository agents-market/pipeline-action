# Changelog — `@agentsmarket/pipeline-action`

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
