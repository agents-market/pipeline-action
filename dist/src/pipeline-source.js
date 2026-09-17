/**
 * Pipeline source resolution: either from file (pipeline_file) or inline
 * string (pipeline_yaml). Mutual exclusion: exactly one source must be provided.
 */
import * as fs from 'node:fs/promises';
export class PipelineSourceError extends Error {
}
export async function resolvePipelineSource(inputs) {
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
