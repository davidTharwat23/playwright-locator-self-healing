import { describe, it, expect, vi } from 'vitest';
import type { Locator, Page } from '@playwright/test';
import { createHealingExecutor, HistoryPort, ReportSink } from './executor';
import { resolveConfig } from '../config/config';
import { HealingLogger } from '../logging/logger';
import { HealingOutcome, HealingReportEntry, SnapshotElementForTest } from './executor.testtypes';
import type { FailedActionContext } from '../playwright/healingHook';

/**
 * We drive the executor with:
 *  - a fake page whose evaluate() returns a canned DOM snapshot,
 *  - an injected buildLocator returning a fake healed locator,
 *  - an injected countVisible controlling the uniqueness gate.
 */

function makeDeps(overrides: {
    snapshot?: SnapshotElementForTest[];
    countVisible?: (page: Page, selector: string) => Promise<number>;
    buildLocator?: (page: Page, selector: string) => Locator;
    history?: HistoryPort;
    report?: ReportSink;
    retryCount?: number;
    confidenceThreshold?: number;
}) {
    const logs: string[] = [];
    const logger = new HealingLogger({
        enabled: true,
        sink: { info: (m) => logs.push(`INFO ${m}`), warn: (m) => logs.push(`WARN ${m}`) },
    });
    const config = resolveConfig({
        enabled: true,
        retryCount: overrides.retryCount ?? 1,
        confidenceThreshold: overrides.confidenceThreshold ?? 0.85,
    });
    const deps = {
        config,
        logger,
        report: overrides.report,
        history: overrides.history,
        buildLocator: overrides.buildLocator ?? (() => ({}) as Locator),
        countVisible: overrides.countVisible ?? (async () => 1),
    };
    return { deps, logs };
}

function fakePage(snapshot: SnapshotElementForTest[]): Page {
    return { evaluate: async () => snapshot } as unknown as Page;
}

function ctx(params: {
    page: Page;
    action?: string;
    error: unknown;
    invoke?: (target: Locator, args: unknown[]) => Promise<unknown>;
    descriptorMethod?: string;
    descriptorArg?: string;
}): FailedActionContext {
    return {
        page: params.page,
        locator: {} as Locator,
        descriptor: {
            method: params.descriptorMethod ?? 'getByTestId',
            primaryArg: params.descriptorArg ?? 'login-button',
        },
        action: params.action ?? 'click',
        args: [],
        error: params.error,
        invoke: params.invoke ?? (async () => 'invoked:ok'),
    };
}

const locatorError = new Error("locator.click: Timeout 20000ms exceeded.\nwaiting for locator('[data-testid=\"login-button\"]')");

describe('executor — classification gate', () => {
    it('rethrows and does not heal a non-locator (assertion) failure', async () => {
        const { deps } = makeDeps({});
        const executor = createHealingExecutor(deps);
        const assertionError = new Error('expect(received).toHaveText(expected)');
        const invoke = vi.fn(async () => 'should-not-run');

        await expect(
            executor.onActionFailed(ctx({ page: fakePage([]), error: assertionError, invoke })),
        ).rejects.toBe(assertionError);
        expect(invoke).not.toHaveBeenCalled();
    });
});

describe('executor — successful heal', () => {
    it('heals onto a unique high-confidence candidate and retries the real action', async () => {
        const snapshot: SnapshotElementForTest[] = [
            { index: 0, visible: true, testId: 'login-button', tag: 'button' },
        ];
        const invoke = vi.fn(async () => 'clicked-healed');
        const { deps, logs } = makeDeps({ snapshot, countVisible: async () => 1 });
        const executor = createHealingExecutor(deps);

        const result = await executor.onActionFailed(ctx({ page: fakePage(snapshot), error: locatorError, invoke }));

        expect(result).toBe('clicked-healed');
        expect(invoke).toHaveBeenCalledOnce();
        expect(logs.some((l) => l.includes('SUCCESS'))).toBe(true);
    });

    it('remembers a successful heal in history', async () => {
        const snapshot: SnapshotElementForTest[] = [{ index: 0, visible: true, testId: 'login-button' }];
        const remember = vi.fn();
        const history: HistoryPort = { lookup: () => undefined, remember };
        const { deps } = makeDeps({ snapshot, history });
        const executor = createHealingExecutor(deps);

        await executor.onActionFailed(ctx({ page: fakePage(snapshot), error: locatorError }));
        expect(remember).toHaveBeenCalledWith('getByTestId:login-button', '[data-testid="login-button"]');
    });
});

describe('executor — healing refused', () => {
    it('rethrows the ORIGINAL error when no candidate passes the gate', async () => {
        // Snapshot has an unrelated element only.
        const snapshot: SnapshotElementForTest[] = [{ index: 0, visible: true, testId: 'unrelated' }];
        const invoke = vi.fn();
        const { deps, logs } = makeDeps({ snapshot, countVisible: async () => 1 });
        const executor = createHealingExecutor(deps);

        await expect(
            executor.onActionFailed(ctx({ page: fakePage(snapshot), error: locatorError, invoke })),
        ).rejects.toBe(locatorError);
        expect(invoke).not.toHaveBeenCalled();
        expect(logs.some((l) => l.includes('HEALING_FAILED'))).toBe(true);
    });

    it('rethrows the ORIGINAL error when the candidate is not unique', async () => {
        const snapshot: SnapshotElementForTest[] = [{ index: 0, visible: true, testId: 'login-button' }];
        const { deps } = makeDeps({ snapshot, countVisible: async () => 2 });
        const executor = createHealingExecutor(deps);
        await expect(
            executor.onActionFailed(ctx({ page: fakePage(snapshot), error: locatorError })),
        ).rejects.toBe(locatorError);
    });

    it('rethrows the ORIGINAL error when the gate passes but the retried action fails', async () => {
        const snapshot: SnapshotElementForTest[] = [{ index: 0, visible: true, testId: 'login-button' }];
        const retryError = new Error('healed element also unclickable');
        const invoke = vi.fn(async () => {
            throw retryError;
        });
        const { deps } = makeDeps({ snapshot, retryCount: 2 });
        const executor = createHealingExecutor(deps);

        await expect(
            executor.onActionFailed(ctx({ page: fakePage(snapshot), error: locatorError, invoke })),
        ).rejects.toBe(locatorError);
        // retryCount=2 → two attempts.
        expect(invoke).toHaveBeenCalledTimes(2);
    });
});

describe('executor — history bias', () => {
    it('uses a historical selector when it is the only confident, unique candidate', async () => {
        // DOM offers no directly-matching candidate (unrelated element only), so
        // the historical selector (scored with the original intent) is the sole
        // confident candidate. History is a hint, not an override — it still had
        // to clear the threshold and uniqueness gate to be used here.
        const snapshot: SnapshotElementForTest[] = [{ index: 0, visible: true, testId: 'unrelated' }];
        const seen: string[] = [];
        const countVisible = async (_p: Page, selector: string) => {
            seen.push(selector);
            return 1;
        };
        const invoke = vi.fn(async () => 'clicked-historical');
        const history: HistoryPort = { lookup: () => 'role=button[name="Login"]', remember: () => {} };
        const { deps } = makeDeps({ snapshot, countVisible, history });
        const executor = createHealingExecutor(deps);

        const result = await executor.onActionFailed(
            ctx({ page: fakePage(snapshot), error: locatorError, invoke }),
        );
        expect(result).toBe('clicked-historical');
        expect(seen).toContain('role=button[name="Login"]');
    });

    it('does NOT let history override the ambiguity gate (history is a hint, not a bypass)', async () => {
        // Both a historical selector and a DOM candidate score 1.0 for the same
        // intent but are different selectors → ambiguous → refuse to heal.
        const snapshot: SnapshotElementForTest[] = [{ index: 0, visible: true, testId: 'login-button' }];
        const history: HistoryPort = { lookup: () => 'role=button[name="Login"]', remember: () => {} };
        const { deps } = makeDeps({ snapshot, countVisible: async () => 1, history });
        const executor = createHealingExecutor(deps);

        await expect(
            executor.onActionFailed(ctx({ page: fakePage(snapshot), error: locatorError })),
        ).rejects.toBe(locatorError);
    });
});

describe('executor — report sink', () => {
    it('emits a SUCCESS entry with the healed selector and confidence', async () => {
        const snapshot: SnapshotElementForTest[] = [{ index: 0, visible: true, testId: 'login-button' }];
        const entries: HealingReportEntry[] = [];
        const report: ReportSink = { record: (e) => entries.push(e) };
        const { deps } = makeDeps({ snapshot, report });
        const executor = createHealingExecutor(deps);

        await executor.onActionFailed(ctx({ page: fakePage(snapshot), error: locatorError }));
        expect(entries).toHaveLength(1);
        expect(entries[0].outcome).toBe(HealingOutcome.SUCCESS);
        expect(entries[0].healedSelector).toBe('[data-testid="login-button"]');
        expect(entries[0].originalError).toContain('Timeout');
    });

    it('emits a NOT_ATTEMPTED entry for a non-locator failure', async () => {
        const entries: HealingReportEntry[] = [];
        const report: ReportSink = { record: (e) => entries.push(e) };
        const { deps } = makeDeps({ report });
        const executor = createHealingExecutor(deps);

        await expect(
            executor.onActionFailed(ctx({ page: fakePage([]), error: new Error('expect(x).toBe(y)') })),
        ).rejects.toBeInstanceOf(Error);
        expect(entries[0].outcome).toBe(HealingOutcome.NOT_ATTEMPTED);
    });
});
