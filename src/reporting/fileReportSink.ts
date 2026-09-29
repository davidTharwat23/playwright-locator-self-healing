/**
 * Worker-side report sink.
 *
 * The executor emits a HealingReportEntry synchronously, in the WORKER process,
 * the moment a heal attempt resolves. This sink appends each entry to a
 * per-worker JSONL file (`healing-events-<pid>.jsonl`) under the report dir.
 *
 * Why per-worker files written in the worker (and not a Playwright reporter
 * collecting in-memory events): Playwright runs tests across multiple worker
 * processes, and a reporter's aggregation methods run in the MAIN process. The
 * prior implementation tried to flush worker-accumulated singletons from the
 * main process and silently wrote nothing. Writing from the worker at emit
 * time, one file per pid, avoids that entirely. The reporter (main process)
 * then merges these files at the end of the run.
 *
 * JSONL (one JSON object per line) is used so concurrent appends within a
 * single worker are simple and a partially-written run is still parseable
 * line-by-line.
 */

import { appendFileSync, existsSync, mkdirSync } from 'fs';
import * as path from 'path';
import type { HealingReportEntry } from '../core/types';
import type { ReportSink } from '../healing/executor';

export interface FileReportSinkOptions {
    /** Directory for the per-worker event files. */
    dir: string;
}

export class FileReportSink implements ReportSink {
    private readonly filePath: string;
    private dirEnsured = false;

    constructor(options: FileReportSinkOptions) {
        this.filePath = path.resolve(options.dir, `healing-events-${process.pid}.jsonl`);
    }

    record(entry: HealingReportEntry): void {
        try {
            this.ensureDir();
            appendFileSync(this.filePath, `${JSON.stringify(entry)}\n`, 'utf-8');
        } catch {
            // Reporting is best-effort; a write failure must not affect the test.
        }
    }

    private ensureDir(): void {
        if (this.dirEnsured) return;
        const dir = path.dirname(this.filePath);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        this.dirEnsured = true;
    }
}
