/**
 * File-backed healing history store.
 *
 * Persists mappings to `<historyDir>/locator-mappings.json` (default
 * `.healing/locator-mappings.json`, gitignored). Chosen for the MVP because it
 * is zero-config, inspectable, and needs no external service.
 *
 * Process model (fixes the prior implementation's central bug): writes happen
 * SYNCHRONOUSLY at heal time, inside the worker process that ran the test —
 * never in `globalTeardown` (which runs once in the main process and would see
 * empty in-worker state). Each successful heal immediately persists, so nothing
 * is lost if a later test crashes the worker.
 *
 * Concurrency: Playwright runs multiple worker processes in parallel, each with
 * its own FileHistoryStore. Writes merge the current on-disk file with the new
 * entry and use a temp-file + rename to keep the file valid under interleaving.
 * Last-writer-wins on the same key is acceptable for a hint store.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import * as path from 'path';
import type { HealingHistoryEntry, HealingHistoryStore } from './store';

const FILE_NAME = 'locator-mappings.json';

interface HistoryFile {
    version: 1;
    entries: Record<string, HealingHistoryEntry>;
}

export interface FileHistoryStoreOptions {
    /** Directory to hold the mappings file. Resolved from cwd if relative. */
    dir: string;
}

export class FileHistoryStore implements HealingHistoryStore {
    private readonly filePath: string;
    private cache?: Record<string, HealingHistoryEntry>;

    constructor(options: FileHistoryStoreOptions) {
        this.filePath = path.resolve(options.dir, FILE_NAME);
    }

    get(key: string): string | undefined {
        try {
            return this.load()[key]?.healedSelector;
        } catch {
            return undefined;
        }
    }

    set(key: string, healedSelector: string): void {
        try {
            // Re-read from disk to merge with what other workers have written,
            // rather than clobbering with only this worker's in-memory view.
            const current = this.readFile();
            const existing = current[key];
            current[key] = {
                key,
                healedSelector,
                updatedAt: new Date().toISOString(),
                hitCount: existing && existing.healedSelector === healedSelector ? existing.hitCount + 1 : 1,
            };
            this.writeFile(current);
            this.cache = current;
        } catch {
            // History is best-effort. A write failure must never break a test.
        }
    }

    entries(): HealingHistoryEntry[] {
        try {
            return Object.values(this.load());
        } catch {
            return [];
        }
    }

    /** Lazily load and cache the file contents. */
    private load(): Record<string, HealingHistoryEntry> {
        if (this.cache) return this.cache;
        this.cache = this.readFile();
        return this.cache;
    }

    /** Read + parse the file, tolerating absence/corruption. Never throws. */
    private readFile(): Record<string, HealingHistoryEntry> {
        try {
            if (!existsSync(this.filePath)) return {};
            const parsed = JSON.parse(readFileSync(this.filePath, 'utf-8')) as Partial<HistoryFile>;
            if (parsed && typeof parsed === 'object' && parsed.entries && typeof parsed.entries === 'object') {
                return parsed.entries as Record<string, HealingHistoryEntry>;
            }
            return {};
        } catch {
            return {};
        }
    }

    /** Atomically write via temp file + rename. */
    private writeFile(entries: Record<string, HealingHistoryEntry>): void {
        const dir = path.dirname(this.filePath);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        const payload: HistoryFile = { version: 1, entries };
        const tmp = `${this.filePath}.${process.pid}.tmp`;
        writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
        renameSync(tmp, this.filePath);
    }
}

/**
 * Adapt a HealingHistoryStore to the executor's HistoryPort shape
 * (`lookup`/`remember`). Kept separate so the store interface stays clean.
 */
export function toHistoryPort(store: HealingHistoryStore): {
    lookup: (key: string) => string | undefined;
    remember: (key: string, selector: string) => void;
} {
    return {
        lookup: (key) => store.get(key),
        remember: (key, selector) => store.set(key, selector),
    };
}
