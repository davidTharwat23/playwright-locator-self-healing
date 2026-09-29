import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { FileHistoryStore, toHistoryPort } from './fileStore';

let dir: string;

beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'heal-hist-'));
});

afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
});

describe('FileHistoryStore', () => {
    it('returns undefined for an unknown key with no file yet', () => {
        const store = new FileHistoryStore({ dir });
        expect(store.get('getByTestId:login-button')).toBeUndefined();
    });

    it('persists and reads back a mapping', () => {
        const store = new FileHistoryStore({ dir });
        store.set('getByTestId:login-button', 'role=button[name="Login"]');

        // A fresh store instance reads it from disk (proves persistence).
        const fresh = new FileHistoryStore({ dir });
        expect(fresh.get('getByTestId:login-button')).toBe('role=button[name="Login"]');
    });

    it('writes a versioned JSON file at the expected path', () => {
        const store = new FileHistoryStore({ dir });
        store.set('k', 'sel');
        const file = path.join(dir, 'locator-mappings.json');
        expect(existsSync(file)).toBe(true);
        const parsed = JSON.parse(readFileSync(file, 'utf-8'));
        expect(parsed.version).toBe(1);
        expect(parsed.entries.k.healedSelector).toBe('sel');
    });

    it('increments hitCount when the same mapping is confirmed again', () => {
        const store = new FileHistoryStore({ dir });
        store.set('k', 'sel');
        store.set('k', 'sel');
        const entry = store.entries().find((e) => e.key === 'k');
        expect(entry?.hitCount).toBe(2);
    });

    it('resets hitCount to 1 when the mapping changes', () => {
        const store = new FileHistoryStore({ dir });
        store.set('k', 'sel-a');
        store.set('k', 'sel-a');
        store.set('k', 'sel-b');
        const entry = store.entries().find((e) => e.key === 'k');
        expect(entry?.healedSelector).toBe('sel-b');
        expect(entry?.hitCount).toBe(1);
    });

    it('merges writes from a separate store instance (parallel-worker simulation)', () => {
        const a = new FileHistoryStore({ dir });
        const b = new FileHistoryStore({ dir });
        a.set('key-a', 'sel-a');
        b.set('key-b', 'sel-b'); // b re-reads disk, so it should keep key-a

        const reader = new FileHistoryStore({ dir });
        expect(reader.get('key-a')).toBe('sel-a');
        expect(reader.get('key-b')).toBe('sel-b');
    });

    it('tolerates a corrupt file and starts empty', () => {
        const file = path.join(dir, 'locator-mappings.json');
        writeFileSync(file, '{ this is not valid json ', 'utf-8');
        const store = new FileHistoryStore({ dir });
        expect(store.get('anything')).toBeUndefined();
        // And can still write over it.
        store.set('k', 'sel');
        expect(new FileHistoryStore({ dir }).get('k')).toBe('sel');
    });

    it('never throws on write when the directory path is invalid', () => {
        // Point at a path under a file (invalid as a dir) — set must swallow it.
        const badFile = path.join(dir, 'not-a-dir');
        writeFileSync(badFile, 'x', 'utf-8');
        const store = new FileHistoryStore({ dir: path.join(badFile, 'sub') });
        expect(() => store.set('k', 'sel')).not.toThrow();
        expect(store.get('k')).toBeUndefined();
    });
});

describe('toHistoryPort', () => {
    it('adapts get/set to lookup/remember', () => {
        const store = new FileHistoryStore({ dir });
        const port = toHistoryPort(store);
        port.remember('k', 'sel');
        expect(port.lookup('k')).toBe('sel');
    });
});
