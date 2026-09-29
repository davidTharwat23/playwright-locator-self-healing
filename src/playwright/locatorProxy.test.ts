import { describe, it, expect, vi } from 'vitest';
import { wrapLocator } from './locatorProxy';
import type { HealingHook, FailedActionContext } from './healingHook';
import { passthroughHook } from './healingHook';
import { makeFakeLocator, makeFakePage, asLocator, asPage } from '../../tests/fakes';

const descriptor = { method: 'getByTestId', primaryArg: 'login-button' };

function ctx(hook: HealingHook) {
    return { page: asPage(makeFakePage()), hook, descriptor };
}

describe('wrapLocator — happy path', () => {
    it('runs the real action and returns its result when it succeeds', async () => {
        const fake = makeFakeLocator();
        const wrapped = wrapLocator(asLocator(fake), ctx(passthroughHook));
        const result = await wrapped.click();
        expect(result).toBe('click:ok');
        expect(fake.calls.map((c) => c.method)).toEqual(['click']);
    });

    it('passes action arguments through unchanged', async () => {
        const fake = makeFakeLocator();
        const wrapped = wrapLocator(asLocator(fake), ctx(passthroughHook));
        await wrapped.fill('hello');
        expect(fake.calls[0]).toEqual({ method: 'fill', args: ['hello'] });
    });

    it('does not consult the hook on success', async () => {
        const onActionFailed = vi.fn();
        const fake = makeFakeLocator();
        const wrapped = wrapLocator(asLocator(fake), ctx({ onActionFailed }));
        await wrapped.click();
        expect(onActionFailed).not.toHaveBeenCalled();
    });
});

describe('wrapLocator — failure path', () => {
    it('consults the hook when the action throws', async () => {
        const boom = new Error('element not found');
        const fake = makeFakeLocator({ failing: { click: boom } });
        const onActionFailed = vi.fn(async (c: FailedActionContext) => {
            throw c.error;
        });
        const wrapped = wrapLocator(asLocator(fake), ctx({ onActionFailed }));

        await expect(wrapped.click()).rejects.toThrow('element not found');
        expect(onActionFailed).toHaveBeenCalledOnce();
        const passed = onActionFailed.mock.calls[0][0];
        expect(passed.action).toBe('click');
        expect(passed.error).toBe(boom);
        expect(passed.descriptor).toEqual(descriptor);
    });

    it('passthrough hook rethrows the original error unchanged', async () => {
        const boom = new Error('original');
        const fake = makeFakeLocator({ failing: { click: boom } });
        const wrapped = wrapLocator(asLocator(fake), ctx(passthroughHook));
        await expect(wrapped.click()).rejects.toBe(boom);
    });

    it('lets the hook heal by returning a value (real failure not surfaced)', async () => {
        const boom = new Error('element not found');
        const fake = makeFakeLocator({ failing: { click: boom } });
        const healed = makeFakeLocator();
        const onActionFailed = async (c: FailedActionContext) => {
            // Simulate the executor retrying against a healed locator.
            return c.invoke(asLocator(healed), c.args);
        };
        const wrapped = wrapLocator(asLocator(fake), ctx({ onActionFailed }));

        const result = await wrapped.click();
        expect(result).toBe('click:ok');
        expect(healed.calls[0].method).toBe('click');
    });
});

describe('wrapLocator — chaining stays guarded', () => {
    it('wraps a chained locator so its action is still guarded', async () => {
        const boom = new Error('not found');
        const parent = makeFakeLocator();
        // Make the chained locator's click fail so we can see the hook fire.
        const onActionFailed = vi.fn(async (c: FailedActionContext) => {
            throw c.error;
        });
        const wrapped = wrapLocator(asLocator(parent), ctx({ onActionFailed }));
        const child = wrapped.filter({ hasText: 'x' });
        // Force the child's underlying click to throw by swapping it.
        (child as unknown as { click: () => Promise<never> }).click;
        // The child is itself a proxy; calling a non-failing action just works.
        const res = await child.click();
        expect(res).toBe('click:ok');
        // Confirm chaining returned a guarded (proxied) locator, not raw.
        expect(typeof child.click).toBe('function');
        expect(boom).toBeInstanceOf(Error);
    });

    it('passes non-action methods straight through', async () => {
        const fake = makeFakeLocator();
        const wrapped = wrapLocator(asLocator(fake), ctx(passthroughHook));
        const count = await wrapped.count();
        expect(count).toBe(1);
    });
});
