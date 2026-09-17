import { describe, it, expect } from 'vitest';
import { resolvePipelineSource, PipelineSourceError } from '../src/pipeline-source.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
const baseInputs = (over = {}) => ({
    api_key: null,
    pipeline_file: null,
    pipeline_yaml: null,
    model: 'MiniMax-M3',
    inputs_json: null,
    fail_fast: true,
    mock: true,
    ...over,
});
describe('resolvePipelineSource', () => {
    it('rejects when neither source is provided', async () => {
        await expect(resolvePipelineSource(baseInputs())).rejects.toBeInstanceOf(PipelineSourceError);
    });
    it('rejects when both sources are provided', async () => {
        await expect(resolvePipelineSource(baseInputs({ pipeline_file: 'a', pipeline_yaml: 'b' }))).rejects.toBeInstanceOf(PipelineSourceError);
    });
    it('reads from file when pipeline_file is set', async () => {
        const tmpdir = await fs.mkdtemp(path.join(os.tmpdir(), 'pa-'));
        const file = path.join(tmpdir, 'pipeline.yaml');
        await fs.writeFile(file, 'name: x\nstages: []\n', 'utf8');
        const res = await resolvePipelineSource(baseInputs({ pipeline_file: file }));
        expect(res.resolved_from).toBe('file');
        expect(res.pipeline_spec).toContain('name: x');
        expect(res.pipeline_inputs).toEqual({});
    });
    it('passes inline YAML when pipeline_yaml is set', async () => {
        const res = await resolvePipelineSource(baseInputs({ pipeline_yaml: 'name: y\nstages: []\n' }));
        expect(res.resolved_from).toBe('inline');
        expect(res.pipeline_spec).toBe('name: y\nstages: []\n');
    });
    it('parses inputs_json when provided', async () => {
        const res = await resolvePipelineSource(baseInputs({ pipeline_yaml: 'stages: []\n', inputs_json: '{"foo":1}' }));
        expect(res.pipeline_inputs).toEqual({ foo: 1 });
    });
    it('rejects non-object inputs_json', async () => {
        await expect(resolvePipelineSource(baseInputs({ pipeline_yaml: 'stages: []\n', inputs_json: '[]' }))).rejects.toThrow(/JSON object/);
    });
    it('rejects malformed file path', async () => {
        await expect(resolvePipelineSource(baseInputs({ pipeline_file: '/nonexistent/path/xyz.yaml' }))).rejects.toThrow(/Cannot read pipeline_file/);
    });
});
