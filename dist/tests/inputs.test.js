import { describe, it, expect } from 'vitest';
import { parseInputJson } from '../src/inputs.js';
describe('parseInputJson', () => {
    it('returns empty object on null', () => {
        expect(parseInputJson(null, 'foo')).toEqual({});
    });
    it('round-trips valid object JSON', () => {
        expect(parseInputJson('{"a":1,"b":"hi"}', 'foo')).toEqual({ a: 1, b: 'hi' });
    });
    it('throws on invalid JSON', () => {
        expect(() => parseInputJson('not-json', 'inputs_json')).toThrow(/Invalid inputs_json JSON/);
    });
    it('throws on array root', () => {
        expect(() => parseInputJson('[]', 'foo')).toThrow(/array/);
        expect(() => parseInputJson('[1,2]', 'foo')).toThrow(/array/);
    });
    it('throws on scalar root', () => {
        expect(() => parseInputJson('"hello"', 'foo')).toThrow(/string/);
        expect(() => parseInputJson('42', 'foo')).toThrow(/number/);
    });
});
