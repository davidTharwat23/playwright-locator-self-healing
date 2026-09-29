/**
 * Playwright reporter that aggregates self-healing events into one structured
 * JSON report consumable by CI/reporting systems.
 *
 * Process model: the per-worker `healing-events-<pid>.jsonl` files are written
 * in the WORKER processes (by FileReportSink) at heal time. This reporter runs
 * in the MAIN process and, in `onEnd`, reads and merges all those files into a
 * single `healing-report.json`. That is the correct division — we never try to
 * read worker memory from the main process.
 *
 * Register it in playwright.config.ts:
 *   reporter: [['self-healing-playwright/reporter', { outputDir: '.healing' }]]
 *
 * The report structure:
 *   {
 *     generatedAt, summary: { total, success, healingFailed, notAttempted },
 *     events: HealingReportEntry[]
 *   }
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import * as path from 'path';
import { HealingOutcome, HealingReportEntry } from '../core/types';

export interface HealingReporterOptions {
    /** Directory holding the per-worker event files and the final report. */
    outputDir?: string;
    /** File name for the aggregated report. Defaults to 'healing-report.json'. */
    reportFile?: string;
}

export interface HealingReport {
    generatedAt: string;
    summary: {
        total: number;
        success: number;
        healingFailed: number;
        notAttempted: number;
    };
    events: HealingReportEntry[];
}

/**
 * Minimal Playwright Reporter interface (structural typing — we do not import
 * the Reporter type to keep the dependency light; Playwright calls onEnd()).
 */
export default class HealingReporter {
    private readonly outputDir: string;
    private readonly reportFile: string;

    constructor(options: HealingReporterOptions = {}) {
        this.outputDir = options.outputDir ?? '.healing';
        this.reportFile = options.reportFile ?? 'healing-report.json';
    }

    /** Called by Playwright after the whole run. Merges worker files. */
    async onEnd(): Promise<void> {
        try {
            const events = this.readAllEvents();
            const report = buildReport(events);
            const dir = path.resolve(this.outputDir);
            if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
            writeFileSync(path.join(dir, this.reportFile), `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
        } catch {
            // A reporting failure must never fail the run.
        }
    }

    /** Read and parse every per-worker JSONL file in the output dir. */
    private readAllEvents(): HealingReportEntry[] {
        const dir = path.resolve(this.outputDir);
        if (!existsSync(dir)) return [];
        const files = readdirSync(dir).filter((f) => /^healing-events-\d+\.jsonl$/.test(f));
        const events: HealingReportEntry[] = [];
        for (const file of files) {
            events.push(...parseJsonl(path.join(dir, file)));
        }
        return events;
    }
}

/** Aggregate events into the structured report shape. */
export function buildReport(events: HealingReportEntry[]): HealingReport {
    const summary = {
        total: events.length,
        success: events.filter((e) => e.outcome === HealingOutcome.SUCCESS).length,
        healingFailed: events.filter((e) => e.outcome === HealingOutcome.HEALING_FAILED).length,
        notAttempted: events.filter((e) => e.outcome === HealingOutcome.NOT_ATTEMPTED).length,
    };
    return { generatedAt: new Date().toISOString(), summary, events };
}

/** Parse a JSONL file into entries, skipping any unparseable line. */
export function parseJsonl(filePath: string): HealingReportEntry[] {
    try {
        const content = readFileSync(filePath, 'utf-8');
        const entries: HealingReportEntry[] = [];
        for (const line of content.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
                entries.push(JSON.parse(trimmed) as HealingReportEntry);
            } catch {
                // Skip a corrupt/partial line rather than losing the whole file.
            }
        }
        return entries;
    } catch {
        return [];
    }
}
