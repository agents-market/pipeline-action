#!/usr/bin/env node
import { readInputs } from './inputs.js';
import { resolvePipelineSource } from './pipeline-source.js';
import { buildExecutorDeps } from './executor-deps.js';
import { run } from './run.js';
export const actionName = 'pipeline-action';
async function main() {
    const inputs = readInputs();
    const params = await resolvePipelineSource(inputs);
    params.inputs = inputs;
    const deps = await buildExecutorDeps(params);
    const exitCode = await run({ params, deps });
    process.exit(exitCode);
}
main().catch((err) => {
    const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
    console.error(`::error::pipeline-action crashed: ${msg}`);
    process.exit(1);
});
