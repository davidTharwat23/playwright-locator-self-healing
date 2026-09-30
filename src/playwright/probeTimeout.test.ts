/**
 * Regression tests for ISSUE.md Bug 2.
 *
 * The guard must give the healing work a real time budget by bounding the
 * ORIGINAL action attempt with an internal probe timeout, while the heal retry
 * still runs against the caller's ORIGINAL (untouched) args. These tests verify
 * that contract at the integration layer without a browser; the end-to-end,
 * default-timeout proof lives in tests/e2e/live-trace.spec.ts.
 */

import { describe, it, expect, vi } from 'vitest';
import { wrapLocator } from './locatorProxy';
import type { FailedActionContext } from './healingHook';
import { asPage, makeFakePage } from '../../tests/fakes';

const descriptor = { method: 'getByRole', primaryArg: 'button' };

/** A locator fake that records the exact args each action was invoked with. */
function makeRecordingLocator(failFirst: boolean) {
    const invocations: Array<{ method: string; args: unknown[] }> = [];
    let calls = 0;
    const loc = {
        _apiName: 'Locator',
        click(...args: unknown[]): Promise<string> {
            invocations.push({ method: 'click', args });
            calls += 1;
            if (failFirst && calls === 1) return Promise.reject(new Error('element not found'));
            return Promise.resolve('click:ok');
        },
        waitFor: () => Promise.resolve(),
    };
    return { loc, invocations };
}

function wrap(
    loc: unknown,
    probeTimeoutMs?: number,
    hookImpl?: (c: FailedActionContext) => Promise<unknown>,
) {
    return wrapLocator(loc as never, {
        page: asPage(makeFakePage()),
        hook: {
            onActionFailed:
                hookImpl ??
                (async (c: FailedActionContext) => {
                    throw c.error;
                }),
        },
        descriptor,
        probeTimeoutMs,
    });
}

describe('Bug 2 — bounded probe timeout for the original attempt', () => {
    it('injects the probe timeout into the original action when none was supplied', async () => {
        const { loc, invocations } = makeRecordingLocator(false);
        const guarded = wrap(loc, 5000);
        await (guarded as unknown as { click: (o?: unknown) => Promise<unknown> }).click();
        expect(invocations[0].args).toEqual([{ timeout: 5000 }]);
    });

    it('never widens a smaller caller-supplied timeout', async () => {
        const { loc, invocations } = makeRecordingLocator(false);
        const guarded = wrap(loc, 5000);
        await (guarded as unknown as { click: (o?: unknown) => Promise<unknown> }).click({ timeout: 1000 });
        // Caller's tighter budget is respected, not overwritten.
        expect(invocations[0].args).toEqual([{ timeout: 1000 }]);
    });

    it('caps a larger caller-supplied timeout down to the probe budget', async () => {
        const { loc, invocations } = makeRecordingLocator(false);
        const guarded = wrap(loc, 5000);
        await (guarded as unknown as { click: (o?: unknown) => Promise<unknown> }).click({ timeout: 30000, force: true });
        expect(invocations[0].args).toEqual([{ timeout: 5000, force: true }]);
    });

    it('does nothing when probeTimeoutMs is 0 (bounded probe disabled)', async () => {
        const { loc, invocations } = makeRecordingLocator(false);
        const guarded = wrap(loc, 0);
        await (guarded as unknown as { click: (o?: unknown) => Promise<unknown> }).click({ timeout: 30000 });
        expect(invocations[0].args).toEqual([{ timeout: 30000 }]);
    });

    it('does not inject into actions whose object arg is ambiguous (selectOption, dispatchEvent)', async () => {
        const invocations: Array<{ method: string; args: unknown[] }> = [];
        const loc = {
            _apiName: 'Locator',
            selectOption(...args: unknown[]): Promise<string[]> {
                invocations.push({ method: 'selectOption', args });
                return Promise.resolve([]);
            },
            dispatchEvent(...args: unknown[]): Promise<void> {
                invocations.push({ method: 'dispatchEvent', args });
                return Promise.resolve();
            },
            waitFor: () => Promise.resolve(),
        };
        const guarded = wrap(loc, 5000) as unknown as {
            selectOption: (v: unknown) => Promise<unknown>;
            dispatchEvent: (t: string) => Promise<unknown>;
        };
        // A plain-object `values` arg must not be mutated with a timeout.
        await guarded.selectOption({ label: 'x' });
        // dispatchEvent's 2nd arg is eventInit, not options — leave it alone.
        await guarded.dispatchEvent('click');
        expect(invocations[0].args).toEqual([{ label: 'x' }]);
        expect(invocations[1].args).toEqual(['click']);
    });

    it('the heal retry uses the caller ORIGINAL args, not the bounded probe args', async () => {
        const { loc, invocations } = makeRecordingLocator(true);
        // Hook retries the same locator (simulating a healed retry via invoke).
        const hook = vi.fn(async (c: FailedActionContext) => c.invoke(c.locator, c.args));
        const guarded = wrap(loc, 5000, hook);
        // Caller passes an explicit large timeout; probe caps the FIRST attempt.
        await (guarded as unknown as { click: (o?: unknown) => Promise<unknown> }).click({ timeout: 20000 });

        // First (probe) attempt was capped to 5000...
        expect(invocations[0].args).toEqual([{ timeout: 5000 }]);
        // ...the hook received the ORIGINAL args (20000)...
        expect(hook.mock.calls[0][0].args).toEqual([{ timeout: 20000 }]);
        // ...and the retry ran with those original args.
        expect(invocations[1].args).toEqual([{ timeout: 20000 }]);
    });
});
