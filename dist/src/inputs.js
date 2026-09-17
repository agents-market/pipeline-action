/**
 * Action input parsing + validation.
 *
 * GitHub Actions injects each declared input as `INPUT_<UPPER_SNAKE>` env var,
 * always a string. Boolean toggles arrive as "true" or "false". Object inputs
 * come as JSON strings.
 */
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
export function readInputs() {
    return {
        api_key: readEnvString('INPUT_API_KEY', null) ?? process.env.MINIMAX_API_KEY ?? null,
        pipeline_file: readEnvString('INPUT_PIPELINE_FILE', null),
        pipeline_yaml: readEnvString('INPUT_PIPELINE_YAML', null),
        model: readEnvString('INPUT_MODEL', DEFAULT_MODEL) ?? DEFAULT_MODEL,
        inputs_json: readEnvString('INPUT_INPUTS_JSON', null),
        fail_fast: readEnvBool('INPUT_FAIL_FAST', true),
        mock: readEnvBool('INPUT_MOCK', false),
    };
}
export function parseInputJson(raw, where) {
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
