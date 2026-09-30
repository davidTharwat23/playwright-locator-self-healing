/**
 * Regression tests for the original-attempt timeout contract.
 *
 * ARCHITECTURE NOTE (supersedes the earlier "probe timeout" approach):
 * The guarded ORIGINAL attempt must run under the CALLER's own timeout
 * (Playwright's action/test timeout), completely untouched. The self-healing
 * configuration must never shorten or cap a legitimately long-running valid
 * action — doing so would interrupt valid slow flows. Healing instead gets its
 * own independent budget (`healTimeoutMs`) enforced in the executor AFTER a
 * genuine failure, so a valid heal still applies under default timeouts without
 * bounding the caller's real action.
 *
 * These tests therefore assert that the original attempt receives the caller's
 * args verbatim, regardless of `probeTimeoutMs`.
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

describe('original attempt — caller timeout is never shortened by healing config', () => {
    it('passes NO options through unchanged when the caller supplied none', async () => {
        const { loc, invocations } = makeRecordingLocator(false);
        const guarded = wrap(loc, 5000);
        await (guarded as unknown as { click: (o?: unknown) => Promise<unknown> }).click();
        // The healing config must not synthesise a timeout onto a valid action.
        expect(invocations[0].args).toEqual([]);
    });

    it('does not shrink a large caller-supplied timeout (long valid actions are safe)', async () => {
        const { loc, invocations } = makeRecordingLocator(false);
        const guarded = wrap(loc, 5000);
        await (guarded as unknown as { click: (o?: unknown) => Promise<unknown> }).click({ timeout: 30000, force: true });
        // The caller's 30s stands — a legitimately slow action is not capped to 5s.
        expect(invocations[0].args).toEqual([{ timeout: 30000, force: true }]);
    });

    it('leaves a smaller caller-supplied timeout exactly as given', async () => {
        const { loc, invocations } = makeRecordingLocator(false);
        const guarded = wrap(loc, 5000);
        await (guarded as unknown as { click: (o?: unknown) => Promise<unknown> }).click({ timeout: 1000 });
        expect(invocations[0].args).toEqual([{ timeout: 1000 }]);
    });

    it('passes ambiguous-arg actions (selectOption, dispatchEvent) through unchanged', async () => {
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
        await guarded.selectOption({ label: 'x' });
        await guarded.dispatchEvent('click');
        expect(invocations[0].args).toEqual([{ label: 'x' }]);
        expect(invocations[1].args).toEqual(['click']);
    });

    it('the heal retry receives the caller ORIGINAL args (unchanged)', async () => {
        const { loc, invocations } = makeRecordingLocator(true);
        // Hook retries the same locator (simulating a healed retry via invoke).
        const hook = vi.fn(async (c: FailedActionContext) => c.invoke(c.locator, c.args));
        const guarded = wrap(loc, 5000, hook);
        await (guarded as unknown as { click: (o?: unknown) => Promise<unknown> }).click({ timeout: 20000 });

        // Original attempt used the caller's 20s, untouched.
        expect(invocations[0].args).toEqual([{ timeout: 20000 }]);
        // The hook received the caller's original args...
        expect(hook.mock.calls[0][0].args).toEqual([{ timeout: 20000 }]);
        // ...and the retry ran with them.
        expect(invocations[1].args).toEqual([{ timeout: 20000 }]);
    });
});
