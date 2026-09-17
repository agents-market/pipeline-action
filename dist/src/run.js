/**
 * Action run lifecycle: load + validate pipeline, resolve env vars, invoke
 * runPipelineV2 with stage hooks (each stage becomes a GH log group), then
 * write outputs:
 *   - result_json   — JSON.stringify of stage outputs
 *   - total_ms      — wall-clock duration
 *   - total_cost_usdc — USDC with 6 decimals
 *   - stage_count   — number of stages in spec
 * Per-stage:
 *   - stage_<id>_ms
 *   - stage_<id>_output
 *
 * Exit codes:
 *   0 — success (skipped stages OK; no failures)
 *   1 — pipeline validation/runtime error
 */
import { runPipelineV2, loadPipelineYaml, expandPipelineText, } from '@agentsmarket/pipeline-runtime';
import { group, notice, error, writeOutput, appendSummary, } from './streaming.js';
export async function run(args) {
    const { params, deps } = args;
    const inputs = params.inputs;
    let resolvedSpec;
    try {
        resolvedSpec = expandPipelineText(params.pipeline_spec, buildPipelineEnv(inputs));
    }
    catch (e) {
        error(`✗ ${e.message}`);
        return 1;
    }
    let loaded;
    try {
        loaded = loadPipelineYaml(resolvedSpec);
    }
    catch (e) {
        error(`✗ Invalid pipeline YAML (after env-var expansion): ${e.message}`);
        return 1;
    }
    const spec = loaded;
    if (!spec || !Array.isArray(spec.stages)) {
        error('✗ Spec top-level must be an object with a `stages` array.');
        return 1;
    }
    const stageCount = spec.stages.length;
    notice(`▶ pipeline-action v0.1.0 — ${spec.name ?? 'unnamed'} (${stageCount} stage${stageCount === 1 ? '' : 's'})`);
    const stagesForRuntime = spec.stages.map((s) => ({
        id: s.id,
        model: s.model,
        system: s.system,
        prompt: s.prompt,
        uses: s.uses,
        input: s.input,
        output_format: s.output_format,
        fields: s.fields,
        mcp_servers: s.mcp_servers,
        mcp_tools: s.mcp_tools,
        working_dir: s.working_dir,
        provider: s.provider,
    }));
    const startedAt = Date.now();
    let result;
    try {
        result = await runPipelineV2({
            spec: { stages: stagesForRuntime },
            inputs: params.pipeline_inputs,
            deps,
            hooks: {
                onStageStart: (stageId) => {
                    group(`▶ stage: ${stageId}`, () => {
                        notice(`started at ${new Date().toISOString()}`);
                    });
                },
                onStageComplete: (stageId, ms, output) => {
                    writeOutput(`stage_${stageId}_ms`, String(ms));
                    writeOutput(`stage_${stageId}_output`, output);
                    notice(`✓ stage ${stageId} completed in ${ms}ms (${output.length} chars)`);
                },
            },
        });
    }
    catch (e) {
        error(`✗ pipeline failed: ${e.message}`);
        return 1;
    }
    const totalMs = Date.now() - startedAt;
    const totalCostUsdc = result.totalCostMicroUsdc / 1_000_000;
    const summaryLines = [
        '## agentsmarket pipeline-action',
        '',
        `Stages: ${stageCount}`,
        '',
        `Wall-clock: ${totalMs}ms · ~$${totalCostUsdc.toFixed(6)} USDC`,
    ];
    for (const [id, val] of Object.entries(result.outputs)) {
        summaryLines.push('', `### ${id}`, '', val.length > 0 ? val : '_skipped_');
    }
    appendSummary(summaryLines.join('\n'));
    writeOutput('result_json', JSON.stringify(result.outputs));
    writeOutput('total_ms', String(totalMs));
    writeOutput('total_cost_usdc', totalCostUsdc.toFixed(6));
    writeOutput('stage_count', String(stageCount));
    notice(`✓ pipeline complete: ${stageCount} stages, ${totalMs}ms, ~$${totalCostUsdc.toFixed(6)} USDC`);
    return 0;
}
function buildPipelineEnv(inputs) {
    const env = { ...process.env };
    if (inputs.api_key)
        env.MINIMAX_API_KEY = inputs.api_key;
    env.AGENTSMARKET_DEFAULT_MODEL = inputs.model;
    if (inputs.mock)
        env.AGENTSMARKET_MOCK = 'true';
    return env;
}
