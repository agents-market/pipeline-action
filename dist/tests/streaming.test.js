import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, mkdtempSync } from 'node:fs';
import { mkdtemp as _mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { group, groupAsync, notice, warning, error, writeOutput, appendSummary, } from '../src/streaming.js';
describe('streaming — workflow commands', () => {
    let logs;
    let originalLog;
    beforeEach(() => {
        logs = [];
        originalLog = console.log;
        console.log = (msg) => { logs.push(String(msg)); };
    });
    afterEach(() => {
        console.log = originalLog;
    });
    it('group opens + closes', () => {
        group('Stage X', () => { notice('inside'); });
        expect(logs).toEqual(['::group::Stage X', '::notice::inside', '::endgroup::']);
    });
    it('groupAsync closes even on throw', async () => {
        await expect(groupAsync('Stage Y', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
        expect(logs[0]).toBe('::group::Stage Y');
        expect(logs.at(-1)).toBe('::endgroup::');
    });
    it('distinct prefixes for notice + warning + error', () => {
        notice('info');
        warning('caution');
        error('fail');
        expect(logs[0]).toMatch(/^::notice::/);
        expect(logs[1]).toMatch(/^::warning::/);
        expect(logs[2]).toMatch(/^::error::/);
    });
    it('escapes newlines + percent in workflow commands', () => {
        notice('multi\nline\nwith%stuff');
        expect(logs[0]).toBe('::notice::multi%0Aline%0Awith%25stuff');
    });
});
describe('streaming — $GITHUB_OUTPUT writer', () => {
    let dir;
    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'gh-out-'));
        process.env.GITHUB_OUTPUT = join(dir, 'output');
    });
    afterEach(() => {
        delete process.env.GITHUB_OUTPUT;
    });
    it('writes multiline-safe KEY=VALUE pairs', () => {
        writeOutput('hello', 'world');
        writeOutput('multi', 'a\nb');
        writeOutput('pct', 'a%b');
        const out = readFileSync(process.env.GITHUB_OUTPUT, 'utf8');
        expect(out).toContain('hello=world\n');
        expect(out).toContain('multi=a%0Ab\n');
        expect(out).toContain('pct=a%25b\n');
    });
    it('no-op when GITHUB_OUTPUT is unset', () => {
        delete process.env.GITHUB_OUTPUT;
        expect(() => writeOutput('a', 'b')).not.toThrow();
    });
});
describe('streaming — $GITHUB_STEP_SUMMARY appender', () => {
    let dir;
    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'gh-sum-'));
        process.env.GITHUB_STEP_SUMMARY = join(dir, 'summary');
    });
    afterEach(() => {
        delete process.env.GITHUB_STEP_SUMMARY;
    });
    it('appends markdown block (trailing newline when missing)', () => {
        appendSummary('## Heading');
        appendSummary('text');
        const out = readFileSync(process.env.GITHUB_STEP_SUMMARY, 'utf8');
        expect(out).toBe('## Heading\ntext\n');
    });
    it('no-op when GITHUB_STEP_SUMMARY is unset', () => {
        delete process.env.GITHUB_STEP_SUMMARY;
        expect(() => appendSummary('foo')).not.toThrow();
    });
});
void _mkdtemp;
