#!/usr/bin/env node
/******/ (() => { // webpackBootstrap
/******/ 	var __webpack_modules__ = ({

/***/ 609:
/***/ ((__unused_webpack_module, exports) => {

"use strict";

/**
 * v0.3.2 — cost computation extracted from the v0.3.1 wiring for testability.
 *
 * The pipeline runtime reports total cost in **micro-USDC** (1e-6 USDC).
 * This module converts to human-readable USDC and applies the optional
 * `context_mode` multiplier declared by the action input.
 *
 * Why a pure function:
 *   - `run.ts` previously inlined `totalCostMicroUsdc / 1_000_000`. Extracting
 *     it lets us lock the conversion factor (1e6) behind a unit test and
 *     stage future changes (e.g. a context-mode pricing adjustment) without
 *     touching the action lifecycle file.
 *   - The `contextModeMultiplier` parameter is currently a no-op at 1.0:
 *     the runtime is responsible for fetching the actual code context, and
 *     v0.3.2 only propagates the declaration through. We thread the
 *     multiplier through anyway so a future runtime version that reports
 *     base cost + mode-driven uplift can hook in without an action-side
 *     signature change.
 *
 * Public API:
 *   - `computeCostInUsdc(usage, contextModeMultiplier)` — pure, no I/O.
 *   - `CONTEXT_MODE_MULTIPLIERS` — the documented 1x / 3x / 10x / 100x table
 *     keyed by `ContextMode` (see `inputs.ts`). Kept here as a constant so
 *     future code (e.g. step-summary auto-suggestions) can read it without
 *     importing the runtime action inputs.
 *
 * No new dependencies — `number` arithmetic only.
 */
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.CONTEXT_MODE_MULTIPLIERS = void 0;
exports.computeCostInUsdc = computeCostInUsdc;
/**
 * Per-mode cost multiplier declared by the `context_mode` action input.
 * Matches the heuristic in `action.yml` and `inputs.ts`:
 *   - `diff`     — PR diff only (~1x cost baseline).
 *   - `imports`  — diff + imported types (~3x, default).
 *   - `related`  — diff + files importing changed files (~10x).
 *   - `full`     — diff + every `.ts`/`.py` file in repo (~100x).
 */
exports.CONTEXT_MODE_MULTIPLIERS = {
    diff: 1,
    imports: 3,
    related: 10,
    full: 100,
};
/**
 * Convert pipeline-runtime usage (micro-USDC) to human-readable USDC and
 * apply the context-mode multiplier.
 *
 * @param usageMicroUsdc           Total cost reported by the runtime, in micro-USDC (1e-6 USDC). Must be >= 0.
 * @param contextModeMultiplier    Multiplier from `CONTEXT_MODE_MULTIPLIERS`. Must be >= 0.
 * @returns                        Cost in USDC as a plain `number`.
 *
 * Behaviour:
 *   - Negative inputs are clamped to 0 (defensive — the runtime never
 *     reports negatives, but a stray test or a manual mock might).
 *   - NaN inputs return 0 (defensive — `Math.max` on NaN yields NaN, so
 *     we explicitly handle it).
 *   - Result is **not** rounded here. Callers format with `.toFixed(6)`
 *     when they need a 6-decimal USDC string (matches v0.3.0/v0.3.1
 *     behavior in `writeActionSummary` / `writeOutput('total_cost_usdc', …)`).
 */
function computeCostInUsdc(usageMicroUsdc, contextModeMultiplier) {
    if (!Number.isFinite(usageMicroUsdc) || usageMicroUsdc < 0)
        return 0;
    if (!Number.isFinite(contextModeMultiplier) || contextModeMultiplier < 0)
        return 0;
    return (usageMicroUsdc / 1_000_000) * contextModeMultiplier;
}


/***/ }),

/***/ 2:
/***/ ((__unused_webpack_module, exports) => {

"use strict";

/**
 * Who runs the pipeline: the marketplace, or this GitHub runner.
 *
 * Until now there was only one answer — the runner. `runPipelineV2` executed
 * locally against the caller's own LLM key, so a workflow that installed a
 * pipeline from the marketplace never called
 * `POST /v1/pipelines/:id/invoke`. No execution on the server, no escrow, no
 * settlement: the author of the pipeline earned nothing, and the buyer paid the
 * model provider directly.
 *
 * The choice is carried by the keys, not by a flag, because the keys already say
 * it:
 *
 *   - `AGENTSMARKET_PRIVATE_KEY` → pay the server, the author gets paid;
 *   - a provider `*_API_KEY`     → run locally, you pay the tokens yourself.
 *
 * A separate `server_mode: true` boolean would be a fourth way to express the
 * same thing and would eventually disagree with the keys.
 */
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.decideExecutionMode = decideExecutionMode;
exports.checkShellConsent = checkShellConsent;
exports.resolveServerSlug = resolveServerSlug;
function decideExecutionMode(input) {
    const hasMarketplace = typeof input.marketplaceKey === 'string' && input.marketplaceKey.length > 0;
    const hasProvider = typeof input.providerKey === 'string' && input.providerKey.length > 0;
    if (input.mock === true) {
        return {
            mode: 'local',
            reason: hasMarketplace
                ? 'mock run: a dry run must not spend money, so the server is not called'
                : 'mock run: no provider is called',
        };
    }
    if (hasMarketplace && hasProvider) {
        return {
            mode: null,
            error: 'Both AGENTSMARKET_PRIVATE_KEY and a provider API key are set, so it is not ' +
                'clear who should pay. Drop the provider key to run on the marketplace (the ' +
                'pipeline author is paid), or drop AGENTSMARKET_PRIVATE_KEY to run locally ' +
                '(you pay the model tokens yourself).',
        };
    }
    if (hasMarketplace) {
        return {
            mode: 'server',
            reason: 'AGENTSMARKET_PRIVATE_KEY is set: the run is executed and billed by the marketplace',
        };
    }
    if (hasProvider) {
        return {
            mode: 'local',
            reason: 'a provider API key is set and no marketplace key: the run is executed on this runner',
        };
    }
    return {
        mode: null,
        error: 'No credentials for either execution path. Set AGENTSMARKET_PRIVATE_KEY to run on ' +
            'the marketplace (you pay the pipeline author and the marketplace), or set ' +
            'MINIMAX_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY / OPENROUTER_API_KEY to run ' +
            'locally (you pay the model tokens yourself).',
    };
}
/**
 * May this run execute the pipeline's `shell:` stages?
 *
 * A `shell:` stage runs a command the pipeline author chose, on this runner,
 * with this runner's tokens, secrets and network. The author is a stranger
 * until the buyer reads the YAML, so the buyer — not the author, not the
 * action, not `allow_shell` being quietly true — has to consent.
 *
 *   - server mode: never. The server is not a command runner, and letting a
 *     marketplace flag reach it would turn hosting into arbitrary execution.
 *   - local mode: only with `allow_shell: true`.
 *
 * Returns the reason when the run may not proceed. Silently skipping the
 * stage instead would leave the pipeline reporting success on work it never
 * did, so both refusals are hard errors naming the stage and the command.
 */
function checkShellConsent(input) {
    const first = input.stages.find((s) => s.shell !== undefined && s.shell !== null);
    if (!first)
        return { ok: true };
    const stageId = first.id ?? '<no-id>';
    const spec = input.normalizeShell(first.shell);
    const command = spec
        ? [spec.cmd, ...(spec.args ?? [])].join(' ')
        : String(first.shell).trim();
    if (input.mode === 'server') {
        return {
            error: `pipeline "${input.pipelineName}" asks to run \`${command}\` (stage "${stageId}"), ` +
                'but the server does not run commands. Run it locally instead: drop ' +
                'AGENTSMARKET_PRIVATE_KEY so the pipeline executes on your own runner.',
        };
    }
    if (!input.allowShell) {
        return {
            error: `pipeline "${input.pipelineName}" asks to run \`${command}\` (stage "${stageId}"). ` +
                'Set allow_shell: true if you trust the author — the command runs on this runner ' +
                'with its tokens, secrets and network.',
        };
    }
    return { ok: true };
}
/**
 * Which pipeline the marketplace should run.
 *
 * An explicit `name@version` pins; a bare `name` takes the newest published
 * version, which is `resolvePipelineId`'s own rule in the CLI — so the action
 * does not need its own version comparison, and cannot disagree with it.
 */
function resolveServerSlug(explicit, specName) {
    const value = (explicit ?? '').trim();
    if (value.length > 0)
        return { slug: value };
    const name = (specName ?? '').trim();
    if (name.length > 0)
        return { slug: name };
    return {
        error: 'Server mode needs to know which marketplace pipeline to run. Pass the `pipeline` ' +
            "input (e.g. `style-review` or `style-review@2.0.4`), or install the pipeline so its " +
            'pipeline.yaml is available and carries a `name:`.',
    };
}


/***/ }),

/***/ 920:
/***/ ((__unused_webpack_module, exports, __nccwpck_require__) => {

"use strict";

/**
 * Build a StageExecutorDeps for runPipelineV2 from action params.
 *
 * Provider selection (v0.2.0): the `provider` action input is the source of
 * truth — no more model-name sniffing.
 *   - mock=true         -> MockProvider (no real API)
 *   - provider=minimax  -> MiniMaxProvider (default)
 *   - provider=openai   -> OpenAIChatProvider
 *   - provider=anthropic -> AnthropicProvider
 *   - provider=openrouter -> OpenRouterProvider (multi-model gateway)
 *
 * Every failure path names the provider + model + expected env var so a red
 * CI step is debuggable without opening the source.
 *
 * Provider fallback (v0.4.0 — TASKS row 105): when `inputs.fallback_provider`
 * is configured AND its API key is available, the primary provider is
 * wrapped in a `FallbackProvider` that catches transient errors (429, 408,
 * 5xx) and retries the same prompt on the fallback. The wrapper exposes
 * `provider_used` + per-provider cost, which `run.ts` reads after the
 * pipeline completes and writes as action outputs.
 *
 * When fallback is disabled (empty `fallback_provider` OR no matching API
 * key), the primary is used directly — `buildExecutorDeps` returns the
 * same shape v0.3.x consumers expect.
 *
 * fetchSkill returns null: marketplace-fetched skills ship in R12.2-R12.4.
 * Pipelines that depend on `uses:` stages will surface "skill not found" errors
 * verbatim in $GITHUB_STEP_SUMMARY so users can identify missing pieces.
 */
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.localRunSelected = localRunSelected;
exports.buildExecutorDeps = buildExecutorDeps;
const pipeline_runtime_1 = __nccwpck_require__(706);
const inputs_js_1 = __nccwpck_require__(601);
const execution_mode_js_1 = __nccwpck_require__(2);
const fallback_js_1 = __nccwpck_require__(122);
class MockProvider {
    name = 'mock';
    models = ['mock'];
    simpleModel = 'mock';
    complexModel = 'mock';
    supports(model) {
        return this.models.includes(model);
    }
    async generateText(prompt, opts) {
        // One mock answer for every path that runs a pipeline without a model
        // (the runtime's `mockStageAnswer`): the schema first, then the fields,
        // then a placeholder. The echo this replaced was never JSON, and every
        // published spec answers in `structured_json` — so `mock: true` could
        // not run a single one of them.
        const o = opts;
        const structured = (0, pipeline_runtime_1.mockStageAnswer)({
            outputFormat: o?.outputFormat,
            fields: o?.fields,
            outputSchema: o?.outputSchema,
        });
        if (structured !== undefined) {
            return {
                text: structured,
                usage: { inputTokens: prompt.length, outputTokens: 50 },
            };
        }
        return {
            text: `[mock pipeline-action] echo: ${prompt.slice(0, 180)}`,
            usage: { inputTokens: prompt.length, outputTokens: 50 },
        };
    }
    /**
     * The answer comes from `generateText`, so it is the same answer the stage
     * would have got from a model — a JSON object that satisfies the schema.
     *
     * The old mock always answered `{mock_response: …}`, on the grounds that a
     * mock must not invent a value that validates: a dry run would then prove
     * nothing. That is true of the *check*, not of the *answer* — the check
     * still runs, and the mock answer satisfies the schema by construction.
     */
    async generateJson(prompt, _schema, opts) {
        const { text } = await this.generateText(prompt, opts);
        try {
            return JSON.parse(text);
        }
        catch {
            return { mock_response: text };
        }
    }
}
const zeroPricing = {
    async resolveCostMicroUsdc(_model, _usage) {
        return 0;
    },
    async resolveCostUsd(_model, _usage) {
        return 0;
    },
};
function configuredProviderKeys() {
    const names = Object.keys(inputs_js_1.PROVIDER_ENV_VARS);
    return names.filter((name) => {
        const value = process.env[inputs_js_1.PROVIDER_ENV_VARS[name]];
        return value !== undefined && value.length > 0;
    });
}
function missingKeyError(provider, model) {
    const envVar = inputs_js_1.PROVIDER_ENV_VARS[provider];
    const configured = configuredProviderKeys();
    const hint = configured.length > 0
        ? ` Note: API keys are currently set for: ${configured
            .map((name) => `${name} (${inputs_js_1.PROVIDER_ENV_VARS[name]})`)
            .join(', ')} — none for '${provider}' (${envVar}). ` +
            `Either switch 'provider' to one of those or add the ${envVar} secret.`
        : ` No provider API keys found in env at all.`;
    return new Error(`Provider '${provider}' (model '${model}') requires an API key: ` +
        `set the 'api_key' action input or the ${envVar} env var (GitHub secret).${hint}`);
}
function suggestProviderForModel(model) {
    const m = model.toLowerCase();
    if (m.includes('gpt') || m.startsWith('o1'))
        return 'openai (or openrouter for gateway routing)';
    if (m.includes('claude'))
        return 'anthropic (or openrouter for gateway routing)';
    if (m.includes('minimax'))
        return 'minimax';
    if (m.includes('mistral') || m.includes('llama'))
        return 'openrouter';
    if (m.startsWith('openai/') || m.startsWith('anthropic/'))
        return 'openrouter';
    return null;
}
function pickProvider(providerName, modelName, apiKey) {
    if (!apiKey) {
        throw missingKeyError(providerName, modelName);
    }
    let provider;
    switch (providerName) {
        case 'minimax':
            provider = new pipeline_runtime_1.MiniMaxProvider({ apiKey });
            break;
        case 'openai':
            provider = new pipeline_runtime_1.OpenAIChatProvider({ apiKey });
            break;
        case 'anthropic':
            provider = new pipeline_runtime_1.AnthropicProvider({ apiKey });
            break;
        case 'openrouter':
            provider = new pipeline_runtime_1.OpenRouterProvider({ apiKey });
            break;
    }
    if (!provider.supports(modelName)) {
        const available = provider.models.join(', ');
        const suggestion = suggestProviderForModel(modelName);
        throw new Error(`Provider '${providerName}' does not support model '${modelName}'. ` +
            `Supported models for ${providerName}: ${available}.` +
            (suggestion ? ` Hint: model '${modelName}' looks like it belongs to ${suggestion}.` : ''));
    }
    return provider;
}
function buildRuntimePricing(apiKey) {
    if (!apiKey)
        return zeroPricing;
    return new pipeline_runtime_1.CompositePricingResolver([
        new pipeline_runtime_1.MiniMaxPricingResolver(),
        new pipeline_runtime_1.OpenRouterPricingResolver({ apiKey }),
        zeroPricing,
    ]);
}
function asMicroPricer(resolver) {
    return {
        resolveCostMicroUsdc: (model, usage) => resolver.resolveCostMicroUsdc(model, usage),
    };
}
/**
 * Stand-in for the local provider on the marketplace execution path.
 *
 * `pickProvider` throws when there is no API key, which is correct for a local
 * run — but the marketplace path has no provider key by design, because the
 * server holds it. It also must not fall back to a mock: that would let a
 * wiring mistake pass silently and post invented findings as if a model had
 * produced them. Every call throws instead.
 */
function marketplaceOnlyProvider(providerName, modelName) {
    const refuse = () => {
        throw new Error(`internal error: the marketplace execution path tried to call the local ` +
            `${providerName} provider. No pipeline stage should run locally when ` +
            `AGENTSMARKET_PRIVATE_KEY is set.`);
    };
    return {
        name: providerName,
        models: [modelName],
        simpleModel: modelName,
        complexModel: modelName,
        supports: () => true,
        generateText: refuse,
        generateJson: refuse,
    };
}
/**
 * Where this run happens.
 *
 * The same `decideExecutionMode` the run loop uses, over the same keys, so the
 * deps can never claim "local" for a run the loop then executes on the
 * marketplace. `null` means undecidable — no local capability either.
 */
function localRunSelected(params) {
    const decision = (0, execution_mode_js_1.decideExecutionMode)({
        marketplaceKey: params.inputs.agent_key,
        providerKey: (0, inputs_js_1.resolveApiKeyForProvider)(params.inputs.api_key, params.inputs.primary_provider),
        mock: params.inputs.mock,
    });
    return decision.mode === 'local';
}
async function buildExecutorDeps(params) {
    const apiKey = params.inputs.api_key;
    const primaryProviderName = params.inputs.primary_provider;
    const primaryModel = params.inputs.primary_model;
    const isLocal = localRunSelected(params);
    const primary = params.inputs.mock
        ? new MockProvider()
        : apiKey
            ? pickProvider(primaryProviderName, primaryModel, apiKey)
            : params.inputs.agent_key
                ? marketplaceOnlyProvider(primaryProviderName, primaryModel)
                : pickProvider(primaryProviderName, primaryModel, apiKey);
    let effectiveProvider = primary;
    let fallbackProvider = null;
    if (!params.inputs.mock && params.inputs.fallback_provider) {
        const fallbackName = params.inputs.fallback_provider;
        const fallbackModel = params.inputs.fallback_model;
        const fallbackKey = apiKey && inputs_js_1.PROVIDER_ENV_VARS[fallbackName] === inputs_js_1.PROVIDER_ENV_VARS[primaryProviderName]
            ? apiKey
            : process.env[inputs_js_1.PROVIDER_ENV_VARS[fallbackName]] ?? null;
        if (fallbackKey) {
            try {
                fallbackProvider = pickProvider(fallbackName, fallbackModel, fallbackKey);
            }
            catch (err) {
                // A fallback that does not exist must SAY so. The error used to be
                // swallowed into `fallback = null`, so the run had no fallback and no
                // message — the pipeline simply died on the primary's error, and the
                // configuration mistake was invisible.
                console.warn(`[fallback] disabled: ${String(err?.message ?? err).replace(/\s+/g, ' ')}`);
            }
            const runtimePricing = buildRuntimePricing(apiKey);
            effectiveProvider = new fallback_js_1.FallbackProvider(primary, fallbackProvider, {
                hasFallback: true,
                fallbackOnError: params.inputs.fallback_on_error,
                pricing: asMicroPricer(runtimePricing),
            });
        }
    }
    const provider = effectiveProvider;
    // The registry must know BOTH providers by their own names: the wrapper
    // answers to the primary's name, and a stage that names the fallback
    // provider ('provider: ${input.provider}' = openai) has to find it. A
    // registry of one wrapper was why every spec that names its provider died
    // with "Available providers: fallback".
    const registry = new pipeline_runtime_1.LLMProviderRegistry([
        provider,
        ...(fallbackProvider && fallbackProvider.name !== provider.name ? [fallbackProvider] : []),
    ]);
    const pricing = buildRuntimePricing(apiKey);
    const deps = {
        provider,
        registry,
        pricing,
        // A mock run calls the mock, whatever the stage declares. A stage that
        // names a provider is resolved against the registry, and the registry
        // holds only 'mock' — so a mock run of a real spec died with "Provider
        // 'minimax' is not registered. Available providers: mock". The CLI does
        // the same for its --mock.
        forceMock: params.inputs.mock,
        modelResolver: (0, pipeline_runtime_1.createModelResolver)({ agentDefault: primaryModel }),
        fetchSkill: async () => null,
        getCurrentAgentId: () => '0xaction-runner',
        getPipelineAuthorId: () => '0xaction-runner',
        // A local run really is local: working_dir is honoured and `shell:` stages
        // have a runner. The marketplace path keeps none of that — the server
        // executes, and refuses shell itself.
        isLocal,
        ...(isLocal ? { shellExecutor: new pipeline_runtime_1.NodeShellExecutor() } : {}),
        context_mode: params.inputs.context_mode,
    };
    return deps;
}


/***/ }),

/***/ 122:
/***/ ((__unused_webpack_module, exports) => {

"use strict";

/**
 * v0.4.0 — Provider fallback wrapper.
 *
 * Goal: resilience. If the primary LLM provider returns a transient error
 * (HTTP 429 rate-limit, HTTP 408 / connection timeout, HTTP 5xx server error),
 * automatically retry the same prompt on a configured fallback provider. The
 * action exposes which provider ultimately served the call, plus per-provider
 * cost, so consumers can bill correctly and detect degraded paths.
 *
 * Design:
 *
 *   - {@link FallbackProvider} implements the runtime's `LLMProvider` interface
 *     so it can be dropped in as `deps.provider` without any runtime changes.
 *     When `fallback` is `null` the wrapper is a transparent passthrough — its
 *     `name`/`models`/`supports()` mirror the primary so existing consumers
 *     (`buildExecutorDeps` callers, the v0.3.x provider wiring tests) see the
 *     exact same surface.
 *
 *   - {@link callProviderWithFallback} is the public entry point per task
 *     spec: takes a prompt + options, returns `{ result, provider_used,
 *     primary_error }`. Internally, both `generateText` and `generateJson`
 *     delegate here so the runtime's pipeline loop sees one LLM call per
 *     stage regardless of whether fallback fired.
 *
 *   - Error classification uses {@link isRetryableError}, a focused predicate
 *     (NOT a copy of `defaultRetryable` from `retry.ts`) that respects the
 *     `fallback_on_error` filter. The default `any` mode retries on all three
 *     transient classes — narrower modes (`rate_limit`, `timeout`,
 *     `server_error`) only fire for their specific class.
 *
 *   - Cost is tracked per-call: each successful generate resolves the actual
 *     model + token usage via the supplied `MicroUsdcPricer` and accumulates
 *     to `cost_primary_micro_usdc` or `cost_fallback_micro_usdc`. The runtime
 *     sees `deps.pricing` for its own `totalCostMicroUsdc` accounting, which
 *     may be inaccurate when fallback fires (it prices against the stage's
 *     declared model, not the fallback's actual model). `run.ts` therefore
 *     uses the wrapper's per-provider totals for the cost outputs so
 *     `cost_usdc == total_cost_usdc` regardless of the fallback path.
 *
 *   - When both providers fail, {@link BothProvidersFailedError} carries the
 *     primary error as `cause` and the fallback error as `fallbackCause` so
 *     a single try/catch at the action boundary can surface both messages in
 *     `$GITHUB_STEP_SUMMARY` without losing detail.
 */
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.FallbackProvider = exports.BothProvidersFailedError = exports.DEFAULT_FALLBACK_ON_ERROR = exports.FALLBACK_ON_ERROR_MODES = void 0;
exports.classifyError = classifyError;
exports.isRetryableError = isRetryableError;
exports.createFallbackProvider = createFallbackProvider;
exports.FALLBACK_ON_ERROR_MODES = [
    'rate_limit',
    'timeout',
    'server_error',
    'any',
];
exports.DEFAULT_FALLBACK_ON_ERROR = 'any';
function classifyError(e) {
    if (e === null || e === undefined)
        return 'non_retryable';
    const err = e;
    const status = err.status ?? err.statusCode;
    if (typeof status === 'number') {
        if (status === 429)
            return 'rate_limit';
        if (status === 408)
            return 'timeout';
        if (status >= 500 && status <= 599)
            return 'server_error';
        if (status >= 400 && status <= 499)
            return 'non_retryable';
    }
    const name = typeof err.name === 'string' ? err.name.toLowerCase() : '';
    const code = typeof err.code === 'string' ? err.code.toLowerCase() : '';
    const message = typeof err.message === 'string' ? err.message.toLowerCase() : '';
    if (name.includes('ratelimit') || code.includes('ratelimit'))
        return 'rate_limit';
    if (name.includes('timeout') ||
        code === 'etimedout' ||
        code === 'econnreset' ||
        code === 'enotfound' ||
        code === 'eai_again') {
        return 'timeout';
    }
    if (name.includes('server') || code.startsWith('5'))
        return 'server_error';
    if (message.includes('429') ||
        message.includes('rate limit') ||
        message.includes('token plan usage limit reached')) {
        return 'rate_limit';
    }
    if (message.includes('timeout') || message.includes('timed out') || message.includes('etimedout')) {
        return 'timeout';
    }
    if (message.includes('500') ||
        message.includes('502') ||
        message.includes('503') ||
        message.includes('504') ||
        message.includes('server error') ||
        message.includes('bad gateway') ||
        message.includes('service unavailable') ||
        message.includes('gateway timeout')) {
        return 'server_error';
    }
    return 'unknown';
}
const MODE_TO_CLASSES = {
    rate_limit: new Set(['rate_limit']),
    timeout: new Set(['timeout']),
    server_error: new Set(['server_error']),
    any: new Set(['rate_limit', 'timeout', 'server_error', 'unknown']),
};
function isRetryableError(e, mode) {
    const cls = classifyError(e);
    return MODE_TO_CLASSES[mode].has(cls);
}
class BothProvidersFailedError extends Error {
    primary;
    fallback;
    constructor(primary, fallback) {
        super(`Both providers failed: primary '${primary.message}'; fallback '${fallback.message}'`);
        this.name = 'BOTH_PROVIDERS_FAILED';
        this.primary = primary;
        this.fallback = fallback;
        const chained = new Error(primary.message);
        chained.cause = fallback;
        chained.stack = primary.stack;
        this.cause = chained;
    }
}
exports.BothProvidersFailedError = BothProvidersFailedError;
class FallbackProvider {
    /**
     * The primary provider's name.
     *
     * The wrapper used to call itself 'fallback', and the registry was built
     * around that one wrapper — so a stage naming its provider ('openai') found
     * 'fallback' instead and died with "Provider 'openai' is not registered.
     * Available providers: fallback". Every published spec names its provider,
     * so every one of them died as soon as a fallback was configured. The
     * wrapper answers to the primary's name; the fallback is registered under
     * its own (see executor-deps.ts).
     */
    name;
    models;
    simpleModel;
    complexModel;
    hasFallback;
    fallbackOnError;
    primary;
    fallback;
    pricing;
    cost_primary_micro_usdc = 0;
    cost_fallback_micro_usdc = 0;
    callCount = 0;
    fallbackCallCount = 0;
    lastPrimaryError = undefined;
    _lastResult = undefined;
    _lastProviderUsed = undefined;
    constructor(primary, fallback, opts) {
        if (!primary) {
            throw new Error('FallbackProvider: primary provider is required');
        }
        this.primary = primary;
        this.fallback = fallback;
        this.hasFallback = opts.hasFallback && fallback !== null;
        this.fallbackOnError = opts.fallbackOnError ?? exports.DEFAULT_FALLBACK_ON_ERROR;
        this.pricing = opts.pricing;
        this.name = primary.name;
        const seen = new Set();
        const merged = [];
        for (const m of primary.models) {
            if (!seen.has(m)) {
                seen.add(m);
                merged.push(m);
            }
        }
        if (fallback) {
            for (const m of fallback.models) {
                if (!seen.has(m)) {
                    seen.add(m);
                    merged.push(m);
                }
            }
        }
        this.models = merged;
        this.simpleModel = primary.simpleModel;
        this.complexModel = primary.complexModel;
    }
    supports(model) {
        if (this.primary.supports(model))
            return true;
        if (this.fallback && this.fallback.supports(model))
            return true;
        return false;
    }
    async callProviderWithFallback(prompt, opts) {
        const primaryOutcome = await this.tryPrimary(prompt, opts);
        if (primaryOutcome.ok) {
            return { result: primaryOutcome.result, provider_used: 'primary' };
        }
        const primaryError = primaryOutcome.error;
        this.lastPrimaryError = primaryError;
        if (!this.fallback) {
            throw primaryError;
        }
        if (!isRetryableError(primaryError, this.fallbackOnError)) {
            throw primaryError;
        }
        return await this.tryFallback(this.fallback, prompt, opts, primaryError);
    }
    async generateText(prompt, opts) {
        const out = await this.callProviderWithFallback(prompt, opts);
        return out.result;
    }
    async generateJson(prompt, schema, opts) {
        try {
            return await this.primary.generateJson(prompt, schema, opts);
        }
        catch (primaryError) {
            const err = primaryError instanceof Error ? primaryError : new Error(String(primaryError));
            this.lastPrimaryError = err;
            if (!this.fallback || !isRetryableError(err, this.fallbackOnError)) {
                throw primaryError;
            }
            return await this.fallback.generateJson(prompt, schema, opts);
        }
    }
    async tryPrimary(prompt, opts) {
        this.callCount += 1;
        const modelForCost = this.modelForCost(opts);
        try {
            const result = await this.primary.generateText(prompt, opts);
            const micro = await this.pricing.resolveCostMicroUsdc(modelForCost, result.usage);
            this.cost_primary_micro_usdc += micro;
            this._lastResult = result;
            this._lastProviderUsed = 'primary';
            return { ok: true, result };
        }
        catch (e) {
            return { ok: false, error: e instanceof Error ? e : new Error(String(e)) };
        }
    }
    /** `fallback` is passed in narrowed, so no redundant null guard is needed here. */
    async tryFallback(fallback, prompt, opts, primaryError) {
        this.fallbackCallCount += 1;
        const modelForCost = this.fallbackModelForCost(opts, fallback);
        try {
            const result = await fallback.generateText(prompt, opts);
            const micro = await this.pricing.resolveCostMicroUsdc(modelForCost, result.usage);
            this.cost_fallback_micro_usdc += micro;
            this._lastResult = result;
            this._lastProviderUsed = 'fallback';
            return { result, provider_used: 'fallback', primary_error: primaryError };
        }
        catch (fallbackError) {
            const fbErr = fallbackError instanceof Error ? fallbackError : new Error(String(fallbackError));
            throw new BothProvidersFailedError(primaryError, fbErr);
        }
    }
    get lastProviderUsed() {
        return this._lastProviderUsed;
    }
    get lastResult() {
        return this._lastResult;
    }
    modelForCost(opts) {
        if (typeof opts.model === 'string' && opts.model.length > 0)
            return opts.model;
        return this.primary.simpleModel;
    }
    fallbackModelForCost(opts, fallback) {
        if (typeof opts.model === 'string' && opts.model.length > 0)
            return opts.model;
        return fallback.simpleModel;
    }
}
exports.FallbackProvider = FallbackProvider;
function createFallbackProvider(primary, fallback, opts) {
    if (fallback === null || !opts.hasFallback)
        return primary;
    return new FallbackProvider(primary, fallback, opts);
}


/***/ }),

/***/ 157:
/***/ ((__unused_webpack_module, exports) => {

"use strict";

/**
 * SARIF 2.1.0 output formatter for review findings.
 *
 * Goal: emit findings as a SARIF JSON document so consumer workflows can
 * upload it to GitHub Code Scanning via `github/codeql-action/upload-sarif@v3`
 * and surface review results in the PR's "Security" tab — same UX as CodeQL
 * / Snyk / Dependabot.
 *
 * Spec: https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html
 *
 * Design choices:
 *
 *   - **Inline minimal types** instead of pulling in `@types/sarif`. The
 *     SARIF schema is large (~200 fields per run) and most of them are
 *     optional. We only model the fields we actually emit — adding a real
 *     dependency just for type safety would inflate the bundle for no
 *     runtime benefit.
 *
 *   - **Single `tool.driver` block** per log — every finding is treated as
 *     produced by `agentsmarket/pipeline-action` itself. Reviewers can
 *     filter Code Scanning alerts by tool name (`tool.driver.name ==
 *     'agentsmarket-pipeline-action'`), which is the standard Code Scanning
 *     UX pattern (CodeQL / Snyk do the same).
 *
 *   - **`ruleId` = CWE when present** (the only stable cross-scanner
 *     identifier for review findings), otherwise a stable hash of
 *     `(file, line, message)` so re-runs on the same finding dedupe in
 *     Code Scanning's alerts view. The hash is deterministic and 16 chars
 *     long — short enough to fit Code Scanning's "Rule" column.
 *
 *   - **`partialFingerprints`** carry a stable per-finding hash (FNV-1a
 *     32-bit of `file|line|cwe|message`) so GitHub can dedupe alerts
 *     across runs. Code Scanning honours `partialFingerprints` /
 *     `fingerprints` for exactly this purpose.
 *
 *   - **Severity mapping** follows the GitHub Code Scanning guidance
 *     (https://docs.github.com/en/code-security/code-scanning/automatically-scanning-your-code-for-vulnerabilities-and-errors/about-code-scanning-alerts#about-severity-levels):
 *     `critical → error`, `high → error`, `medium → warning`, `low → note`.
 *     Anything else falls back to `note` so we never emit an invalid
 *     `level`.
 *
 *   - **`location` is omitted when no file is known** — SARIF allows
 *     `results[].locations` to be empty (an alert without a location is
 *     a file-level finding). We do NOT synthesise a placeholder path.
 *
 *   - **`versionControlProvenance` carries `repo` + `commit_sha`** when
 *     the consumer passed them via the `context` parameter. Code Scanning
 *     needs these to anchor the alert to a commit and link the "View on
 *     GitHub" affordance. Optional — no field when `context` is empty.
 */
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.severityToSarifLevel = severityToSarifLevel;
exports.findingFingerprint = findingFingerprint;
exports.findingRuleId = findingRuleId;
exports.formatFindingsAsSarif = formatFindingsAsSarif;
/** Tool identity — single source of truth for `tool.driver`. */
const TOOL_NAME_DEFAULT = 'agentsmarket-pipeline-action';
const TOOL_VERSION_DEFAULT = '0.4.0';
const TOOL_INFORMATION_URI_DEFAULT = 'https://agentsmarket.world';
/**
 * Severity → SARIF level mapping. Industry standard per GitHub Code Scanning:
 *   critical → error, high → error, medium → warning, low → note.
 * Unknown severities fall back to `note` (never emits an invalid level).
 */
function severityToSarifLevel(severity) {
    switch (severity) {
        case 'critical':
            return 'error';
        case 'high':
            return 'error';
        case 'medium':
            return 'warning';
        case 'low':
            return 'note';
        default:
            return 'note';
    }
}
/**
 * Stable per-finding hash for SARIF dedup. Uses `file|line|cwe|message`
 * so the same finding on the same line with the same description dedupes
 * across runs (and is robust to CWE being absent). We use a short FNV-1a
 * 32-bit hash encoded as 8 hex chars — long enough to avoid collisions on
 * a single PR, short enough to fit Code Scanning's "Fingerprint" column.
 *
 * Pulled out so the test suite can assert determinism without snapshotting
 * the exact hex string (which would be brittle).
 */
function findingFingerprint(finding) {
    const key = [
        finding.file,
        finding.line !== undefined ? String(finding.line) : '',
        finding.cwe ?? '',
        finding.message,
    ].join('|');
    return fnv1a32Hex(key);
}
/**
 * Stable `ruleId` for a finding. Prefers the CWE (the only cross-scanner
 * identifier that Code Scanning recognizes); falls back to a synthetic
 * `REVIEW-<hash>` derived from the same key the fingerprint uses, so
 * re-runs of the same finding get the same rule and dedupe.
 */
function findingRuleId(finding) {
    if (finding.cwe !== undefined && finding.cwe.length > 0) {
        return finding.cwe;
    }
    return `REVIEW-${findingFingerprint(finding)}`;
}
/**
 * Format findings as a SARIF 2.1.0 log.
 *
 * Empty input produces a valid SARIF log with empty `results` + `rules`
 * arrays (Code Scanning accepts this — it's the "ran clean" case).
 */
function formatFindingsAsSarif(findings, context = { repo: '', commit_sha: '' }) {
    const rules = [];
    const ruleIdToIndex = new Map();
    const results = [];
    for (const finding of findings) {
        const ruleId = findingRuleId(finding);
        let ruleIndex = ruleIdToIndex.get(ruleId);
        if (ruleIndex === undefined) {
            ruleIndex = rules.length;
            ruleIdToIndex.set(ruleId, ruleIndex);
            rules.push(buildRule(ruleId, finding));
        }
        results.push({
            ruleId,
            ruleIndex,
            level: severityToSarifLevel(finding.severity),
            message: { text: buildMessageText(finding) },
            locations: buildLocations(finding),
            partialFingerprints: {
                agentsmarketPipelineActionV1: findingFingerprint(finding),
            },
            properties: buildProperties(finding),
        });
    }
    const run = {
        tool: {
            driver: {
                name: context.tool_name ?? TOOL_NAME_DEFAULT,
                version: context.tool_version ?? TOOL_VERSION_DEFAULT,
                informationUri: context.information_uri ?? TOOL_INFORMATION_URI_DEFAULT,
                rules,
            },
        },
        results,
    };
    if (context.repo.length > 0 && context.commit_sha.length > 0) {
        const provenance = {
            repositoryUri: `https://github.com/${context.repo}`,
            revisionId: context.commit_sha,
        };
        if (context.branch !== undefined && context.branch.length > 0) {
            provenance.branch = context.branch;
        }
        run.versionControlProvenance = [provenance];
    }
    return {
        $schema: 'https://schemastore.azurewebsites.net/schemas/json/sarif-2.1.0-rtm.5.json',
        version: '2.1.0',
        runs: [run],
    };
}
function buildRule(ruleId, finding) {
    const isCwe = /^CWE-\d+$/.test(ruleId);
    const rule = {
        id: ruleId,
        name: isCwe ? ruleId : `Review finding ${ruleId.slice(0, 8)}`,
        shortDescription: { text: buildShortDescription(ruleId, finding) },
        fullDescription: { text: buildFullDescription(ruleId, finding) },
        defaultConfiguration: {
            level: severityToSarifLevel(finding.severity),
        },
    };
    return rule;
}
function buildShortDescription(ruleId, finding) {
    if (ruleId === finding.cwe) {
        return finding.message.length > 0 ? finding.message : `${ruleId} finding`;
    }
    return finding.message.length > 0
        ? finding.message
        : `Review finding (severity: ${finding.severity})`;
}
function buildFullDescription(ruleId, finding) {
    const parts = [];
    if (ruleId === finding.cwe) {
        parts.push(`**CWE:** ${finding.cwe}`);
        parts.push(`**Severity:** ${finding.severity}`);
        parts.push(`**Confidence:** ${finding.confidence.toFixed(2)}`);
        if (finding.file.length > 0) {
            parts.push(`**Location:** ${finding.file}${finding.line !== undefined ? `:${finding.line}` : ''}`);
        }
        if (finding.message.length > 0) {
            parts.push('', finding.message);
        }
        if (finding.recommendation !== undefined && finding.recommendation.length > 0) {
            parts.push('', `**Recommendation:** ${finding.recommendation}`);
        }
    }
    else {
        parts.push(`**Severity:** ${finding.severity}`);
        parts.push(`**Confidence:** ${finding.confidence.toFixed(2)}`);
        if (finding.message.length > 0)
            parts.push('', finding.message);
    }
    return parts.join('\n');
}
function buildMessageText(finding) {
    const parts = [];
    if (finding.message.length > 0)
        parts.push(finding.message);
    if (finding.cwe !== undefined && finding.cwe.length > 0) {
        parts.push(`(CWE: ${finding.cwe})`);
    }
    if (finding.recommendation !== undefined && finding.recommendation.length > 0) {
        parts.push(`— Recommendation: ${finding.recommendation}`);
    }
    return parts.join(' ');
}
function buildLocations(finding) {
    if (finding.file.length === 0)
        return [];
    const loc = {
        physicalLocation: {
            artifactLocation: { uri: finding.file },
        },
    };
    if (finding.line !== undefined && finding.line > 0) {
        loc.physicalLocation.region = { startLine: finding.line };
    }
    return [loc];
}
function buildProperties(finding) {
    const props = {
        severity: finding.severity,
        confidence: finding.confidence,
    };
    if (finding.recommendation !== undefined && finding.recommendation.length > 0) {
        props.recommendation = finding.recommendation;
    }
    if (finding.cwe !== undefined && finding.cwe.length > 0) {
        props.cwe = finding.cwe;
    }
    return props;
}
/**
 * FNV-1a 32-bit hash, encoded as 8 lowercase hex chars. Deterministic
 * across runs (no random salt), no crypto dependency. Used for stable
 * synthetic rule IDs and dedup fingerprints.
 */
function fnv1a32Hex(input) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i += 1) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}


/***/ }),

/***/ 601:
/***/ ((__unused_webpack_module, exports) => {

"use strict";

/**
 * Action input parsing + validation.
 *
 * GitHub Actions injects each declared input as `INPUT_<UPPER_SNAKE>` env var,
 * always a string. Boolean toggles arrive as "true" or "false". Object inputs
 * come as JSON strings.
 *
 * Provider selection (v0.2.0): the `provider` input picks the LLM backend.
 * The API key resolves from the explicit `api_key` input first, then from
 * the provider-specific env var (MINIMAX_API_KEY / OPENAI_API_KEY /
 * ANTHROPIC_API_KEY / OPENROUTER_API_KEY).
 *
 * Context mode (v0.3.0 — TASKS row 90): the `context_mode` input declares how
 * much code context the LLM sees beyond the PR diff. The actual fetching is
 * pipeline-runtime's responsibility; we only plumb the declaration through.
 *
 * Provider fallback (v0.4.0 — TASKS row 105): the action optionally chains a
 * secondary LLM provider that catches transient primary failures (429, 408,
 * 5xx). The new inputs are opt-in: when `fallback_provider` is empty OR the
 * corresponding API key is missing, the action degrades to primary-only and
 * preserves v0.3.x behaviour exactly. The documented default is
 * `fallback_provider='openai'` (see `action.yml`), but the runtime skips
 * wiring when `OPENAI_API_KEY` is unset so existing consumers that have
 * never configured OpenAI see no behaviour change.
 *
 * Output format (v0.4.0 — TASKS row 106): the `output_format` input picks
 * which downstream format to emit for findings, on top of the always-emitted
 * human-readable summary. `'summary'` (default) preserves v0.3.x behaviour —
 * only `findings_json` + `summary_only_findings_json` are emitted. `'sarif'`
 * additionally emits `findings_sarif` for upload to GitHub Code Scanning
 * via `github/codeql-action/upload-sarif@v3`.
 */
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.DEFAULT_OUTPUT_FORMAT = exports.SUPPORTED_OUTPUT_FORMATS = exports.DEFAULT_WEBHOOK_FORMAT = exports.SUPPORTED_WEBHOOK_FORMATS = exports.DEFAULT_FALLBACK_MODEL = exports.DEFAULT_FALLBACK_ON_ERROR_MODE = exports.SUPPORTED_FALLBACK_ON_ERROR = exports.DEFAULT_CONTEXT_MODE = exports.SUPPORTED_CONTEXT_MODES = exports.PROVIDER_ENV_VARS = exports.DEFAULT_FALLBACK_PROVIDER = exports.DEFAULT_PROVIDER = exports.SUPPORTED_PROVIDERS = void 0;
exports.normalizeWebhookFormat = normalizeWebhookFormat;
exports.normalizeProvider = normalizeProvider;
exports.normalizeFallbackOnError = normalizeFallbackOnError;
exports.normalizeContextMode = normalizeContextMode;
exports.normalizeOutputFormat = normalizeOutputFormat;
exports.resolveApiKeyForProvider = resolveApiKeyForProvider;
exports.resolveFallback = resolveFallback;
exports.resolveMarketplaceKey = resolveMarketplaceKey;
exports.readInputs = readInputs;
exports.parseInputJson = parseInputJson;
exports.SUPPORTED_PROVIDERS = [
    'minimax',
    'openai',
    'anthropic',
    'openrouter',
];
exports.DEFAULT_PROVIDER = 'minimax';
exports.DEFAULT_FALLBACK_PROVIDER = 'openai';
exports.PROVIDER_ENV_VARS = {
    minimax: 'MINIMAX_API_KEY',
    openai: 'OPENAI_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
    openrouter: 'OPENROUTER_API_KEY',
};
exports.SUPPORTED_CONTEXT_MODES = [
    'diff',
    'imports',
    'related',
    'full',
];
exports.DEFAULT_CONTEXT_MODE = 'imports';
exports.SUPPORTED_FALLBACK_ON_ERROR = [
    'rate_limit',
    'timeout',
    'server_error',
    'any',
];
exports.DEFAULT_FALLBACK_ON_ERROR_MODE = 'any';
exports.DEFAULT_FALLBACK_MODEL = 'gpt-4o-mini';
exports.SUPPORTED_WEBHOOK_FORMATS = [
    'slack',
    'discord',
    'teams',
    'auto',
];
exports.DEFAULT_WEBHOOK_FORMAT = 'auto';
function normalizeWebhookFormat(raw) {
    if (raw === undefined || raw === null)
        return exports.DEFAULT_WEBHOOK_FORMAT;
    const normalized = raw.trim().toLowerCase();
    if (normalized === '')
        return exports.DEFAULT_WEBHOOK_FORMAT;
    if (exports.SUPPORTED_WEBHOOK_FORMATS.includes(normalized)) {
        return normalized;
    }
    throw new Error(`Unsupported webhook_format '${raw}'. ` +
        `Supported values: ${exports.SUPPORTED_WEBHOOK_FORMATS.join(', ')}. ` +
        `Drop the input to use the default ('${exports.DEFAULT_WEBHOOK_FORMAT}').`);
}
exports.SUPPORTED_OUTPUT_FORMATS = ['summary', 'sarif'];
exports.DEFAULT_OUTPUT_FORMAT = 'summary';
const DEFAULT_MODEL = 'MiniMax-M3';
function readEnvBool(name, fallback) {
    const raw = process.env[name];
    if (raw === undefined || raw === '')
        return fallback;
    return raw === 'true' || raw === '1';
}
function readEnvString(name, fallback) {
    const raw = process.env[name];
    if (raw === undefined || raw === '')
        return fallback;
    return raw;
}
function normalizeProvider(raw, model) {
    const normalized = raw.trim().toLowerCase();
    if (exports.SUPPORTED_PROVIDERS.includes(normalized)) {
        return normalized;
    }
    throw new Error(`Unsupported provider '${raw}' (model '${model}'). ` +
        `Supported providers: ${exports.SUPPORTED_PROVIDERS.join(', ')}. ` +
        `Set 'provider' to one of these or drop the input (default '${exports.DEFAULT_PROVIDER}').`);
}
function normalizeFallbackOnError(raw) {
    if (raw === undefined || raw === null)
        return exports.DEFAULT_FALLBACK_ON_ERROR_MODE;
    const normalized = raw.trim().toLowerCase();
    if (normalized === '')
        return exports.DEFAULT_FALLBACK_ON_ERROR_MODE;
    if (exports.SUPPORTED_FALLBACK_ON_ERROR.includes(normalized)) {
        return normalized;
    }
    throw new Error(`Unsupported fallback_on_error '${raw}'. ` +
        `Supported values: ${exports.SUPPORTED_FALLBACK_ON_ERROR.join(', ')}. ` +
        `Drop the input to use the default ('${exports.DEFAULT_FALLBACK_ON_ERROR_MODE}').`);
}
function normalizeContextMode(raw) {
    if (raw === undefined || raw === null)
        return exports.DEFAULT_CONTEXT_MODE;
    const normalized = raw.trim().toLowerCase();
    if (normalized === '')
        return exports.DEFAULT_CONTEXT_MODE;
    if (exports.SUPPORTED_CONTEXT_MODES.includes(normalized)) {
        return normalized;
    }
    throw new Error(`Unsupported context_mode '${raw}'. ` +
        `Supported values: ${exports.SUPPORTED_CONTEXT_MODES.join(', ')}. ` +
        `Drop the input to use the default ('${exports.DEFAULT_CONTEXT_MODE}').`);
}
function normalizeOutputFormat(raw) {
    if (raw === undefined || raw === null)
        return exports.DEFAULT_OUTPUT_FORMAT;
    const normalized = raw.trim().toLowerCase();
    if (normalized === '')
        return exports.DEFAULT_OUTPUT_FORMAT;
    if (exports.SUPPORTED_OUTPUT_FORMATS.includes(normalized)) {
        return normalized;
    }
    throw new Error(`Unsupported output_format '${raw}'. ` +
        `Supported values: ${exports.SUPPORTED_OUTPUT_FORMATS.join(', ')}. ` +
        `Drop the input to use the default ('${exports.DEFAULT_OUTPUT_FORMAT}').`);
}
function resolveApiKeyForProvider(explicitKey, provider, env = process.env) {
    if (explicitKey && explicitKey.length > 0)
        return explicitKey;
    const fromEnv = env[exports.PROVIDER_ENV_VARS[provider]];
    return fromEnv && fromEnv.length > 0 ? fromEnv : null;
}
function resolveFallback(rawProvider, rawModel, fallbackOnError, explicitKey, primaryProvider, env = process.env) {
    const fallbackOnErrorResolved = normalizeFallbackOnError(fallbackOnError);
    const providerRaw = (rawProvider ?? '').trim();
    if (providerRaw === '') {
        return { provider: null, model: '', fallback_on_error: fallbackOnErrorResolved };
    }
    let normalized;
    try {
        normalized = normalizeProvider(providerRaw, rawModel ?? '');
    }
    catch {
        throw new Error(`Unsupported fallback_provider '${providerRaw}'. ` +
            `Supported providers: ${exports.SUPPORTED_PROVIDERS.join(', ')}. ` +
            `Drop the input to disable fallback.`);
    }
    if (normalized === primaryProvider) {
        throw new Error(`fallback_provider '${normalized}' must differ from primary_provider '${primaryProvider}'. ` +
            `Drop the input to disable fallback.`);
    }
    const key = resolveApiKeyForProvider(explicitKey, normalized, env);
    if (!key) {
        return { provider: null, model: '', fallback_on_error: fallbackOnErrorResolved };
    }
    const model = (rawModel ?? '').trim();
    return {
        provider: normalized,
        model: model.length > 0 ? model : exports.DEFAULT_FALLBACK_MODEL,
        fallback_on_error: fallbackOnErrorResolved,
    };
}
/**
 * The buyer's marketplace identity.
 *
 * The `agent_key` input wins; `AGENTSMARKET_PRIVATE_KEY` in the environment is
 * the same thing and is how a workflow usually supplies it. Whitespace is not a
 * key — a secret that resolved to a newline would otherwise read as "a key is
 * present" and switch the run into a paid server execution that then fails.
 */
function resolveMarketplaceKey(explicit, env = process.env) {
    const candidates = [explicit, env.AGENTSMARKET_PRIVATE_KEY];
    for (const c of candidates) {
        if (typeof c === 'string' && c.trim().length > 0)
            return c.trim();
    }
    return null;
}
function readInputs(env = process.env) {
    const model = readEnvString('INPUT_MODEL', DEFAULT_MODEL) ?? DEFAULT_MODEL;
    const provider = normalizeProvider(readEnvString('INPUT_PROVIDER', exports.DEFAULT_PROVIDER) ?? exports.DEFAULT_PROVIDER, model);
    const rawPrimaryProvider = readEnvString('INPUT_PRIMARY_PROVIDER', null);
    const rawPrimaryModel = readEnvString('INPUT_PRIMARY_MODEL', null);
    const primaryProvider = rawPrimaryProvider
        ? normalizeProvider(rawPrimaryProvider, rawPrimaryModel ?? model)
        : provider;
    const primaryModel = rawPrimaryModel && rawPrimaryModel.length > 0 ? rawPrimaryModel : model;
    const rawFallbackProvider = readEnvString('INPUT_FALLBACK_PROVIDER', null);
    const rawFallbackModel = readEnvString('INPUT_FALLBACK_MODEL', null);
    const fallbackResolved = resolveFallback(rawFallbackProvider, rawFallbackModel, process.env.INPUT_FALLBACK_ON_ERROR, readEnvString('INPUT_API_KEY', null), primaryProvider);
    const apiKey = resolveApiKeyForProvider(readEnvString('INPUT_API_KEY', null), primaryProvider);
    return {
        api_key: apiKey,
        provider,
        pipeline_file: readEnvString('INPUT_PIPELINE_FILE', null),
        pipeline_yaml: readEnvString('INPUT_PIPELINE_YAML', null),
        pipeline: readEnvString('INPUT_PIPELINE', null),
        agent_key: resolveMarketplaceKey(readEnvString('INPUT_AGENT_KEY', null), env),
        model,
        inputs_json: readEnvString('INPUT_INPUTS_JSON', null),
        fail_fast: readEnvBool('INPUT_FAIL_FAST', true),
        mock: readEnvBool('INPUT_MOCK', false),
        context_mode: normalizeContextMode(process.env.INPUT_CONTEXT_MODE),
        allow_shell: readEnvBool('INPUT_ALLOW_SHELL', false),
        primary_provider: primaryProvider,
        primary_model: primaryModel,
        fallback_provider: fallbackResolved.provider,
        fallback_model: fallbackResolved.model,
        fallback_on_error: fallbackResolved.fallback_on_error,
        webhook_url: readEnvString('INPUT_WEBHOOK_URL', null),
        webhook_format: normalizeWebhookFormat(process.env.INPUT_WEBHOOK_FORMAT ?? null),
        output_format: normalizeOutputFormat(process.env.INPUT_OUTPUT_FORMAT),
    };
}
function parseInputJson(raw, where) {
    if (!raw)
        return {};
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch (e) {
        throw new Error(`Invalid ${where} JSON: ${e.message}`);
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error(`${where} must be a JSON object (got ${Array.isArray(parsed) ? 'array' : typeof parsed})`);
    }
    return parsed;
}


/***/ }),

/***/ 690:
/***/ ((__unused_webpack_module, exports) => {

"use strict";

/**
 * Webhook notifications — Slack / Discord / Teams incoming webhooks.
 *
 * Posts the run summary + findings to an external webhook URL after each
 * pipeline run completes. Pure additive: when `webhook_url` is empty the
 * runtime short-circuits with `{ status: 'skipped' }` and never touches
 * the network. Otherwise:
 *
 *   1. Resolve the payload format (slack | discord | teams | custom).
 *      `auto` matches the URL host: `hooks.slack.com` → slack,
 *      `discord.com/api/webhooks` → discord, `outlook.office.com/webhook`
 *      → teams, else → custom.
 *   2. Build the provider-specific payload (Block Kit / embeds /
 *      MessageCard). `custom` ships a minimal plain-JSON envelope so
 *      consumers can adapt their own handlers.
 *   3. POST with a 5-second `AbortController` timeout. Node 18+ builtin
 *      `fetch` — no external HTTP client.
 *
 * The action writes `webhook_status` to `$GITHUB_OUTPUT` so downstream
 * steps can branch on the outcome (`sent` | `skipped` | `failed`). The
 * webhook URL is a self-authenticated secret (Slack/Discord/Teams embed
 * the signing token in the URL path) — there is no separate `auth`
 * header and no extra API key to manage.
 */
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.detectFormatFromUrl = detectFormatFromUrl;
exports.buildSlackPayload = buildSlackPayload;
exports.buildDiscordPayload = buildDiscordPayload;
exports.buildTeamsPayload = buildTeamsPayload;
exports.buildCustomPayload = buildCustomPayload;
exports.notify = notify;
/** Per-request timeout (ms). Slack/Discord/Teams reply in <2s in practice. */
const FETCH_TIMEOUT_MS = 5_000;
/**
 * Detect the webhook format from the URL hostname. Returns `'custom'` for
 * any URL that does not match a known provider — callers can still POST a
 * plain JSON envelope in that case.
 */
function detectFormatFromUrl(url) {
    let hostname;
    try {
        hostname = new URL(url).hostname.toLowerCase();
    }
    catch {
        return 'custom';
    }
    if (hostname === 'hooks.slack.com')
        return 'slack';
    if (hostname === 'discord.com' || hostname.endsWith('.discord.com')) {
        // Discord incoming webhooks live under `/api/webhooks/...` on the
        // canonical host. We accept any `discord.com` subdomain to be lenient
        // with custom webhook proxies (rare but observed).
        return 'discord';
    }
    if (hostname === 'outlook.office.com' || hostname === 'outlook.office365.com') {
        return 'teams';
    }
    return 'custom';
}
/** Map of severity → Discord embed color (decimal RGB). */
const DISCORD_COLORS = {
    critical: 0xdc3545, // red
    high: 0xff8c00, // orange
    medium: 0xffd700, // yellow
    low: 0x36a2eb, // blue
};
/** Slack emoji per severity — Slack mrkdwn tolerates shortcodes. */
const SEVERITY_EMOJI = {
    critical: ':rotating_light:',
    high: ':warning:',
    medium: ':large_orange_diamond:',
    low: ':information_source:',
};
/** Stringify a finding into a single mrkdwn / embed description line. */
function formatFindingLine(finding) {
    const location = finding.line !== undefined && finding.line > 0
        ? `${finding.file}:${finding.line}`
        : finding.file;
    const cwe = finding.cwe ? ` \`${finding.cwe}\`` : '';
    const conf = ` (conf ${Math.round(finding.confidence * 100)}%)`;
    const msg = finding.message.length > 200
        ? `${finding.message.slice(0, 197)}...`
        : finding.message;
    return `\`${location}\`${cwe}${conf} — ${msg}`;
}
/**
 * Build a Slack Block Kit payload. Layout:
 *   - header block: pipeline status + counts
 *   - section block: PR context (when available)
 *   - divider
 *   - one section block per finding (capped at 10 — remaining count is
 *     summarised in a trailing context block)
 *
 * Reference: https://api.slack.com/block-kit
 */
function buildSlackPayload(findings, summary, prContext) {
    const totalCount = summary.counts.critical + summary.counts.high +
        summary.counts.medium + summary.counts.low;
    const statusEmoji = summary.status === 'passed' ? ':white_check_mark:' : ':x:';
    const headerText = `${statusEmoji} pipeline *${summary.status}* — ${totalCount} finding${totalCount === 1 ? '' : 's'} (${summary.total_ms}ms, ~$${summary.total_cost_usdc} USDC)`;
    const blocks = [
        {
            type: 'header',
            text: { type: 'plain_text', text: `pipeline-action — ${summary.status}` },
        },
        { type: 'section', text: { type: 'mrkdwn', text: headerText } },
    ];
    if (prContext.url && prContext.pull_number > 0) {
        blocks.push({
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: `*PR:* <${prContext.url}|${prContext.owner}/${prContext.repo}#${prContext.pull_number}>`,
            },
        });
    }
    blocks.push({ type: 'divider' });
    const visible = findings.slice(0, 10);
    for (const finding of visible) {
        blocks.push({
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: `${SEVERITY_EMOJI[finding.severity]} *${finding.severity.toUpperCase()}* — ${formatFindingLine(finding)}`,
            },
        });
    }
    if (findings.length > visible.length) {
        blocks.push({
            type: 'context',
            elements: [
                {
                    type: 'mrkdwn',
                    text: `_+${findings.length - visible.length} more findings truncated_ — see \`findings_json\` output for the full list.`,
                },
            ],
        });
    }
    if (findings.length === 0) {
        blocks.push({
            type: 'section',
            text: { type: 'mrkdwn', text: ':sparkles: No findings — clean run.' },
        });
    }
    return { text: headerText, blocks };
}
/**
 * Build a Discord webhook payload. Discord expects a top-level `content`
 * (fallback text) and an optional `embeds` array. We emit one embed with
 * a severity-coloured side-bar and one `description` line per finding.
 *
 * Reference: https://discord.com/developers/docs/resources/channel#embed-object
 */
function buildDiscordPayload(findings, summary, prContext) {
    const totalCount = summary.counts.critical + summary.counts.high +
        summary.counts.medium + summary.counts.low;
    const dominant = pickDominantSeverity(summary);
    const color = dominant ? DISCORD_COLORS[dominant] : 0x2eb88a; // green = clean
    const title = `pipeline-action — ${summary.status}`;
    const descriptionLines = [
        `**${totalCount}** finding${totalCount === 1 ? '' : 's'} in ${summary.total_ms}ms (~$${summary.total_cost_usdc} USDC)`,
    ];
    if (prContext.url && prContext.pull_number > 0) {
        descriptionLines.push(`PR: [${prContext.owner}/${prContext.repo}#${prContext.pull_number}](${prContext.url})`);
    }
    if (findings.length > 0) {
        const visible = findings.slice(0, 10);
        for (const finding of visible) {
            descriptionLines.push(`${SEVERITY_EMOJI[finding.severity]} **${finding.severity}** — ${formatFindingLine(finding)}`);
        }
        if (findings.length > visible.length) {
            descriptionLines.push(`_+${findings.length - visible.length} more truncated_`);
        }
    }
    else {
        descriptionLines.push('No findings — clean run.');
    }
    return {
        content: `pipeline-action: ${summary.status} (${totalCount} findings)`,
        embeds: [
            {
                title,
                description: descriptionLines.join('\n'),
                color,
                timestamp: new Date().toISOString(),
            },
        ],
    };
}
/**
 * Build a Microsoft Teams MessageCard payload. Layout: a single card with
 * `summary` (notification fallback) + a list of `Section` facts + per-finding
 * `Section` blocks (capped at 10). MessageCard 1.2 is the actionable-messages
 * format supported by every Teams incoming-webhook connector.
 *
 * Reference: https://learn.microsoft.com/en-us/outlook/actionable-messages/message-card-reference
 */
function buildTeamsPayload(findings, summary, prContext) {
    const totalCount = summary.counts.critical + summary.counts.high +
        summary.counts.medium + summary.counts.low;
    const sections = [
        {
            activityTitle: `pipeline-action — ${summary.status}`,
            facts: [
                { name: 'Status', value: summary.status },
                { name: 'Total findings', value: String(totalCount) },
                { name: 'Max severity', value: summary.max_severity ?? 'none' },
                { name: 'Duration', value: `${summary.total_ms} ms` },
                { name: 'Cost', value: `~$${summary.total_cost_usdc} USDC` },
                ...(prContext.pull_number > 0
                    ? [{ name: 'PR', value: `${prContext.owner}/${prContext.repo}#${prContext.pull_number}` }]
                    : []),
            ],
        },
    ];
    const visible = findings.slice(0, 10);
    for (const finding of visible) {
        sections.push({
            activityTitle: `${finding.severity.toUpperCase()} — ${finding.file}${finding.line !== undefined && finding.line > 0 ? `:${finding.line}` : ''}`,
            text: `${finding.message}${finding.cwe ? ` (${finding.cwe})` : ''}`,
        });
    }
    if (findings.length > visible.length) {
        sections.push({
            activityTitle: `${findings.length - visible.length} more findings`,
            text: 'See `findings_json` action output for the full list.',
        });
    }
    if (findings.length === 0) {
        sections.push({
            activityTitle: 'No findings',
            text: 'Clean run — no review comments generated.',
        });
    }
    return {
        '@type': 'MessageCard',
        '@context': 'https://schema.org/extensions',
        summary: `pipeline-action: ${summary.status} — ${totalCount} finding${totalCount === 1 ? '' : 's'}`,
        themeColor: summary.status === 'passed' ? '00FF00' : 'FF0000',
        sections,
    };
}
/** Minimal payload for unknown webhooks. Plain JSON envelope. */
function buildCustomPayload(findings, summary, prContext) {
    return {
        source: 'agentsmarket/pipeline-action',
        summary,
        pr: prContext,
        findings,
    };
}
/** Pick the most severe non-zero severity for embed colour. */
function pickDominantSeverity(summary) {
    if (summary.counts.critical > 0)
        return 'critical';
    if (summary.counts.high > 0)
        return 'high';
    if (summary.counts.medium > 0)
        return 'medium';
    if (summary.counts.low > 0)
        return 'low';
    return null;
}
/**
 * POST a webhook notification. Returns synchronously after the network
 * round-trip; never throws — all failures are folded into the
 * `NotifyResult.status === 'failed'` branch.
 */
async function notify(opts) {
    if (!opts.url || opts.url.trim().length === 0) {
        return { status: 'skipped' };
    }
    let format;
    if (opts.format === 'auto') {
        format = detectFormatFromUrl(opts.url);
    }
    else {
        format = opts.format;
    }
    let body;
    switch (format) {
        case 'slack':
            body = buildSlackPayload(opts.findings, opts.summary, opts.prContext);
            break;
        case 'discord':
            body = buildDiscordPayload(opts.findings, opts.summary, opts.prContext);
            break;
        case 'teams':
            body = buildTeamsPayload(opts.findings, opts.summary, opts.prContext);
            break;
        case 'custom':
        default:
            body = buildCustomPayload(opts.findings, opts.summary, opts.prContext);
            break;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        const res = await fetch(opts.url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
        if (!res.ok) {
            return {
                status: 'failed',
                http_status: res.status,
                error: `HTTP ${res.status} ${res.statusText}`.trim(),
            };
        }
        return { status: 'sent', http_status: res.status };
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
            status: 'failed',
            error: controller.signal.aborted ? `timeout after ${FETCH_TIMEOUT_MS}ms: ${msg}` : msg,
        };
    }
    finally {
        clearTimeout(timer);
    }
}


/***/ }),

/***/ 750:
/***/ ((__unused_webpack_module, exports) => {

"use strict";

/**
 * Output formatting for PR-review style pipelines.
 *
 * Pipeline actions produce `Record<stage_id, string>` where each value is the
 * raw stage output text (usually a JSON string per `output_format:
 * structured_json`). Many of our wedges — `code-review-security-audit`,
 * `api-design-reviewer`,
 * `style-review` — emit arrays of `findings` with severity, file/line,
 * description, CWE, confidence, recommendation. This module:
 *
 *   1. Parses each stage output (JSON first, regex fallback for plain text).
 *   2. Normalizes the various field-name conventions used by our wedges
 *      (`path`/`file`, `description`/`message`, `cwe_id`/`cwe`,
 *      `fix_suggestion`/`recommendation`) into a single canonical
 *      `ReviewFinding` shape.
 *   3. Merges findings across stages and deduplicates by
 *      `(file, line, cwe)` — keep the highest-confidence occurrence.
 *   4. Filters by severity threshold (`critical > high > medium > low`).
 *
 * Designed to be wired by `run.ts` after `runPipelineV2` returns. Agent B
 * owns `run.ts`; this module is self-contained so the wiring is a one-line
 * `formatFindings(result.outputs)` call when Agent B picks it up.
 */
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.EMPTY_FINDINGS_COUNT = void 0;
exports.isSeverity = isSeverity;
exports.isSeverityLevel = isSeverityLevel;
exports.severityRank = severityRank;
exports.readSeverityThresholdFromEnv = readSeverityThresholdFromEnv;
exports.formatFindings = formatFindings;
exports.formatFindingsWithStats = formatFindingsWithStats;
exports.normalizeFinding = normalizeFinding;
exports.dedupeFindings = dedupeFindings;
exports.filterBySeverity = filterBySeverity;
exports.countFindings = countFindings;
/** Empty counts — handy for tests and the no-findings path. */
exports.EMPTY_FINDINGS_COUNT = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
};
/** Severity ordering — higher number = more severe. */
const SEVERITY_RANK = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
};
const VALID_SEVERITIES = new Set([
    'critical',
    'high',
    'medium',
    'low',
]);
const VALID_SEVERITY_LEVELS = new Set([
    'critical',
    'high',
    'medium',
    'low',
    'all',
]);
/** True for any of the four severity labels. `'all'` is the sentinel. */
function isSeverity(value) {
    return typeof value === 'string' && VALID_SEVERITIES.has(value);
}
/** True for any of the four severity labels OR `'all'`. */
function isSeverityLevel(value) {
    return typeof value === 'string' && VALID_SEVERITY_LEVELS.has(value);
}
/** Severity rank — `undefined` ranks below `low` (treated as unknown). */
function severityRank(severity) {
    if (severity === undefined)
        return 0;
    if (isSeverity(severity))
        return SEVERITY_RANK[severity];
    return 0;
}
/**
 * Read the `severity_threshold` action input via the env var. Agent B owns
 * `src/inputs.ts` and the typed `ActionInputs` interface — to avoid coupling,
 * this module reads `process.env.INPUT_SEVERITY_THRESHOLD` directly.
 * Default = `'low'` for backward compatibility (the existing summary has
 * always shown all severities).
 */
function readSeverityThresholdFromEnv(env = process.env) {
    const raw = env['INPUT_SEVERITY_THRESHOLD'];
    if (!raw || raw.length === 0)
        return 'low';
    const normalized = raw.trim().toLowerCase();
    if (isSeverityLevel(normalized))
        return normalized;
    return 'low';
}
/**
 * Parse + merge + dedupe pipeline output into a flat `ReviewFinding[]`.
 *
 * Input shape: `Record<stage_id, string>` — the raw `result.outputs` from
 * `runPipelineV2`. Each string may be:
 *   - JSON object with `findings: ReviewFinding[]`
 *   - JSON array of findings
 *   - A single finding JSON object
 *   - Plain text (regex best-effort fallback)
 *
 * Unknown / malformed inputs are skipped silently — never thrown. We want
 * summary rendering to keep working even when a stage misbehaves.
 *
 * Findings that lacked `file` metadata (so `normalizeFinding` defaulted
 * to `stageId`) are dropped here so they never reach downstream steps
 * with a bogus path. The drop count is observable via
 * `formatFindingsWithStats`; this function preserves its old signature
 * for back-compat with v0.3.x callers and existing tests.
 */
function formatFindings(rawOutput) {
    return formatFindingsWithStats(rawOutput).findings;
}
/**
 * Same as `formatFindings` but also reports counts of findings dropped
 * because the LLM omitted required metadata. Use this from `run.ts` so
 * the action emits a `findings_skipped_no_metadata` output + a notice
 * when the LLM misbehaves — operators see the problem instead of just
 * "stage ran, returned 0 findings".
 */
function formatFindingsWithStats(rawOutput) {
    const emptyStats = () => ({ no_file: 0 });
    if (rawOutput === null || rawOutput === undefined) {
        return { findings: [], stats: emptyStats() };
    }
    if (typeof rawOutput !== 'object') {
        return { findings: [], stats: emptyStats() };
    }
    const stageOutputs = rawOutput;
    const merged = [];
    const stats = emptyStats();
    for (const [stageId, value] of Object.entries(stageOutputs)) {
        if (value === null || value === undefined)
            continue;
        const stageFindings = parseStageOutput(value, stageId);
        for (const f of stageFindings) {
            // Drop findings that have a `line` (so they pass the wrapper's
            // inline-comment filter) but no real `file` (defaulted to stageId).
            // Sending "analyze_style" as `path` to the GitHub PR comments API
            // returns 422 ("could not be resolved") and spams the Annotations
            // panel. Findings without `line` are safe to keep — the wrapper's
            // filter (`f.line !== undefined`) already excludes them from the
            // inline-comment API call, and they still surface in the summary.
            if (f.line !== undefined && f.file === stageId) {
                stats.no_file += 1;
                continue;
            }
            merged.push(f);
        }
    }
    return { findings: dedupeFindings(merged), stats };
}
/**
 * Parse a single stage's output value into findings. `stageId` is used as
 * the `file` fallback when the finding does not declare one (file-level
 * findings or regex-extracted text without a path).
 */
function parseStageOutput(value, stageId) {
    if (typeof value === 'string') {
        return parseStringStageOutput(value, stageId);
    }
    if (Array.isArray(value)) {
        return value
            .map((entry) => normalizeFinding(entry, stageId))
            .filter((f) => f !== null);
    }
    if (typeof value === 'object') {
        const obj = value;
        if (Array.isArray(obj['findings'])) {
            return obj['findings']
                .map((entry) => normalizeFinding(entry, stageId))
                .filter((f) => f !== null);
        }
        const normalized = normalizeFinding(obj, stageId);
        return normalized === null ? [] : [normalized];
    }
    return [];
}
/**
 * Try to parse the string as JSON. On failure, fall back to regex
 * best-effort extraction. The fallback is intentionally lossy — it catches
 * obvious "severity word + filename + optional line number" patterns.
 */
function parseStringStageOutput(raw, stageId) {
    const trimmed = raw.trim();
    if (trimmed.length === 0)
        return [];
    // 1) Try JSON.
    try {
        const parsed = JSON.parse(trimmed);
        return parseStageOutput(parsed, stageId);
    }
    catch {
        // not JSON — fall through to regex
    }
    // 2) Regex fallback — best-effort, documented as lossy.
    return extractFromText(trimmed, stageId);
}
/**
 * Regex fallback for plain-text outputs (rare in our wedges, but the
 * the `code-review-security-audit` wedge and the `gh api` error
 * envelopes occasionally produce text-only output).
 *
 * Patterns matched (case-insensitive):
 *   `critical|high|medium|low ... in <path>[:<line>]` — file/line attached
 *   `CWE-\d+` anywhere in the message line — captured as `cwe`
 *
 * Confidence is fixed at 0.5 for regex hits (lower than a structured parse
 * so the dedupe keeps the structured version when both exist).
 */
function extractFromText(text, stageId) {
    const findings = [];
    const lines = text.split(/\r?\n/);
    const sevRe = /\b(critical|high|medium|low)\b/i;
    const locRe = /(?:in|at)\s+([^\s:;,)]+)(?::(\d+))?/i;
    const cweRe = /CWE-\d+/i;
    for (const line of lines) {
        const sevMatch = line.match(sevRe);
        if (!sevMatch)
            continue;
        const sevRaw = sevMatch[1];
        if (!sevRaw || !isSeverity(sevRaw))
            continue;
        const locMatch = line.match(locRe);
        const file = locMatch?.[1] ?? '';
        const lineNumRaw = locMatch?.[2];
        const lineNum = lineNumRaw !== undefined ? Number.parseInt(lineNumRaw, 10) : NaN;
        const cweMatch = line.match(cweRe);
        const cwe = cweMatch?.[0];
        findings.push({
            severity: sevRaw,
            file: file.length > 0 ? file : stageId,
            ...(Number.isFinite(lineNum) ? { line: lineNum } : {}),
            message: line.trim().slice(0, 500),
            ...(cwe !== undefined ? { cwe } : {}),
            confidence: 0.5,
        });
    }
    return findings;
}
/**
 * Normalize a raw object into a `ReviewFinding`. Returns `null` when the
 * input lacks the required `message`/`description` field — we cannot emit
 * a finding with no description (every consumer expects a string).
 */
function normalizeFinding(raw, stageId) {
    if (raw === null || raw === undefined)
        return null;
    if (typeof raw !== 'object')
        return null;
    const obj = raw;
    const severityRaw = obj['severity'];
    if (!isSeverity(severityRaw))
        return null;
    const message = stringOr(obj['message']) ??
        stringOr(obj['description']) ??
        stringOr(obj['detail']) ??
        stringOr(obj['title']);
    if (message === null)
        return null;
    const file = stringOr(obj['file']) ??
        stringOr(obj['path']) ??
        stringOr(obj['location']) ??
        stageId;
    const lineRaw = obj['line'] ?? obj['line_number'] ?? obj['lineNumber'];
    let line;
    if (typeof lineRaw === 'number' && Number.isFinite(lineRaw) && lineRaw > 0) {
        line = Math.trunc(lineRaw);
    }
    const cweRaw = stringOr(obj['cwe']) ??
        stringOr(obj['cwe_id']) ??
        stringOr(obj['cweId']);
    let cwe;
    if (cweRaw !== null) {
        const normalized = cweRaw.match(/CWE-\d+/i)?.[0];
        if (normalized !== undefined)
            cwe = normalized.toUpperCase();
    }
    let confidence = 0;
    if (typeof obj['confidence'] === 'number' && Number.isFinite(obj['confidence'])) {
        confidence = clamp01(obj['confidence']);
    }
    const recommendation = stringOr(obj['recommendation']) ??
        stringOr(obj['fix_suggestion']) ??
        stringOr(obj['fix']) ??
        stringOr(obj['remediation']) ??
        undefined;
    const finding = {
        severity: severityRaw,
        file,
        ...(line !== undefined ? { line } : {}),
        message,
        confidence,
        ...(cwe !== undefined ? { cwe } : {}),
        ...(recommendation !== null && recommendation !== undefined
            ? { recommendation }
            : {}),
    };
    return finding;
}
function stringOr(value) {
    if (typeof value !== 'string')
        return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}
function clamp01(n) {
    if (n < 0)
        return 0;
    if (n > 1)
        return 1;
    return n;
}
/**
 * Dedupe findings by `(file, line, cwe)`. When two findings collide, keep
 * the one with the higher confidence; on ties, keep the first seen.
 */
function dedupeFindings(findings) {
    const byKey = new Map();
    for (const finding of findings) {
        const key = `${finding.file}::${finding.line ?? ''}::${finding.cwe ?? ''}`;
        const existing = byKey.get(key);
        if (existing === undefined || finding.confidence > existing.confidence) {
            byKey.set(key, finding);
        }
    }
    return Array.from(byKey.values());
}
/**
 * Filter findings to those with severity at or above `threshold`.
 *
 * Severity ordering: `critical > high > medium > low`. `'all'` includes
 * everything. Unknown thresholds fall back to `'low'` (backward-compatible
 * default — same as the existing pre-filter summary that listed all).
 */
function filterBySeverity(findings, threshold) {
    if (threshold === 'all')
        return [...findings];
    if (!isSeverity(threshold))
        return [...findings];
    const min = SEVERITY_RANK[threshold];
    return findings.filter((f) => SEVERITY_RANK[f.severity] >= min);
}
/**
 * Aggregate counts by severity. Useful for `findings_count_json` and the
 * step-summary table.
 */
function countFindings(findings) {
    const counts = { ...exports.EMPTY_FINDINGS_COUNT };
    for (const f of findings) {
        counts[f.severity] += 1;
    }
    return counts;
}


/***/ }),

/***/ 862:
/***/ (function(__unused_webpack_module, exports, __nccwpck_require__) {

"use strict";

/**
 * Pipeline source resolution: either from file (pipeline_file) or inline
 * string (pipeline_yaml). Mutual exclusion: exactly one source must be provided.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.PipelineSourceError = void 0;
exports.resolvePipelineSource = resolvePipelineSource;
const fs = __importStar(__nccwpck_require__(455));
class PipelineSourceError extends Error {
}
exports.PipelineSourceError = PipelineSourceError;
async function resolvePipelineSource(inputs) {
    const hasFile = !!inputs.pipeline_file;
    const hasInline = !!inputs.pipeline_yaml;
    if (hasFile === hasInline) {
        throw new PipelineSourceError('Exactly one of `pipeline_file` or `pipeline_yaml` must be provided (got both or neither).');
    }
    let pipeline_spec;
    let resolved_from;
    if (hasFile) {
        const filePath = inputs.pipeline_file;
        try {
            pipeline_spec = await fs.readFile(filePath, 'utf8');
        }
        catch (e) {
            throw new PipelineSourceError(`Cannot read pipeline_file=${filePath}: ${e.message}`);
        }
        resolved_from = 'file';
    }
    else {
        pipeline_spec = inputs.pipeline_yaml;
        resolved_from = 'inline';
    }
    const pipeline_inputs = parseInlineInputs(inputs.inputs_json);
    return {
        inputs,
        pipeline_spec,
        pipeline_inputs,
        resolved_from,
    };
}
function parseInlineInputs(raw) {
    if (!raw)
        return {};
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch (e) {
        throw new PipelineSourceError(`Invalid inputs_json: ${e.message}`);
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new PipelineSourceError('inputs_json must be a JSON object');
    }
    return parsed;
}


/***/ }),

/***/ 207:
/***/ ((__unused_webpack_module, exports, __nccwpck_require__) => {

"use strict";

/**
 * v0.3.3 — PR Review deduplication (TASKS row 102).
 *
 * Replaces the prior "Post PR comment" workflow that created a new issue
 * comment per pipeline run. On every push to the PR (i.e. every new commit),
 * the AI re-runs and would otherwise post N separate review comments —
 * accumulating noise in the PR timeline.
 *
 * Strategy: a single PR Review per commit, edited on subsequent runs by
 * anchor in the review body. We embed a hidden HTML comment marker
 * `<!-- ai-review-session:{commit_sha} -->` plus a JSON-encoded snapshot of
 * the findings inside the review body. On the next run we list existing
 * reviews, find the one carrying our marker, and either:
 *
 *   - update it via `octokit.rest.pulls.updateReview` (PATCH) when found, or
 *   - create a fresh one via `octokit.rest.pulls.createReview` when missing.
 *
 * We deliberately use the PR Review API (`pulls.createReview` /
 * `pulls.updateReview`) — NOT the issue-comment API (`issues.createComment`).
 * Review edits are bounded (a single mutable record), the review anchors to
 * a specific commit, and inline comments can ride along on creation. Issue
 * comments have no edit body in the dedup sense — every "create" is permanent.
 *
 * Inline comment dedup:
 *   - On CREATION: inline comments (one per finding with file + line) are
 *     passed in the `comments` payload, scoped to the review.
 *   - On UPDATE: the GitHub REST API does NOT allow changing inline comments
 *     via `updateReview` (only the body is mutable). The body summary in
 *     edit mode carries the NEW / RESOLVED / CHANGED-SEVERITY counts so the
 *     PR author can see diff state without scrolling inline comments. Inline
 *     comment dedup is tracked as v0.3.4 follow-up work.
 *
 * Marker format is part of the contract — changing it requires a major
 * version bump (existing reviews would be orphaned, treated as "no marker
 * found" and left in place).
 *
 * No external deps. Caller supplies the octokit client (typically from
 * `actions/github-script`'s pre-authenticated `github` global). Pure
 * module-level pure functions + one async I/O function (`postReview`).
 */
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.SESSION_MARKER_PREFIX = void 0;
exports.buildSessionMarker = buildSessionMarker;
exports.parseSessionMarker = parseSessionMarker;
exports.renderReviewBody = renderReviewBody;
exports.renderInlineCommentBody = renderInlineCommentBody;
exports.diffFindings = diffFindings;
exports.findingKey = findingKey;
exports.postReview = postReview;
exports.findExistingReview = findExistingReview;
exports.parseEmbeddedFindings = parseEmbeddedFindings;
exports.buildInlineComments = buildInlineComments;
exports.countBySeverity = countBySeverity;
const version_js_1 = __nccwpck_require__(918);
const output_formatter_js_1 = __nccwpck_require__(750);
// ---------------------------------------------------------------------------
// Session marker (contract — do not change without major version bump)
// ---------------------------------------------------------------------------
/**
 * HTML comment embedded in the review body. Anchors us to a specific
 * commit so subsequent runs (new push / re-run) can find the existing
 * review and PATCH it instead of POSTing a duplicate.
 *
 * GitHub's parser strips hidden HTML comments in PR review bodies for
 * rendering, so it never appears to humans. The leading/trailing whitespace
 * is intentional — `<!-- ... -->` with no surrounding content renders as
 * a true comment node, not as part of the visible Markdown.
 */
exports.SESSION_MARKER_PREFIX = '<!-- ai-review-session:';
/** Build the marker for a given commit SHA. */
function buildSessionMarker(commitSha) {
    return `${exports.SESSION_MARKER_PREFIX}${commitSha} -->`;
}
/**
 * Extract the commit SHA from a review body that contains our marker.
 *
 * Returns `null` when:
 *   - body is empty / missing,
 *   - the marker is absent (foreign review),
 *   - the marker is malformed (corrupted truncation, wrong SHA length, etc.).
 *
 * The malformed-fallback is load-bearing — TASKS row 102 demands a fresh
 * review in that case so we never silently overwrite a stranger's review.
 */
function parseSessionMarker(body) {
    if (typeof body !== 'string' || body.length === 0)
        return null;
    const match = body.match(/<!-- ai-review-session:([a-f0-9]+) -->/);
    if (!match || !match[1])
        return null;
    const sha = match[1];
    // GitHub SHAs are always 40 hex chars (SHA-1). Reject anything else
    // (12-char, 7-char, non-hex) as malformed — it's almost certainly
    // manual editing or a corrupted truncation.
    if (!/^[a-f0-9]{40}$/.test(sha))
        return null;
    return sha;
}
// ---------------------------------------------------------------------------
// Body rendering
// ---------------------------------------------------------------------------
/**
 * Render the review body — Markdown summary + JSON snapshot of findings
 * embedded after the marker so subsequent runs can compute a set-diff.
 *
 * The JSON snapshot is wrapped in a fenced code block; Markdown renders it
 * as a collapsible view in the GH PR UI. We keep it short and parseable.
 */
function renderReviewBody(opts) {
    const { commitSha, findings, failOn, diff } = opts;
    const counts = countBySeverity(findings);
    const status = computeBodyStatus(findings, failOn);
    const lines = [];
    lines.push(`## AI Code Review (agents-market pipeline-action v${version_js_1.ACTION_VERSION})`);
    lines.push('');
    lines.push(`**Status:** ${status.badge} ${status.label}`);
    lines.push(`**Findings:** ${findings.length} total · `
        + `🔴 ${counts.critical} critical · 🟠 ${counts.high} high · 🟡 ${counts.medium} medium · 🔵 ${counts.low} low`);
    lines.push(`**Commit:** \`${commitSha.slice(0, 12)}\``);
    if (diff) {
        lines.push('');
        lines.push(`**Diff vs. previous run on this PR:**`);
        lines.push(`- 🆕 ${diff.newFindings.length} new finding(s)`);
        lines.push(`- ✅ ${diff.resolvedFindings.length} resolved (no longer present)`);
        lines.push(`- 🔁 ${diff.changedSeverity.length} severity change(s)`);
    }
    lines.push('');
    lines.push(buildSessionMarker(commitSha));
    lines.push('');
    // Embedded snapshot — must be valid JSON, fenced so GH renders it as a
    // collapsible block instead of inline. Empty array serializes to `[]`.
    lines.push('```json');
    lines.push(JSON.stringify(findings));
    lines.push('```');
    return lines.join('\n');
}
/** Render a single inline-comment body for a finding. Stable, deterministic. */
function renderInlineCommentBody(f) {
    const emoji = severityEmoji(f.severity);
    const cwe = f.cwe ? ` \`${f.cwe}\`` : '';
    const conf = Math.round(f.confidence * 100);
    const head = `${emoji} **${f.severity.toUpperCase()}**${cwe} (conf ${conf}%): ${f.message}`;
    if (f.recommendation && f.recommendation.length > 0) {
        return `${head}\n\n💡 ${f.recommendation}`;
    }
    return head;
}
/**
 * Compute the set-diff between two finding arrays. Identity key is
 * `(file, line, cwe, message)` — same key across runs with different
 * severity registers as a severity change (not new + resolved).
 *
 * Order in the output:
 *   - `newFindings`     — in input order of `next`.
 *   - `resolvedFindings` — in input order of `prev`.
 *   - `changedSeverity` — in input order of `next`.
 */
function diffFindings(prev, next) {
    const prevByKey = new Map();
    const nextByKey = new Map();
    for (const f of prev)
        prevByKey.set(findingKey(f), f);
    for (const f of next)
        nextByKey.set(findingKey(f), f);
    const newFindings = [];
    const resolvedFindings = [];
    const changedSeverity = [];
    let unchanged = 0;
    for (const [key, nextF] of nextByKey.entries()) {
        const prevF = prevByKey.get(key);
        if (prevF === undefined) {
            newFindings.push(nextF);
            continue;
        }
        if (prevF.severity !== nextF.severity) {
            changedSeverity.push({ before: prevF, after: nextF });
        }
        else {
            unchanged += 1;
        }
    }
    for (const [key, prevF] of prevByKey.entries()) {
        if (!nextByKey.has(key)) {
            resolvedFindings.push(prevF);
        }
    }
    return { newFindings, resolvedFindings, changedSeverity, unchanged };
}
/** Stable identity key for a finding — used by `diffFindings`. */
function findingKey(f) {
    return [
        f.file,
        f.line !== undefined ? String(f.line) : '',
        f.cwe ?? '',
        f.message,
    ].join('::');
}
// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------
/**
 * Idempotent: posts a new review when no existing review carries our
 * session marker, otherwise edits the matching review (PATCH). The
 * resulting `review_id` is stable across runs and suitable for downstream
 * correlation (e.g. analytics, test assertions).
 *
 * When `findings` is empty AND no existing review is found, this STILL
 * posts a fresh "no issues found" review — preserves a single-record-per-PR
 * contract. Returns `{ action: 'created' }` so the caller can distinguish.
 *
 * Implementation contract:
 *   - Always uses `octokit.rest.pulls.{createReview,updateReview}` —
 *     never `issues.createComment`.
 *   - Never silently overwrites a stranger's review: parse failures fall
 *     through to fresh-create (test 3 covers this).
 *   - Reads first page only (`per_page: 100`). For PRs with >100 prior
 *     reviews (unusual for AI reviews), fallback path is fresh-create.
 *     Documented as a v0.3.4 follow-up if it ever bites.
 */
async function postReview(opts) {
    const { octokit, owner, repo, pull_number, commit_sha, findings, fail_on, } = opts;
    // 1. List existing reviews on the PR. First page only — covers >99% of
    //    realistic usage. Marker search runs over the returned array; on hit
    //    we short-circuit (no second API call).
    const reviewsResponse = await octokit.rest.pulls.listReviews({
        owner,
        repo,
        pull_number,
        per_page: 100,
    });
    const existingReview = findExistingReview(reviewsResponse.data);
    if (existingReview !== null) {
        // 2. EDIT path — updateReview. Embed the new findings as JSON and
        //    stamp the marker with the current commit SHA. The body diff is
        //    computed against the previous embedded snapshot.
        const previousSnapshot = parseEmbeddedFindings(existingReview.body);
        const diff = diffFindings(previousSnapshot, [...findings]);
        const newBody = renderReviewBody({
            commitSha: commit_sha,
            findings,
            failOn: fail_on,
            diff,
        });
        await octokit.rest.pulls.updateReview({
            owner,
            repo,
            pull_number,
            review_id: existingReview.id,
            body: newBody,
        });
        return {
            review_id: existingReview.id,
            action: 'updated',
            marker_sha: commit_sha,
        };
    }
    // 3. CREATE path — fresh review with inline comments for every finding
    //    that has a (file, line) location. We do NOT rely on the runtime
    //    deduping for inline comments in v0.3.3 — body-level dedup is the
    //    primary mechanism. Inline comments stay with the original review
    //    until the next CREATE (i.e. when the marker is gone, e.g. user
    //    resolved the thread manually).
    const inlineComments = buildInlineComments(findings);
    const body = renderReviewBody({
        commitSha: commit_sha,
        findings,
        failOn: fail_on,
    });
    const created = await octokit.rest.pulls.createReview({
        owner,
        repo,
        pull_number,
        commit_id: commit_sha,
        event: 'COMMENT',
        body,
        ...(inlineComments.length > 0 ? { comments: inlineComments } : {}),
    });
    return {
        review_id: created.data.id,
        action: 'created',
        marker_sha: commit_sha,
    };
}
// ---------------------------------------------------------------------------
// Internal helpers (exported for tests; not part of the public API surface)
// ---------------------------------------------------------------------------
/**
 * Locate the existing PR review carrying our session marker.
 *
 * Returns `null` when no review carries a parseable marker. Foreign reviews
 * (no marker) are ignored — never edited, never replaced. If multiple
 * reviews carry the marker (defensive — should not happen in practice),
 * the most recent one wins (last in the listing, which is newest-first
 * per GitHub's `listReviews` ordering).
 */
function findExistingReview(reviews) {
    // Iterate from the end — GitHub returns reviews newest-first. The most
    // recent match wins if duplicates somehow accumulated.
    for (let i = reviews.length - 1; i >= 0; i--) {
        const r = reviews[i];
        if (r === undefined)
            continue;
        const sha = parseSessionMarker(r.body);
        if (sha !== null)
            return r;
    }
    return null;
}
/**
 * Parse the embedded ` ```json ... ``` ` findings snapshot out of a review
 * body. Returns `[]` on parse failure — never throws. Caller treats empty
 * as "previous run had no findings" (so the next diff will report every
 * current finding as `new`).
 */
function parseEmbeddedFindings(body) {
    if (typeof body !== 'string' || body.length === 0)
        return [];
    // The fenced block is always rendered last by `renderReviewBody`.
    const match = body.match(/```json\n([\s\S]*?)\n```/);
    if (!match || !match[1])
        return [];
    try {
        const parsed = JSON.parse(match[1]);
        if (!Array.isArray(parsed))
            return [];
        const out = [];
        for (const entry of parsed) {
            if (!entry || typeof entry !== 'object')
                continue;
            const obj = entry;
            // Defensive normalization — we don't trust our own persisted JSON
            // blindly (handles a future case where the schema drifts).
            const severity = obj['severity'];
            const message = obj['message'];
            if (!(0, output_formatter_js_1.isSeverity)(severity) || typeof message !== 'string')
                continue;
            const finding = {
                severity,
                message,
                file: typeof obj['file'] === 'string' ? obj['file'] : '',
                confidence: typeof obj['confidence'] === 'number' && Number.isFinite(obj['confidence'])
                    ? obj['confidence']
                    : 0,
            };
            if (typeof obj['line'] === 'number' && Number.isFinite(obj['line'])) {
                finding.line = Math.trunc(obj['line']);
            }
            if (typeof obj['cwe'] === 'string')
                finding.cwe = obj['cwe'];
            if (typeof obj['recommendation'] === 'string') {
                finding.recommendation = obj['recommendation'];
            }
            out.push(finding);
        }
        return out;
    }
    catch {
        return [];
    }
}
/** Build the inline-comment array for `createReview`. Filters to findings with locations. */
function buildInlineComments(findings) {
    const out = [];
    for (const f of findings) {
        if (typeof f.line !== 'number' || f.file.length === 0)
            continue;
        out.push({
            path: f.file,
            line: f.line,
            body: renderInlineCommentBody(f),
        });
    }
    return out;
}
// ---------------------------------------------------------------------------
// Tiny pure helpers (also exported for tests)
// ---------------------------------------------------------------------------
/** Per-severity aggregate count, in `{ critical, high, medium, low }` order. */
function countBySeverity(findings) {
    const out = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const f of findings) {
        out[f.severity] += 1;
    }
    return out;
}
/**
 * Mirrors `computeStatus` from `status-check.ts` but kept inline to avoid
 * a circular import (this module is consumed by the workflow, which may
 * not have wired up `status-check.ts`). Logic identical to the action's
 * canonical status computation.
 */
function computeBodyStatus(findings, failOn) {
    const threshold = (0, output_formatter_js_1.isSeverity)(failOn) ? failOn : 'critical';
    const minRank = (0, output_formatter_js_1.severityRank)(threshold);
    for (const f of findings) {
        if ((0, output_formatter_js_1.severityRank)(f.severity) >= minRank) {
            return { badge: '❌', label: 'failed' };
        }
    }
    return { badge: '✅', label: 'passed' };
}
function severityEmoji(s) {
    switch (s) {
        case 'critical': return '🔴';
        case 'high': return '🟠';
        case 'medium': return '🟡';
        case 'low': return '🔵';
    }
}


/***/ }),

/***/ 464:
/***/ ((__unused_webpack_module, exports) => {

"use strict";

/**
 * v0.3.0 — Exponential backoff retry for LLM provider calls.
 *
 * Retries ONLY on transient errors:
 *   - 429 (rate limit, including the Anthropic `Token Plan usage limit reached` literal)
 *   - HTTP 5xx (server errors)
 *   - SDK errors whose class name includes `RateLimit` (Anthropic SDK, OpenAI SDK, etc.)
 *
 * Does NOT retry on:
 *   - 4xx other than 429 (bad request, auth, etc. — caller bug, retrying wastes money)
 *   - Auth errors (401/403) — fix the key, don't retry
 *   - Validation errors — fix the pipeline, don't retry
 *
 * Backoff formula: `min(baseDelayMs * 2^attempt, maxDelayMs)` with optional ±20% jitter.
 * Attempt numbering starts at 0 for the first retry (so 3 retries = attempt 0, 1, 2).
 *
 * No `as any` / `@ts-ignore` — fully typed.
 */
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.RetryExhaustedError = void 0;
exports.defaultRetryable = defaultRetryable;
exports.computeBackoffMs = computeBackoffMs;
exports.withRetry = withRetry;
class RetryExhaustedError extends Error {
    attempts;
    lastError;
    constructor(attempts, lastError) {
        const msg = lastError instanceof Error ? lastError.message : String(lastError);
        super(`Retry exhausted after ${attempts} attempts — last error: ${msg}`);
        this.name = 'RETRY_EXHAUSTED';
        this.attempts = attempts;
        this.lastError = lastError;
    }
}
exports.RetryExhaustedError = RetryExhaustedError;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 1000;
const DEFAULT_MAX_DELAY_MS = 30_000;
const DEFAULT_JITTER = true;
function defaultRetryable(e) {
    if (e === null || e === undefined)
        return false;
    const err = e;
    const status = err.status ?? err.statusCode;
    if (typeof status === 'number') {
        if (status === 429)
            return true;
        if (status >= 500 && status <= 599)
            return true;
        return false;
    }
    if (typeof err.name === 'string' && err.name.toLowerCase().includes('ratelimit'))
        return true;
    if (typeof err.code === 'string' && err.code.toLowerCase().includes('ratelimit'))
        return true;
    if (typeof err.message === 'string') {
        const lower = err.message.toLowerCase();
        if (lower.includes('429'))
            return true;
        if (lower.includes('token plan usage limit reached'))
            return true;
        if (lower.includes('rate limit'))
            return true;
    }
    return false;
}
function computeBackoffMs(attempt, baseDelayMs, maxDelayMs, jitter) {
    if (attempt < 0)
        attempt = 0;
    const base = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
    if (!jitter)
        return base;
    const jitterRange = base * 0.2;
    const offset = (Math.random() * 2 - 1) * jitterRange;
    return Math.max(0, Math.round(base + offset));
}
async function withRetry(fn, opts = {}) {
    const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
    const baseDelayMs = opts.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
    const maxDelayMs = opts.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
    const jitter = opts.jitter ?? DEFAULT_JITTER;
    const isRetryable = opts.retryableErrors ?? defaultRetryable;
    const onRetry = opts.onRetry;
    const sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    let attempt = 0;
    while (true) {
        try {
            return await fn();
        }
        catch (e) {
            if (attempt >= maxRetries || !isRetryable(e)) {
                if (attempt >= maxRetries && isRetryable(e)) {
                    throw new RetryExhaustedError(attempt + 1, e);
                }
                throw e;
            }
            const delayMs = computeBackoffMs(attempt, baseDelayMs, maxDelayMs, jitter);
            if (onRetry) {
                onRetry({
                    attempt,
                    maxRetries,
                    delayMs,
                    errorMessage: e instanceof Error ? e.message : String(e),
                    errorName: e instanceof Error && e.name ? e.name : 'Error',
                });
            }
            await sleep(delayMs);
            attempt += 1;
        }
    }
}


/***/ }),

/***/ 795:
/***/ ((__unused_webpack_module, exports, __nccwpck_require__) => {

"use strict";

/**
 * Action run lifecycle: load + validate pipeline, resolve env vars, invoke
 * runPipelineV2 with stage hooks (each stage becomes a GH log group), then
 * write outputs:
 *   - result_json   — JSON.stringify of stage outputs
 *   - total_ms      — wall-clock duration
 *   - total_cost_usdc — USDC with 6 decimals
 *   - cost_usdc     — v0.3.2: machine-readable USDC cost (same value as total_cost_usdc;
 *                     the new name standardizes on the convention used by the MiniMax
 *                     x402 micropayment pipeline).
 *   - timing_json   — v0.3.2: per-stage wall-clock (validate / fetch_source /
 *                     run_pipeline / format_output), JSON object of integer ms.
 *   - findings_sarif — v0.4.0: SARIF 2.1.0 JSON for findings (only emitted when
 *                     `output_format='sarif'`); upload to GitHub Code Scanning
 *                     via `github/codeql-action/upload-sarif@v3`.
 *   - stage_count   — number of stages in spec
 *   - webhook_status — v0.3.4: sent | skipped | failed (after notify()).
 * Per-stage:
 *   - stage_<id>_ms
 *   - stage_<id>_output
 *
 * Exit codes:
 *   0 — success (skipped stages OK; no failures)
 *   1 — pipeline validation/runtime error
 */
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.ACTION_VERSION = void 0;
exports.run = run;
const pipeline_runtime_1 = __nccwpck_require__(706);
const streaming_js_1 = __nccwpck_require__(834);
const inputs_js_1 = __nccwpck_require__(601);
const retry_js_1 = __nccwpck_require__(464);
const source_cache_js_1 = __nccwpck_require__(682);
const output_formatter_js_1 = __nccwpck_require__(750);
const status_check_js_1 = __nccwpck_require__(39);
const cost_js_1 = __nccwpck_require__(609);
const execution_mode_js_1 = __nccwpck_require__(2);
const server_run_js_1 = __nccwpck_require__(819);
const timing_js_1 = __nccwpck_require__(558);
const fallback_js_1 = __nccwpck_require__(122);
const notifier_js_1 = __nccwpck_require__(690);
const sarif_js_1 = __nccwpck_require__(157);
const version_js_1 = __nccwpck_require__(918);
Object.defineProperty(exports, "ACTION_VERSION", ({ enumerable: true, get: function () { return version_js_1.ACTION_VERSION; } }));
async function run(args) {
    const { params, deps } = args;
    const inputs = params.inputs;
    // v0.3.2 — per-stage wall-clock accumulator. Survives the whole run() so
    // every stage can call start()/end() and the final `timing_json` output
    // captures the full pipeline lifecycle. Stages never started default to
    // 0 in the JSON output, so partial instrumentation stays schema-stable.
    const timings = new timing_js_1.Timings();
    timings.start('fetch_source');
    // Source cache (v0.3.0): when the pipeline came from a file, warm the
    // per-job cache so re-runs within the same GH Actions job (matrix
    // builds, multiple steps) skip the disk read. The fetcher returns the
    // already-loaded content — no extra disk hit on a cold cache.
    if (params.resolved_from === 'file' && inputs.pipeline_file) {
        const cached = await (0, source_cache_js_1.getCachedPipelineSource)(inputs.pipeline_file, async () => params.pipeline_spec);
        (0, streaming_js_1.notice)(cached.cacheHit
            ? `↻ pipeline source cache hit: ${inputs.pipeline_file}`
            : `↓ pipeline source cache populated: ${inputs.pipeline_file} (${cached.size} bytes)`);
    }
    timings.end('fetch_source');
    timings.start('validate');
    let resolvedSpec;
    try {
        resolvedSpec = (0, pipeline_runtime_1.expandPipelineText)(params.pipeline_spec, buildPipelineEnv(inputs));
    }
    catch (e) {
        timings.end('validate');
        (0, streaming_js_1.error)(`✗ ${e.message}`);
        return 1;
    }
    let loaded;
    try {
        loaded = (0, pipeline_runtime_1.loadPipelineYaml)(resolvedSpec);
    }
    catch (e) {
        timings.end('validate');
        (0, streaming_js_1.error)(`✗ Invalid pipeline YAML (after env-var expansion): ${e.message}`);
        return 1;
    }
    const spec = loaded;
    if (!spec || !Array.isArray(spec.stages)) {
        timings.end('validate');
        (0, streaming_js_1.error)('✗ Spec top-level must be an object with a `stages` array.');
        return 1;
    }
    timings.end('validate');
    const stageCount = spec.stages.length;
    const pipelineName = spec.name ?? 'unnamed';
    const providerTag = `[provider=${inputs.provider} model=${inputs.model} context=${inputs.context_mode}]`;
    (0, streaming_js_1.notice)(`▶ pipeline-action v${version_js_1.ACTION_VERSION} — ${pipelineName} (${stageCount} stage${stageCount === 1 ? '' : 's'}) ${providerTag}`);
    // The stage goes to the runtime WHOLE. The copy used to be a whitelist of
    // fourteen fields, and everything it did not name was dropped: the
    // `output_schema` (so the schema was never checked on the runner, while
    // the marketplace checked it), `output_retry`, `when`, `loop`, `retry`,
    // `maxTokens`, `model_params`, `depends_on`, `inputs`. A local run was
    // therefore a different, laxer pipeline than the paid one — green here,
    // OUTPUT_VALIDATION_FAILED there.
    const stagesForRuntime = spec.stages.map((s) => ({
        ...s,
    }));
    const startedAt = Date.now();
    let result;
    // Who pays decides who runs. Until now the answer was always "this runner",
    // which meant a workflow that installed a marketplace pipeline never called the
    // invoke route and the pipeline's author was paid nothing.
    const marketplaceKey = inputs.agent_key;
    const providerKey = (0, inputs_js_1.resolveApiKeyForProvider)(inputs.api_key, inputs.primary_provider);
    const mode = (0, execution_mode_js_1.decideExecutionMode)({
        marketplaceKey,
        providerKey,
        mock: inputs.mock,
    });
    if (mode.mode === null) {
        timings.end('validate');
        (0, streaming_js_1.error)(`✗ ${mode.error}`);
        return 1;
    }
    (0, streaming_js_1.notice)(`  execution: ${mode.mode} — ${mode.reason}`);
    // A `shell:` stage runs an author-chosen command on this runner. Consent is
    // the buyer's, checked before anything executes, and never available on the
    // marketplace path where the server is the host.
    const shellConsent = (0, execution_mode_js_1.checkShellConsent)({
        mode: mode.mode,
        pipelineName,
        allowShell: inputs.allow_shell,
        stages: spec.stages,
        normalizeShell: pipeline_runtime_1.normalizeShellStage,
    });
    if ('error' in shellConsent) {
        (0, streaming_js_1.error)(`✗ ${shellConsent.error}`);
        return 1;
    }
    // ---- Stage 3/4: run_pipeline ----
    timings.start('run_pipeline');
    if (mode.mode === 'server') {
        const target = (0, execution_mode_js_1.resolveServerSlug)(inputs.pipeline, spec.name);
        if ('error' in target) {
            timings.end('run_pipeline');
            (0, streaming_js_1.error)(`✗ ${target.error}`);
            return 1;
        }
        try {
            const run = await (0, server_run_js_1.runOnMarketplace)({
                slug: target.slug,
                inputs: params.pipeline_inputs,
                privateKey: marketplaceKey,
                notice: streaming_js_1.notice,
            });
            (0, streaming_js_1.notice)(`  run_id ${run.runId ?? '?'} · charged $${(run.totalCostMicroUsdc / 1e6).toFixed(6)}`);
            // The local path emits these from the stage hook. Server runs have no hook,
            // and a consumer reading `stage_<id>_output` would silently get nothing.
            for (const stage of run.stageTimings) {
                (0, streaming_js_1.writeOutput)(`stage_${stage.id}_ms`, String(stage.ms));
                if (run.outputs[stage.id] !== undefined) {
                    (0, streaming_js_1.writeOutput)(`stage_${stage.id}_output`, String(run.outputs[stage.id]));
                }
                (0, streaming_js_1.notice)(`✓ stage ${stage.id} completed in ${stage.ms}ms`);
            }
            result = {
                outputs: run.outputs,
                stageTimings: run.stageTimings.map(s => ({
                    id: s.id, ms: s.ms, costMicroUsdc: s.costMicroUsdc, model: s.model,
                })),
                totalCostMicroUsdc: run.totalCostMicroUsdc,
            };
        }
        catch (e) {
            timings.end('run_pipeline');
            (0, streaming_js_1.error)(`✗ marketplace run failed: ${e.message}`);
            return 1;
        }
        timings.end('run_pipeline');
    }
    else {
        // The declared defaults of the spec's inputs, for the inputs the consumer
        // did not pass. Without this merge a stage reading `provider: ${input.provider}`
        // got the LITERAL text and died with "Provider '${input.provider}' is not
        // registered" — the rollback that killed the review of every consumer with
        // one secret. The CLI and the server merge the same way (one helper, in
        // pipeline-runtime), and the marketplace path is left alone: there the
        // server merges.
        const pipelineInputs = (0, pipeline_runtime_1.applyInputDefaults)(params.pipeline_inputs, spec.inputs);
        try {
            result = await (0, retry_js_1.withRetry)(() => (0, pipeline_runtime_1.runPipelineV2)({
                spec: { stages: stagesForRuntime },
                inputs: pipelineInputs,
                deps,
                hooks: {
                    onStageStart: (stageId) => {
                        (0, streaming_js_1.group)(`▶ stage: ${stageId}`, () => {
                            (0, streaming_js_1.notice)(`started at ${new Date().toISOString()}`);
                        });
                    },
                    onStageComplete: (stageId, ms, output) => {
                        (0, streaming_js_1.writeOutput)(`stage_${stageId}_ms`, String(ms));
                        (0, streaming_js_1.writeOutput)(`stage_${stageId}_output`, output);
                        (0, streaming_js_1.notice)(`✓ stage ${stageId} completed in ${ms}ms (${output.length} chars)`);
                    },
                },
            }), {
                maxRetries: 3,
                baseDelayMs: 1000,
                maxDelayMs: 30_000,
                jitter: true,
                onRetry: (info) => {
                    (0, streaming_js_1.notice)(`↻ retry ${info.attempt + 1}/${info.maxRetries} after ${info.delayMs}ms ` +
                        `(${info.errorName}: ${info.errorMessage})`);
                },
            });
        }
        catch (e) {
            timings.end('run_pipeline');
            (0, streaming_js_1.error)(`✗ pipeline failed ${providerTag}: ${e.message}`);
            return 1;
        }
        timings.end('run_pipeline');
    }
    const totalMs = Date.now() - startedAt;
    // v0.4.0 — when fallback fires, the runtime prices against the stage's
    // declared model while actual tokens came from the fallback provider.
    // Trust the wrapper's accumulators over `result.totalCostMicroUsdc`.
    // In server mode there is no local provider and no fallback: the marketplace
    // picked the model. Reading the local wrapper would report zeros.
    const fallback = mode.mode === 'server' || !(deps.provider instanceof fallback_js_1.FallbackProvider)
        ? null
        : deps.provider;
    const providerUsed = fallback ? (fallback.lastProviderUsed ?? 'primary') : 'primary';
    const costPrimaryMicroUsdc = fallback ? fallback.cost_primary_micro_usdc : 0;
    const costFallbackMicroUsdc = fallback ? fallback.cost_fallback_micro_usdc : 0;
    const primaryErrorMessage = fallback?.lastPrimaryError?.message ?? '';
    const fallbackActiveMicro = costPrimaryMicroUsdc + costFallbackMicroUsdc;
    const effectiveTotalMicroUsdc = fallback !== null && (fallback.callCount > 0 || fallbackActiveMicro > 0)
        ? fallbackActiveMicro
        : result.totalCostMicroUsdc;
    // v0.3.2 — cost computation via the extracted pure function. The
    // multiplier is the documented 1x/3x/10x/100x from CONTEXT_MODE_MULTIPLIERS;
    // currently a no-op at 1.0 because the runtime already accounts for
    // context fetching. Threaded through for forward compatibility.
    // The context multiplier prices the extra tokens this action asks the model to
    // read on a local run. On the marketplace path the server already billed the
    // real tokens and took the real tokens; multiplying a settled invoice by 3 or
    // 100 would report a cost nobody was charged. 1x here means "what the server
    // charged", which is the truth on that path.
    const costMultiplier = mode.mode === 'server'
        ? 1
        : cost_js_1.CONTEXT_MODE_MULTIPLIERS[inputs.context_mode];
    const totalCostUsdc = (0, cost_js_1.computeCostInUsdc)(effectiveTotalMicroUsdc, costMultiplier);
    // ---- Stage 4/4: format_output ----
    timings.start('format_output');
    const { findings, stats: formatStats } = (0, output_formatter_js_1.formatFindingsWithStats)(result.outputs);
    const severityThreshold = (0, output_formatter_js_1.readSeverityThresholdFromEnv)();
    const filteredFindings = (0, output_formatter_js_1.filterBySeverity)(findings, severityThreshold);
    const findingsCount = (0, output_formatter_js_1.countFindings)(findings);
    const failOn = (0, status_check_js_1.readFailOnFromEnv)();
    const statusResult = (0, status_check_js_1.computeStatus)(findings, failOn);
    (0, streaming_js_1.writeOutput)('findings_json', JSON.stringify(findings));
    (0, streaming_js_1.writeOutput)('summary_only_findings_json', JSON.stringify(filteredFindings));
    (0, streaming_js_1.writeOutput)('findings_count_json', JSON.stringify(findingsCount));
    (0, streaming_js_1.writeOutput)('findings_skipped_no_metadata', String(formatStats.no_file));
    if (formatStats.no_file > 0) {
        (0, streaming_js_1.notice)(`⚠ ${formatStats.no_file} finding(s) dropped: no real \`file\` field ` +
            '(LLM emitted region/line_range instead of file/line). Update the ' +
            'stage prompt to require `"file": "<exact filename>"` so downstream ' +
            'steps (inline comments, SARIF) can locate the issue. See TASKS row 113.');
    }
    (0, streaming_js_1.writeOutput)('status', statusResult.status);
    (0, streaming_js_1.writeOutput)('failed_count', String(statusResult.failed_count));
    (0, streaming_js_1.writeOutput)('max_severity', statusResult.max_severity ?? '');
    // v0.4.0 — optional SARIF output (TASKS row 106). Additive: the summary
    // outputs above ALWAYS fire regardless of `output_format`, so v0.3.x
    // consumers see no change unless they opt in. SARIF is built from the
    // same `findings` array as `findings_json` to guarantee consistency.
    if (inputs.output_format === 'sarif') {
        const sarifContext = buildSarifContext();
        const sarifLog = (0, sarif_js_1.formatFindingsAsSarif)(findings, sarifContext);
        (0, streaming_js_1.writeOutput)('findings_sarif', JSON.stringify(sarifLog));
    }
    (0, streaming_js_1.writeActionSummary)({
        pipelineName,
        provider: inputs.provider,
        model: inputs.model,
        stageCount,
        totalMs,
        totalCostUsdc,
        outputs: result.outputs,
        findingsCount,
        filteredFindings,
        status: statusResult,
    });
    (0, streaming_js_1.writeOutput)('result_json', JSON.stringify(result.outputs));
    (0, streaming_js_1.writeOutput)('total_ms', String(totalMs));
    (0, streaming_js_1.writeOutput)('total_cost_usdc', totalCostUsdc.toFixed(6));
    (0, streaming_js_1.writeOutput)('stage_count', String(stageCount));
    // v0.3.2 — machine-readable outputs for dashboards / billing / runaway-PR detection.
    // `cost_usdc` matches the value of `total_cost_usdc` (kept for back-compat); the new
    // name standardizes on the convention used by the MiniMax x402 micropayment pipeline.
    (0, streaming_js_1.writeOutput)('cost_usdc', totalCostUsdc.toFixed(6));
    (0, streaming_js_1.writeOutput)('timing_json', timings.toJSONString());
    timings.end('format_output');
    // v0.4.0 — provider-fallback observability. Always written so the consumer
    // can read `provider_used='primary'` regardless of whether the fallback
    // wrapper was active or skipped.
    (0, streaming_js_1.writeOutput)('provider_used', providerUsed);
    (0, streaming_js_1.writeOutput)('cost_primary_usdc', (costPrimaryMicroUsdc / 1_000_000).toFixed(6));
    (0, streaming_js_1.writeOutput)('cost_fallback_usdc', (costFallbackMicroUsdc / 1_000_000).toFixed(6));
    (0, streaming_js_1.writeOutput)('provider_primary_error', primaryErrorMessage);
    if (fallback && fallback.fallbackCallCount > 0) {
        (0, streaming_js_1.notice)(`↻ provider fallback fired ${fallback.fallbackCallCount}/${fallback.callCount} ` +
            `calls (primary → fallback due to '${fallback.fallbackOnError}' error class)`);
    }
    // v0.3.2 — bonus auto-suggestion per TASKS row 110: if the LLM call itself
    // dominates the wall-clock and the user picked an expensive context mode,
    // suggest a cheaper mode for the next run. Skipped when run_pipeline_ms
    // is missing (stage never recorded) or the mode is already `diff`.
    const runPipelineMs = timings.toJSON().run_pipeline_ms;
    if (runPipelineMs > 5000 && inputs.context_mode !== 'diff') {
        (0, streaming_js_1.notice)(`⚡ run_pipeline_ms=${runPipelineMs} > 5000 with context_mode='${inputs.context_mode}' ` +
            `— consider 'diff' (1x cost) for faster iterations.`);
    }
    // v0.3.4 — webhook notification (Slack / Discord / Teams). Failures are
    // non-fatal: the pipeline result is unaffected, `webhook_status` output
    // captures the outcome (`sent` / `skipped` / `failed`).
    const prContext = readPullRequestContextFromEnv();
    const webhookResult = await (0, notifier_js_1.notify)({
        url: inputs.webhook_url ?? '',
        format: inputs.webhook_format,
        findings,
        summary: {
            status: statusResult.status,
            counts: findingsCount,
            max_severity: statusResult.max_severity ?? null,
            total_ms: totalMs,
            total_cost_usdc: totalCostUsdc.toFixed(6),
        },
        prContext,
    });
    (0, streaming_js_1.writeOutput)('webhook_status', webhookResult.status);
    if (webhookResult.status === 'failed') {
        const detail = webhookResult.http_status !== undefined
            ? `HTTP ${webhookResult.http_status} — ${webhookResult.error ?? 'unknown error'}`
            : (webhookResult.error ?? 'unknown error');
        (0, streaming_js_1.notice)(`⚠ webhook notification failed: ${detail}`);
    }
    else if (webhookResult.status === 'sent') {
        (0, streaming_js_1.notice)(`✓ webhook notification sent (HTTP ${webhookResult.http_status ?? '?'})`);
    }
    (0, streaming_js_1.notice)(`✓ pipeline complete: ${stageCount} stages, ${totalMs}ms, ~$${totalCostUsdc.toFixed(6)} USDC`);
    return 0;
}
function buildPipelineEnv(inputs) {
    const env = { ...process.env };
    if (inputs.api_key)
        env[inputs_js_1.PROVIDER_ENV_VARS[inputs.provider]] = inputs.api_key;
    env.AGENTSMARKET_PROVIDER = inputs.provider;
    env.AGENTSMARKET_DEFAULT_MODEL = inputs.model;
    if (inputs.mock)
        env.AGENTSMARKET_MOCK = 'true';
    return env;
}
/**
 * Resolve the PR context from GitHub Actions env vars + the event payload
 * on disk (`$GITHUB_EVENT_PATH`). Returns empty fields when the run is
 * not associated with a pull_request event — webhook payloads gracefully
 * omit the PR section in that case.
 */
function readPullRequestContextFromEnv(env = process.env) {
    const repository = env['GITHUB_REPOSITORY'] ?? '';
    const [owner, repo] = repository.split('/');
    const eventPath = env['GITHUB_EVENT_PATH'];
    if (!eventPath) {
        return { owner: owner ?? '', repo: repo ?? '', pull_number: 0, url: '' };
    }
    try {
        const fs = __nccwpck_require__(24);
        const raw = fs.readFileSync(eventPath, 'utf8');
        const parsed = JSON.parse(raw);
        const eventName = env['GITHUB_EVENT_NAME'] ?? '';
        if (eventName !== 'pull_request') {
            return { owner: owner ?? '', repo: repo ?? '', pull_number: 0, url: '' };
        }
        const pr = parsed['pull_request'];
        if (pr === undefined || pr === null) {
            return { owner: owner ?? '', repo: repo ?? '', pull_number: 0, url: '' };
        }
        const url = typeof pr['html_url'] === 'string' ? pr['html_url'] : '';
        const numberRaw = pr['number'];
        const pullNumber = typeof numberRaw === 'number' && Number.isFinite(numberRaw)
            ? Math.trunc(numberRaw)
            : 0;
        return {
            owner: owner ?? '',
            repo: repo ?? '',
            pull_number: pullNumber,
            url,
        };
    }
    catch {
        return { owner: owner ?? '', repo: repo ?? '', pull_number: 0, url: '' };
    }
}
/**
 * Resolve repo + commit_sha + branch from the GitHub Actions runtime env
 * so the SARIF `versionControlProvenance` block is populated when the run
 * is invoked from a `pull_request` event. Empty strings fall through and
 * `formatFindingsAsSarif` skips the provenance block — Code Scanning still
 * accepts SARIF without provenance, but anchors to a commit when present.
 */
function buildSarifContext() {
    const repo = process.env['GITHUB_REPOSITORY'] ?? '';
    const commitSha = process.env['GITHUB_SHA'] ?? process.env['COMMIT_SHA'] ?? '';
    const ref = process.env['GITHUB_REF'] ?? '';
    const branch = ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : '';
    return { repo, commit_sha: commitSha, ...(branch.length > 0 ? { branch } : {}) };
}


/***/ }),

/***/ 819:
/***/ ((__unused_webpack_module, exports, __nccwpck_require__) => {

"use strict";

/**
 * Execute a pipeline on the marketplace, by delegating to the CLI.
 *
 * Why delegate instead of reimplementing: the CLI already does the parts that
 * are easy to get subtly wrong — resolve the slug (newest version when none is
 * pinned), take the 402 challenge, sign the EIP-2612 permit with the buyer's
 * key, retry with payment — and every one of those has already been wrong at
 * least once in this repository's history. A second implementation inside the
 * action would be a second copy of the payment path, and the copy would not get
 * the fixes.
 *
 * The CLI is invoked at its latest published version, unpinned. Pinning is how
 * a security release silently stops reaching users: the 0.11.0 rollout was held
 * on a version that had already been superseded.
 */
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.DEFAULT_SERVER_TIMEOUT_MS = exports.CLI_OVERRIDE_ENV = exports.CLI_PACKAGE = void 0;
exports.resolveCliInvocation = resolveCliInvocation;
exports.runOnMarketplace = runOnMarketplace;
exports.parseServerResponse = parseServerResponse;
const node_child_process_1 = __nccwpck_require__(421);
const node_util_1 = __nccwpck_require__(975);
const execFileAsync = (0, node_util_1.promisify)(node_child_process_1.execFile);
/**
 * npm package spec — latest, deliberately not pinned.
 *
 * The package is `@agentsmarket/cli`. Not `agentsmarket` (no such package) and
 * not `agentsmarket/cli` (a scope needs the `@`; npx fails with enoent). I
 * checked the unscoped name, got a 404, and wrote "the CLI is not published"
 * into a comment and into an error message — the package has been on npm the
 * whole time, at 26 versions.
 */
exports.CLI_PACKAGE = '@agentsmarket/cli@latest';
/** Environment variable that overrides how the CLI is invoked. */
exports.CLI_OVERRIDE_ENV = 'AGENTSMARKET_CLI';
/**
 * How to start the CLI: `AGENTSMARKET_CLI` when the step sets it, else npx.
 *
 * The override exists because the published CLI is what runs, and the published
 * CLI is older than this repository: `--json` on `pipeline call` is in the
 * working tree and unreleased, so `latest` does not speak the protocol this
 * module parses until the next publish. The override is how a runner — and the
 * live check — can point at a build that does.
 */
function resolveCliInvocation(override) {
    const explicit = (override ?? '').trim();
    if (explicit.length > 0) {
        // A bare `node /path/x.js` and `npx --yes pkg` both arrive as one string.
        const parts = explicit.split(/\s+/);
        return { command: parts[0], prefix: parts.slice(1) };
    }
    return { command: 'npx', prefix: ['--yes', exports.CLI_PACKAGE] };
}
exports.DEFAULT_SERVER_TIMEOUT_MS = 15 * 60_000;
/**
 * Run `agentsmarket pipeline call <slug> --inputs … --json` and read the answer.
 *
 * `--json` matters: without it the CLI writes a human report and the only way to
 * get the stage outputs would be to scrape `── stage ──` headings.
 */
async function runOnMarketplace(opts) {
    const exec = opts.exec ?? execFileAsync;
    const notice = opts.notice ?? (() => undefined);
    const { command, prefix } = resolveCliInvocation(opts.cliCommand ?? process.env[exports.CLI_OVERRIDE_ENV]);
    const args = [
        ...prefix,
        'pipeline',
        'call',
        opts.slug,
        '--inputs',
        JSON.stringify(opts.inputs ?? {}),
        '--json',
    ];
    notice(`→ ${command} ${args.join(' ')}`);
    let stdout = '';
    let stderr = '';
    let code = 0;
    try {
        const res = await exec(command, args, {
            env: {
                ...process.env,
                AGENTSMARKET_PRIVATE_KEY: opts.privateKey,
                ...(opts.baseUrl ? { AGENTSMARKET_URL: opts.baseUrl } : {}),
            },
            maxBuffer: 64 * 1024 * 1024,
            timeout: opts.timeoutMs ?? exports.DEFAULT_SERVER_TIMEOUT_MS,
        });
        stdout = res.stdout;
        stderr = res.stderr;
    }
    catch (e) {
        const err = e;
        code = err.code ?? 1;
        stdout = err.stdout ?? '';
        stderr = err.stderr ?? '';
    }
    const parsed = parseServerResponse(stdout);
    if (!parsed) {
        throw new Error(`The CLI did not return JSON (exit ${code}). ` +
            'If it printed a human report, the published CLI is older than `--json` ' +
            `(set ${exports.CLI_OVERRIDE_ENV} to a build that has it). ` +
            (stderr.trim().slice(0, 400) || stdout.trim().slice(0, 400)));
    }
    if (code !== 0 || parsed.ok !== true) {
        throw new Error(`Marketplace run failed${parsed.code ? ` [${parsed.code}]` : ''}: ` +
            (parsed.error ?? stderr.trim().slice(0, 400) ?? 'unknown error'));
    }
    const resourceCost = typeof parsed.cost_actual_usdc === 'number' ? parsed.cost_actual_usdc : null;
    const charged = typeof parsed.total_charged_usdc === 'number' ? parsed.total_charged_usdc : resourceCost;
    return {
        outputs: parsed.outputs ?? {},
        stageTimings: (parsed.provenance?.stages ?? []).map(s => ({
            id: s.id ?? '?',
            ms: s.ms ?? 0,
            // Provenance reports DOLLARS under a `_usdc` name — the server writes
            // `cost_usdc: costMicroUsdc / 1_000_000`. Verified by running this against
            // production: a stage came back as 0.001244, and the run's own
            // `cost_actual_usdc` was 5092 for three such stages. Reading it as
            // micro-USDC understated each stage by a factor of a million.
            costMicroUsdc: Math.round((s.cost_usdc ?? 0) * 1_000_000),
            model: s.model ?? '',
        })),
        totalCostMicroUsdc: charged ?? 0,
        resourceCostMicroUsdc: resourceCost,
        runId: parsed.run_id ?? null,
        pipeline: parsed.pipeline ?? opts.slug,
        version: parsed.version ?? '',
    };
}
/**
 * The CLI prints the server response on stdout in `--json` mode, including on
 * failure. Anything the runtime logs goes to stderr, so stdout alone is the
 * document. A run that printed progress before the JSON is still recoverable:
 * the last `{` that starts a complete object wins.
 */
function parseServerResponse(stdout) {
    const trimmed = stdout.trim();
    if (trimmed.length === 0)
        return null;
    try {
        return JSON.parse(trimmed);
    }
    catch { /* fall through to the salvage below */ }
    const first = trimmed.indexOf('{');
    if (first === -1)
        return null;
    for (let end = trimmed.length; end > first; end--) {
        const slice = trimmed.slice(first, end);
        if (!slice.endsWith('}'))
            continue;
        try {
            return JSON.parse(slice);
        }
        catch { /* keep shrinking */ }
    }
    return null;
}


/***/ }),

/***/ 682:
/***/ (function(__unused_webpack_module, exports, __nccwpck_require__) {

"use strict";

/**
 * v0.3.0 — Per-job pipeline source cache.
 *
 * GitHub Actions wipes `$RUNNER_TEMP` between jobs, so we use it as a
 * free per-job cache directory. A consumer workflow that runs the action
 * multiple times in the same job (matrix builds, multiple steps in a
 * single job) reuses the cached pipeline.yaml content + the mtime hash
 * we record at fetch time.
 *
 * Cache key: SHA-256 of the absolute file path (deterministic, opaque).
 * Cache value: JSON `{ content, mtimeMs, size }` written atomically via
 * `{file}.{pid}.{ts}.tmp` rename so concurrent readers never see a
 * partial file.
 *
 * Invalidation: on every read we re-stat the source file. If the mtime
 * has changed since the cache was written, we treat it as a miss and
 * re-fetch. Size mismatches are treated the same way (defense in depth
 * against clock skew on some filesystems).
 *
 * Cache location: `$RUNNER_TEMP/pipeline-action-cache/` (per-job temp
 * directory). Cleared between jobs automatically by GH Actions — no
 * manual cleanup needed.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.getCachedPipelineSource = getCachedPipelineSource;
exports.readCacheFile = readCacheFile;
exports.clearCache = clearCache;
const crypto = __importStar(__nccwpck_require__(598));
const fs = __importStar(__nccwpck_require__(455));
const os = __importStar(__nccwpck_require__(161));
const path = __importStar(__nccwpck_require__(760));
function hashKey(file) {
    return crypto.createHash('sha256').update(path.resolve(file)).digest('hex').slice(0, 32);
}
function defaultCacheDir() {
    const runnerTemp = process.env.RUNNER_TEMP;
    if (runnerTemp && runnerTemp.length > 0)
        return path.join(runnerTemp, 'pipeline-action-cache');
    return path.join(os.tmpdir(), 'pipeline-action-cache');
}
async function ensureDir(dir) {
    await fs.mkdir(dir, { recursive: true });
}
async function readJsonFile(file) {
    try {
        const raw = await fs.readFile(file, 'utf8');
        return JSON.parse(raw);
    }
    catch (e) {
        if (e.code === 'ENOENT')
            return null;
        throw e;
    }
}
async function atomicWriteFile(file, contents) {
    const unique = crypto.randomBytes(8).toString('hex');
    const tmp = `${file}.${process.pid}.${Date.now()}.${unique}.tmp`;
    await fs.writeFile(tmp, contents, 'utf8');
    await fs.rename(tmp, file);
}
/**
 * Fetch the pipeline source for `file`, caching the result on disk for
 * subsequent calls in the same GH Actions job.
 *
 * Behavior:
 *  - On first call (cache miss): runs `fetchFn()`, stores the result, returns.
 *  - On subsequent calls (cache hit): returns the cached content without
 *    invoking `fetchFn`, unless the source file's mtime/size has changed
 *    since the cache was populated (in which case it's a miss and we re-fetch).
 */
async function getCachedPipelineSource(file, fetchFn, opts = {}) {
    const cacheDir = opts.cacheDir ?? defaultCacheDir();
    const statFn = opts.stat ??
        (async (f) => {
            const s = await fs.stat(f);
            return { mtimeMs: s.mtimeMs, size: s.size };
        });
    await ensureDir(cacheDir);
    const cacheFile = path.join(cacheDir, `${hashKey(file)}.json`);
    let currentStat = null;
    try {
        currentStat = await statFn(file);
    }
    catch {
        currentStat = null;
    }
    const cached = await readJsonFile(cacheFile);
    if (cached !== null && currentStat !== null) {
        if (cached.mtimeMs === currentStat.mtimeMs && cached.size === currentStat.size) {
            return { content: cached.content, mtimeMs: cached.mtimeMs, size: cached.size, cacheHit: true };
        }
    }
    const content = await fetchFn();
    let mtimeMs = currentStat?.mtimeMs ?? 0;
    let size = currentStat?.size ?? Buffer.byteLength(content, 'utf8');
    if (currentStat === null) {
        try {
            const freshStat = await statFn(file);
            mtimeMs = freshStat.mtimeMs;
            size = freshStat.size;
        }
        catch {
            mtimeMs = 0;
            size = Buffer.byteLength(content, 'utf8');
        }
    }
    const record = { content, mtimeMs, size };
    await atomicWriteFile(cacheFile, JSON.stringify(record));
    return { content, mtimeMs, size, cacheHit: false };
}
/** Test helper: read a cache file directly (returns null if absent). */
async function readCacheFile(file, opts = {}) {
    const cacheDir = opts.cacheDir ?? defaultCacheDir();
    const cacheFile = path.join(cacheDir, `${hashKey(file)}.json`);
    const cached = await readJsonFile(cacheFile);
    if (cached === null)
        return null;
    return { ...cached, cacheHit: true };
}
/** Test helper: wipe the cache root. Not used in production. */
async function clearCache(opts = {}) {
    const cacheDir = opts.cacheDir ?? defaultCacheDir();
    await fs.rm(cacheDir, { recursive: true, force: true });
}


/***/ }),

/***/ 39:
/***/ ((__unused_webpack_module, exports, __nccwpck_require__) => {

"use strict";

/**
 * GitHub Actions status-check computation.
 *
 * Given a flat `ReviewFinding[]` and a `failOn` severity level, derive a
 * pass/fail decision + the highest severity seen + a count of findings
 * that triggered the failure. Designed to feed three new action outputs:
 *
 *   - `status`            — `'passed' | 'failed'`
 *   - `failed_count`      — number of findings with severity >= `failOn`
 *   - `max_severity`      — highest severity seen (or `null` for none)
 *
 * The action does NOT call the GitHub API — callers (web3eco repos) read
 * these outputs and post the status via `gh api` or
 * `actions/github-script`. This module is pure: easy to unit test, easy
 * to embed.
 */
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.computeStatus = computeStatus;
exports.readFailOnFromEnv = readFailOnFromEnv;
const output_formatter_js_1 = __nccwpck_require__(750);
/**
 * Compute the action's pass/fail decision.
 *
 * `failOn` semantics:
 *   - `'critical'` — any critical finding fails the check (default).
 *   - `'high'`     — critical OR high fails.
 *   - `'medium'`   — critical/high/medium fails.
 *   - `'low'`      — every finding fails.
 *   - `'all'`      — same as `'low'` (any finding = fail).
 *
 * Unknown `failOn` falls back to `'critical'` (the safe default — never
 * silently greenwash a critical finding).
 */
function computeStatus(findings, failOn = 'critical') {
    const resolvedFailOn = (0, output_formatter_js_1.isSeverity)(failOn) || failOn === 'all' ? failOn : 'critical';
    if (findings.length === 0) {
        return { status: 'passed', failed_count: 0, max_severity: null };
    }
    let maxSeverity = null;
    let maxRank = 0;
    for (const f of findings) {
        const rank = (0, output_formatter_js_1.severityRank)(f.severity);
        if (rank > maxRank) {
            maxRank = rank;
            maxSeverity = f.severity;
        }
    }
    const failOnRank = resolvedFailOn === 'all' ? 1 : (0, output_formatter_js_1.severityRank)(resolvedFailOn);
    let failed = 0;
    for (const f of findings) {
        if ((0, output_formatter_js_1.severityRank)(f.severity) >= failOnRank)
            failed += 1;
    }
    return {
        status: failed > 0 ? 'failed' : 'passed',
        failed_count: failed,
        max_severity: maxSeverity,
    };
}
/**
 * Read the `fail_on` action input via the env var. Mirrors
 * `readSeverityThresholdFromEnv` — bypasses `src/inputs.ts` (Agent B's
 * territory) so this module is self-contained.
 *
 * Default = `'critical'` — any critical finding fails the check.
 */
function readFailOnFromEnv(env = process.env) {
    const raw = env['INPUT_FAIL_ON'];
    if (!raw || raw.length === 0)
        return 'critical';
    const normalized = raw.trim().toLowerCase();
    if (normalized === 'all')
        return 'all';
    if ((0, output_formatter_js_1.isSeverity)(normalized))
        return normalized;
    return 'critical';
}


/***/ }),

/***/ 834:
/***/ ((__unused_webpack_module, exports, __nccwpck_require__) => {

"use strict";

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
 *
 * v0.3.0 additive: `ActionSummary` now optionally carries PR-review style
 * `findingsCount`, `filteredFindings` (above threshold) and `status`. The
 * renderer adds rows/sections for these when present — the v0.2.1 format
 * is preserved when callers omit the new fields.
 */
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.group = group;
exports.groupAsync = groupAsync;
exports.notice = notice;
exports.warning = warning;
exports.error = error;
exports.writeOutput = writeOutput;
exports.appendSummary = appendSummary;
exports.writeActionSummary = writeActionSummary;
exports.humanizeStageId = humanizeStageId;
function group(title, fn) {
    console.log(`::group::${escape(title)}`);
    try {
        fn();
    }
    finally {
        console.log('::endgroup::');
    }
}
function groupAsync(title, fn) {
    console.log(`::group::${escape(title)}`);
    return fn().finally(() => {
        console.log('::endgroup::');
    });
}
function notice(text) {
    console.log(`::notice::${escape(text)}`);
}
function warning(text) {
    console.log(`::warning::${escape(text)}`);
}
function error(text) {
    console.log(`::error::${escape(text)}`);
}
function writeOutput(name, value) {
    const filePath = process.env.GITHUB_OUTPUT;
    if (!filePath)
        return;
    const safe = escape(String(value ?? ''));
    (__nccwpck_require__(24).appendFileSync)(filePath, `${name}=${safe}\n`, 'utf8');
}
function appendSummary(markdown) {
    const filePath = process.env.GITHUB_STEP_SUMMARY;
    if (!filePath)
        return;
    (__nccwpck_require__(24).appendFileSync)(filePath, markdown.endsWith('\n') ? markdown : `${markdown}\n`, 'utf8');
}
/**
 * Rich $GITHUB_STEP_SUMMARY for a finished pipeline: header table with
 * pipeline name, provider, model, cost, duration and stage count, followed
 * by one collapsible-friendly section per stage. Markdown is appended raw
 * (no workflow-command escaping — summaries render as Markdown).
 *
 * v0.3.0 ADDITIVE: when the caller passes `findingsCount` / `filteredFindings` /
 * `status`, two extra rows appear in the header table and an extra section
 * lists the filtered findings. Existing rows/sections are untouched.
 */
function writeActionSummary(summary) {
    const lines = [
        `## agentsmarket pipeline-action — ${summary.pipelineName}`,
        '',
        '| Field | Value |',
        '| --- | --- |',
        `| Provider | \`${summary.provider}\` |`,
        `| Model | \`${summary.model}\` |`,
        `| Stages | ${summary.stageCount} |`,
        `| Wall-clock | ${summary.totalMs}ms |`,
        `| Est. cost | ~$${summary.totalCostUsdc.toFixed(6)} USDC |`,
    ];
    // v0.3.0 ADDITIVE: status badge row (when caller computed one).
    if (summary.status !== undefined) {
        const badge = summary.status.status === 'passed' ? '✅ passed' : '❌ failed';
        const maxSev = summary.status.max_severity ?? '—';
        lines.push(`| Status | ${badge} · ${summary.status.failed_count} failing · max severity \`${maxSev}\` |`);
    }
    // v0.3.0 ADDITIVE: findings count row (when caller passed counts).
    if (summary.findingsCount !== undefined) {
        const c = summary.findingsCount;
        const total = c.critical + c.high + c.medium + c.low;
        lines.push(`| Findings | ${total} total · 🔴 ${c.critical} critical · 🟠 ${c.high} high · 🟡 ${c.medium} medium · ⚪ ${c.low} low |`);
    }
    for (const [id, val] of Object.entries(summary.outputs)) {
        lines.push('', `### ${humanizeStageId(id)}`, '', val.length > 0 ? val : '_skipped_');
    }
    // v0.3.0 ADDITIVE: findings-above-threshold section (PR-review UX).
    if (summary.filteredFindings !== undefined &&
        summary.filteredFindings.length > 0) {
        lines.push('', '### Findings above threshold', '');
        for (const f of summary.filteredFindings) {
            const loc = f.line !== undefined ? `${f.file}:${f.line}` : f.file.length > 0 ? f.file : 'file-level';
            const cwe = f.cwe !== undefined ? ` (${f.cwe})` : '';
            lines.push(`- **${f.severity.toUpperCase()}** \`${loc}\`${cwe} — ${f.message} _(confidence ${f.confidence.toFixed(2)})_`);
        }
    }
    appendSummary(lines.join('\n'));
}
function escape(text) {
    return String(text ?? '').replace(/%/g, '%25').replace(/\r?\n/g, '%0A');
}
/**
 * Title-case a snake_case stage id for the per-stage summary heading.
 * `profile_style` → `Profile Style`, `analyze_style` → `Analyze Style`.
 * Stage ids in our pipeline spec are snake_case by convention; the raw id
 * renders as `### profile_style` which is hard to scan in the Actions UI.
 * Pure cosmetic — never used as a key, only as a label.
 */
function humanizeStageId(id) {
    return id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}


/***/ }),

/***/ 558:
/***/ ((__unused_webpack_module, exports) => {

"use strict";

/**
 * v0.3.2 — per-stage wall-clock instrumentation.
 */
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.Timings = void 0;
const STAGE_ORDER = [
    'validate',
    'fetch_source',
    'run_pipeline',
    'format_output',
];
class Timings {
    starts = new Map();
    durations = new Map();
    start(name) {
        if (this.starts.has(name))
            return;
        this.starts.set(name, performance.now());
    }
    end(name) {
        const startedAt = this.starts.get(name);
        if (startedAt === undefined)
            return;
        const elapsedMs = performance.now() - startedAt;
        this.durations.set(name, Math.round(elapsedMs));
        this.starts.delete(name);
    }
    toJSON() {
        const out = {};
        for (const stage of STAGE_ORDER) {
            out[`${stage}_ms`] = this.durations.get(stage) ?? 0;
        }
        return out;
    }
    toJSONString() {
        return JSON.stringify(this.toJSON());
    }
}
exports.Timings = Timings;


/***/ }),

/***/ 918:
/***/ (function(__unused_webpack_module, exports, __nccwpck_require__) {

"use strict";

var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.ACTION_VERSION = void 0;
/**
 * The version this bundle was built from.
 *
 * It used to be a hand-written constant, and it lied: the bundle of every tag
 * from v0.4.3 to v0.4.5 printed "pipeline-action v0.4.2" while the tag and
 * package.json said 0.4.3, 0.4.4 and 0.4.5. The log is the only place a
 * consumer can see which release actually ran, so a wrong version there sends
 * the audit to a release that never existed — and the drift was invisible,
 * because the comment in the code and the tag agreed with each other.
 *
 * Reading package.json makes the drift impossible: the version is baked in
 * at build time from the same file the release is cut from. It lives in its
 * own module because two different surfaces print it — the run log and the
 * review comment the action posts on the PR — and a constant that lives in
 * one of them is a constant the other one will forget.
 */
const package_json_1 = __importDefault(__nccwpck_require__(330));
exports.ACTION_VERSION = package_json_1.default.version;


/***/ }),

/***/ 706:
/***/ ((module) => {

module.exports = eval("require")("@agentsmarket/pipeline-runtime");


/***/ }),

/***/ 421:
/***/ ((module) => {

"use strict";
module.exports = require("node:child_process");

/***/ }),

/***/ 598:
/***/ ((module) => {

"use strict";
module.exports = require("node:crypto");

/***/ }),

/***/ 24:
/***/ ((module) => {

"use strict";
module.exports = require("node:fs");

/***/ }),

/***/ 455:
/***/ ((module) => {

"use strict";
module.exports = require("node:fs/promises");

/***/ }),

/***/ 161:
/***/ ((module) => {

"use strict";
module.exports = require("node:os");

/***/ }),

/***/ 760:
/***/ ((module) => {

"use strict";
module.exports = require("node:path");

/***/ }),

/***/ 975:
/***/ ((module) => {

"use strict";
module.exports = require("node:util");

/***/ }),

/***/ 330:
/***/ ((module) => {

"use strict";
module.exports = /*#__PURE__*/JSON.parse('{"name":"@agentsmarket/pipeline-action","version":"0.4.13","description":"GitHub Action that runs an agentsmarket pipeline.yaml inside a step. Streams stage outputs as GH log groups, sets action outputs on success.","license":"MIT","main":"./dist/index.js","files":["dist","action.yml","README.md","examples"],"scripts":{"build":"rm -rf dist && ncc build -t src/index.ts -o dist","build:check":"tsc --noEmit","test":"vitest run","lint":"tsc --noEmit","dev":"tsx src/run.ts","typecheck":"tsc --noEmit -p tsconfig.json"},"dependencies":{"@agentsmarket/pipeline-runtime":"workspace:^"},"devDependencies":{"@types/node":"^22.20.5","@vercel/ncc":"^0.45.0","tsx":"^4.23.15","typescript":"^5.6.0","vitest":"^4.1.12"},"engines":{"node":">=20"}}');

/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __nccwpck_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		var threw = true;
/******/ 		try {
/******/ 			__webpack_modules__[moduleId].call(module.exports, module, module.exports, __nccwpck_require__);
/******/ 			threw = false;
/******/ 		} finally {
/******/ 			if(threw) delete __webpack_module_cache__[moduleId];
/******/ 		}
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/asset-relocator-loader */
/******/ 	if (typeof __nccwpck_require__ !== 'undefined') __nccwpck_require__.ab = __dirname + "/";
/******/ 	
/************************************************************************/
var __webpack_exports__ = {};
// This entry need to be wrapped in an IIFE because it need to be in strict mode.
(() => {
"use strict";
var exports = __webpack_exports__;

Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.actionName = exports.findingKey = exports.countBySeverity = exports.renderInlineCommentBody = exports.renderReviewBody = exports.buildInlineComments = exports.parseEmbeddedFindings = exports.findExistingReview = exports.diffFindings = exports.buildSessionMarker = exports.parseSessionMarker = exports.postReview = void 0;
const inputs_js_1 = __nccwpck_require__(601);
const pipeline_source_js_1 = __nccwpck_require__(862);
const executor_deps_js_1 = __nccwpck_require__(920);
const run_js_1 = __nccwpck_require__(795);
// ncc tree-shakes unused exports; re-export postReview() so consumers
// importing from `dist/index.js` keep the dedup helper alive.
var post_review_js_1 = __nccwpck_require__(207);
Object.defineProperty(exports, "postReview", ({ enumerable: true, get: function () { return post_review_js_1.postReview; } }));
Object.defineProperty(exports, "parseSessionMarker", ({ enumerable: true, get: function () { return post_review_js_1.parseSessionMarker; } }));
Object.defineProperty(exports, "buildSessionMarker", ({ enumerable: true, get: function () { return post_review_js_1.buildSessionMarker; } }));
Object.defineProperty(exports, "diffFindings", ({ enumerable: true, get: function () { return post_review_js_1.diffFindings; } }));
Object.defineProperty(exports, "findExistingReview", ({ enumerable: true, get: function () { return post_review_js_1.findExistingReview; } }));
Object.defineProperty(exports, "parseEmbeddedFindings", ({ enumerable: true, get: function () { return post_review_js_1.parseEmbeddedFindings; } }));
Object.defineProperty(exports, "buildInlineComments", ({ enumerable: true, get: function () { return post_review_js_1.buildInlineComments; } }));
Object.defineProperty(exports, "renderReviewBody", ({ enumerable: true, get: function () { return post_review_js_1.renderReviewBody; } }));
Object.defineProperty(exports, "renderInlineCommentBody", ({ enumerable: true, get: function () { return post_review_js_1.renderInlineCommentBody; } }));
Object.defineProperty(exports, "countBySeverity", ({ enumerable: true, get: function () { return post_review_js_1.countBySeverity; } }));
Object.defineProperty(exports, "findingKey", ({ enumerable: true, get: function () { return post_review_js_1.findingKey; } }));
exports.actionName = 'pipeline-action';
async function main() {
    let inputs = null;
    try {
        inputs = (0, inputs_js_1.readInputs)();
        const params = await (0, pipeline_source_js_1.resolvePipelineSource)(inputs);
        params.inputs = inputs;
        const deps = await (0, executor_deps_js_1.buildExecutorDeps)(params);
        const exitCode = await (0, run_js_1.run)({ params, deps });
        process.exit(exitCode);
    }
    catch (err) {
        const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
        const ctx = inputs !== null ? ` [provider=${inputs.provider} model=${inputs.model}]` : '';
        console.error(`::error::pipeline-action v${run_js_1.ACTION_VERSION} crashed${ctx}: ${msg}`);
        process.exit(1);
    }
}
main();

})();

module.exports = __webpack_exports__;
/******/ })()
;