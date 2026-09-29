import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import HealingReporter, { buildReport, parseJsonl } from './reporter';
import { FileReportSink } from './fileReportSink';
import { HealingOutcome, HealingReportEntry, FailureClassification } from '../core/types';

let dir: string;

beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'heal-report-'));
});
afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
});

function entry(overrides: Partial<HealingReportEntry>): HealingReportEntry {
    return {
        timestamp: new Date().toISOString(),
        locatorKey: 'getByTestId:x',
        originalSelector: 'getByTestId(x)',
        action: 'click',
        classification: FailureClassification.LOCATOR_FAILURE,
        outcome: HealingOutcome.SUCCESS,
        originalError: 'boom',
        ...overrides,
    };
}

describe('buildReport', () => {
    it('summarises outcomes', () => {
        const report = buildReport([
            entry({ outcome: HealingOutcome.SUCCESS }),
            entry({ outcome: HealingOutcome.SUCCESS }),
            entry({ outcome: HealingOutcome.HEALING_FAILED }),
            entry({ outcome: HealingOutcome.NOT_ATTEMPTED, classification: FailureClassification.E2E_FLOW_FAILURE }),
        ]);
        expect(report.summary).toEqual({ total: 4, success: 2, healingFailed: 1, notAttempted: 1 });
        expect(report.events).toHaveLength(4);
    });
});

describe('parseJsonl', () => {
    it('parses valid lines and skips corrupt ones', () => {
        const file = path.join(dir, 'events.jsonl');
        writeFileSync(file, `${JSON.stringify(entry({}))}\nnot json\n${JSON.stringify(entry({ action: 'fill' }))}\n`);
        const parsed = parseJsonl(file);
        expect(parsed).toHaveLength(2);
        expect(parsed[1].action).toBe('fill');
    });

    it('returns [] for a missing file', () => {
        expect(parseJsonl(path.join(dir, 'nope.jsonl'))).toEqual([]);
    });
});

describe('FileReportSink + HealingReporter end-to-end (file level)', () => {
    it('writes per-worker events and the reporter merges them into a report', async () => {
        // Simulate two workers writing their own pid files by using the sink and
        // then a second hand-written file.
        const sink = new FileReportSink({ dir });
        sink.record(entry({ outcome: HealingOutcome.SUCCESS, action: 'click' }));
        sink.record(entry({ outcome: HealingOutcome.HEALING_FAILED, action: 'fill' }));

        // A second worker's file.
        writeFileSync(
            path.join(dir, 'healing-events-99999.jsonl'),
            `${JSON.stringify(entry({ outcome: HealingOutcome.NOT_ATTEMPTED }))}\n`,
        );

        const reporter = new HealingReporter({ outputDir: dir });
        await reporter.onEnd();

        const reportPath = path.join(dir, 'healing-report.json');
        expect(existsSync(reportPath)).toBe(true);
        const report = JSON.parse(readFileSync(reportPath, 'utf-8'));
        expect(report.summary.total).toBe(3);
        expect(report.summary.success).toBe(1);
        expect(report.summary.healingFailed).toBe(1);
        expect(report.summary.notAttempted).toBe(1);
    });

    it('reporter writes an empty report when there are no event files', async () => {
        const reporter = new HealingReporter({ outputDir: dir });
        await reporter.onEnd();
        const report = JSON.parse(readFileSync(path.join(dir, 'healing-report.json'), 'utf-8'));
        expect(report.summary.total).toBe(0);
        expect(report.events).toEqual([]);
    });
});
