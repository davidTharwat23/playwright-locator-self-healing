/**
 * Regression tests for the healing time-budget architecture.
 *
 * The contract: once the healing budget (`healTimeoutMs`) expires, healing must
 * stop and the ORIGINAL Playwright error must be rethrown promptly. No healing
 * operation — DOM snapshot, uniqueness probe (`countVisible`), or retry — may
 * continue to block past the budget.
 *
 * These are deterministic and browserless: slow operations are injected so we
 * can measure elapsed time precisely and assert the bound holds. They do not
 * use arbitrary sleeps to "pass" — the sleeps model a slow live page, and the
 * assertion is that healing returns within the budget despite them.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Locator, Page } from '@playwright/test';
import { createHealingExecutor } from './executor';
import { resolveConfig } from '../config/config';
import { HealingLogger } from '../logging/logger';
import type { SnapshotElementForTest } from './executor.testtypes';
import type { FailedActionContext } from '../playwright/healingHook';

const locatorError = new Error(
    "locator.click: Timeout 20000ms exceeded.\nwaiting for locator('[data-testid=\"login-button\"]')",
);

function silentLogger() {
    return new HealingLogger({ enabled: false, sink: { info: () => {}, warn: () => {} } });
}

function fakePage(snapshot: SnapshotElementForTest[], evaluateDelayMs = 0): Page {
    return {
        evaluate: async () => {
            if (evaluateDelayMs > 0) await sleep(evaluateDelayMs);
            return snapshot;
        },
    } as unknown as Page;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function ctx(params: {
    page: Page;
    error: unknown;
    invoke?: (t: Locator, a: unknown[]) => Promise<unknown>;
    action?: string;
    args?: unknown[];
}): FailedActionContext {
    return {
        page: params.page,
        locator: {} as Locator,
        descriptor: { method: 'getByTestId', primaryArg: 'login-button' },
        action: params.action ?? 'click',
        args: params.args ?? [],
        error: params.error,
        invoke: params.invoke ?? (async () => 'invoked:ok'),
    };
}

const snapshot: SnapshotElementForTest[] = [{ index: 0, visible: true, testId: 'login-button', tag: 'button' }];

describe('healing budget — the whole pipeline is bounded by healTimeoutMs', () => {
    it('rethrows the ORIGINAL error promptly when the uniqueness probe hangs', async () => {
        const healTimeoutMs = 1000;
        const deps = {
            config: resolveConfig({ enabled: true, healTimeoutMs }),
            logger: silentLogger(),
            buildLocator: () => ({}) as Locator,
            // A slow live page: each visibility probe takes 8s (models a busy DOM).
            countVisible: async () => {
                await sleep(8000);
                return 1;
            },
        };
        const executor = createHealingExecutor(deps);

        const started = Date.now();
        await expect(
            executor.onActionFailed(ctx({ page: fakePage(snapshot), error: locatorError })),
        ).rejects.toBe(locatorError);
        const elapsed = Date.now() - started;

        // Must return near the budget, not after the injected 8s probe.
        expect(elapsed).toBeLessThan(healTimeoutMs + 1500);
    });

    it('rethrows the ORIGINAL error promptly when the retry hangs', async () => {
        const healTimeoutMs = 1000;
        const invoke = vi.fn(async () => {
            // Models a healed retry that itself waits the full action timeout.
            await sleep(20000);
            return 'never';
        });
        const deps = {
            config: resolveConfig({ enabled: true, healTimeoutMs }),
            logger: silentLogger(),
            buildLocator: () => ({}) as Locator,
            countVisible: async () => 1,
        };
        const executor = createHealingExecutor(deps);

        const started = Date.now();
        await expect(
            executor.onActionFailed(ctx({ page: fakePage(snapshot), error: locatorError, invoke })),
        ).rejects.toBe(locatorError);
        const elapsed = Date.now() - started;

        expect(elapsed).toBeLessThan(healTimeoutMs + 1500);
    });

    it('rethrows the ORIGINAL error promptly when the DOM snapshot hangs', async () => {
        const healTimeoutMs = 1000;
        const deps = {
            config: resolveConfig({ enabled: true, healTimeoutMs }),
            logger: silentLogger(),
            buildLocator: () => ({}) as Locator,
            countVisible: async () => 1,
        };
        const executor = createHealingExecutor(deps);

        const started = Date.now();
        await expect(
            executor.onActionFailed(ctx({ page: fakePage(snapshot, 8000), error: locatorError })),
        ).rejects.toBe(locatorError);
        const elapsed = Date.now() - started;

        expect(elapsed).toBeLessThan(healTimeoutMs + 1500);
    });

    it('a fast successful heal within budget still returns the healed result', async () => {
        const healTimeoutMs = 3000;
        const invoke = vi.fn(async () => 'clicked-healed');
        const deps = {
            config: resolveConfig({ enabled: true, healTimeoutMs }),
            logger: silentLogger(),
            buildLocator: () => ({}) as Locator,
            countVisible: async () => 1,
        };
        const executor = createHealingExecutor(deps);

        const result = await executor.onActionFailed(
            ctx({ page: fakePage(snapshot), error: locatorError, invoke }),
        );
        expect(result).toBe('clicked-healed');
        expect(invoke).toHaveBeenCalledOnce();
    });
});
