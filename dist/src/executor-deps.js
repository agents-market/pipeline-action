/**
 * Build a StageExecutorDeps for runPipelineV2 from action params.
 *
 * Provider selection:
 *   - mock=true  -> MockProvider (no real API)
 *   - model hints Claude/GPT/Mistral/Llama -> OpenRouterProvider
 *   - else       -> MiniMaxProvider (default)
 *
 * fetchSkill returns null: marketplace-fetched skills ship in R12.2-R12.4.
 * Pipelines that depend on `uses:` stages will surface "skill not found" errors
 * verbatim in $GITHUB_STEP_SUMMARY so users can identify missing pieces.
 */
import { MiniMaxProvider, OpenRouterProvider, MiniMaxPricingResolver, OpenRouterPricingResolver, CompositePricingResolver, createModelResolver, LLMProviderRegistry, } from '@agentsmarket/pipeline-runtime';
class MockProvider {
    name = 'mock';
    models = ['mock'];
    simpleModel = 'mock';
    complexModel = 'mock';
    supports(model) {
        return this.models.includes(model);
    }
    async generateText(prompt, _opts) {
        return {
            text: `[mock pipeline-action] echo: ${prompt.slice(0, 180)}`,
            usage: { inputTokens: prompt.length, outputTokens: 50 },
        };
    }
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
function pickProvider(modelName, apiKey) {
    if (!apiKey) {
        throw new Error(`Model '${modelName}' requires api_key input (or MINIMAX_API_KEY env var).`);
    }
    const m = modelName.toLowerCase();
    if (m.includes('claude') || m.includes('gpt') || m.includes('mistral') || m.includes('llama')) {
        return new OpenRouterProvider({ apiKey });
    }
    return new MiniMaxProvider({ apiKey });
}
export async function buildExecutorDeps(params) {
    const apiKey = params.inputs.api_key;
    const provider = params.inputs.mock
        ? new MockProvider()
        : pickProvider(params.inputs.model, apiKey);
    const registry = new LLMProviderRegistry([provider]);
    const resolvers = apiKey
        ? [
            new MiniMaxPricingResolver(),
            new OpenRouterPricingResolver({ apiKey }),
            zeroPricing,
        ]
        : [zeroPricing];
    const pricing = new CompositePricingResolver(resolvers);
    return {
        provider,
        registry,
        pricing,
        modelResolver: createModelResolver({ agentDefault: params.inputs.model }),
        fetchSkill: async () => null,
        getCurrentAgentId: () => '0xaction-runner',
        getPipelineAuthorId: () => '0xaction-runner',
        isLocal: false,
    };
}
