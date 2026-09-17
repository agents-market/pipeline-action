import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { run } from '../src/run.js';
import { buildExecutorDeps } from '../src/executor-deps.js';
const baseInputs = (over = {}) => ({
    api_key: 'mock-key',
    pipeline_file: null,
    pipeline_yaml: null,
    model: 'mock',
    inputs_json: null,
    fail_fast: true,
    mock: true,
    ...over,
});
const sampleYaml = [
    'name: smoke-test',
    "defaults: { model: mock }",
    'stages:',
    '  - id: greet',
    '    prompt: "Say hi"',
    '    input: { who: "${WHO:-world}" }',
].join('\n');
describe('run() — happy path with mock provider', () => {
    let dir;
    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'pa-run-'));
        process.env.GITHUB_OUTPUT = join(dir, 'out');
        process.env.GITHUB_STEP_SUMMARY = join(dir, 'summary');
    });
    afterEach(() => {
        delete process.env.GITHUB_OUTPUT;
        delete process.env.GITHUB_STEP_SUMMARY;
    });
    it('completes a single LLM stage and writes outputs + summary', async () => {
        const inputs = baseInputs();
        const params = {
            inputs,
            pipeline_spec: sampleYaml,
            pipeline_inputs: {},
            resolved_from: 'inline',
        };
        const deps = await buildExecutorDeps(params);
        const code = await run({ params, deps });
        expect(code).toBe(0);
        const out = readFileSync(process.env.GITHUB_OUTPUT, 'utf8');
        expect(out).toContain('stage_count=1');
        expect(out).toMatch(/total_ms=\d+/);
        expect(out).toMatch(/total_cost_usdc=0/);
        expect(out).toContain('stage_greet_ms=');
        expect(out).toMatch(/stage_greet_output=\[mock pipeline-action\]/);
        const summary = readFileSync(process.env.GITHUB_STEP_SUMMARY, 'utf8');
        expect(summary).toContain('## agentsmarket pipeline-action');
        expect(summary).toContain('Stages: 1');
        expect(summary).toContain('### greet');
    });
    it('returns exit 1 when YAML is invalid', async () => {
        const inputs = baseInputs();
        const params = {
            inputs,
            pipeline_spec: 'this is not valid yaml ::: !!!',
            pipeline_inputs: {},
            resolved_from: 'inline',
        };
        const deps = await buildExecutorDeps(params);
        const code = await run({ params, deps });
        expect(code).toBe(1);
    });
    it('returns exit 1 when stages array is missing', async () => {
        const inputs = baseInputs();
        const params = {
            inputs,
            pipeline_spec: 'name: no-stages\n',
            pipeline_inputs: {},
            resolved_from: 'inline',
        };
        const deps = await buildExecutorDeps(params);
        const code = await run({ params, deps });
        expect(code).toBe(1);
    });
    it('returns exit 1 when env-var expansion refers to missing var without default', async () => {
        const inputs = baseInputs();
        const params = {
            inputs,
            pipeline_spec: 'name: missing\nstages: [{ id: a, prompt: "${MISSING_VAR}" }]\n',
            pipeline_inputs: {},
            resolved_from: 'inline',
        };
        delete process.env.MISSING_VAR;
        const deps = await buildExecutorDeps(params);
        const code = await run({ params, deps });
        expect(code).toBe(1);
    });
});
describe('buildExecutorDeps()', () => {
    it('selects MockProvider when mock=true', async () => {
        const params = {
            inputs: baseInputs({ mock: true }),
            pipeline_spec: 'stages: []',
            pipeline_inputs: {},
            resolved_from: 'inline',
        };
        const deps = await buildExecutorDeps(params);
        expect(deps.provider.name).toBe('mock');
        expect(deps.fetchSkill).toBeDefined();
        expect(deps.isLocal).toBe(false);
    });
    it('throws when api_key missing and not in mock mode', async () => {
        const params = {
            inputs: baseInputs({ api_key: null, mock: false, model: 'MiniMax-M3' }),
            pipeline_spec: 'stages: []',
            pipeline_inputs: {},
            resolved_from: 'inline',
        };
        await expect(buildExecutorDeps(params)).rejects.toThrow(/requires api_key/);
    });
});
