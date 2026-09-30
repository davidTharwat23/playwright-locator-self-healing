/**
 * Regression tests for ISSUE.md Bug 1.
 *
 * A guarded locator must NOT be a Proxy and must keep the real locator's
 * identity and brand, so Playwright's `expect(locator)` receiver guard
 * (`typeof x === 'object' && types.includes(x._apiName)`, and any
 * prototype-based `instanceof Locator` check) still passes. These tests assert
 * that at the object-identity level without needing a browser; the end-to-end
 * `expect()` proof lives in tests/e2e/expect-bug.spec.ts.
 */

import { describe, it, expect } from 'vitest';
import { wrapLocator } from './locatorProxy';
import { passthroughHook } from './healingHook';
import { asPage, makeFakePage } from '../../tests/fakes';

const descriptor = { method: 'locator', primaryArg: '#x' };

/**
 * A locator-shaped fake with the members Playwright's expect guard reads:
 * `_apiName === 'Locator'` and the terminal/chaining action methods. Built on
 * a class so `instanceof` and prototype delegation are meaningful.
 */
class FakeBrandedLocator {
    _apiName = 'Locator';
    _selector = '#x';
    click(): Promise<string> {
        return Promise.resolve('click:ok');
    }
    waitFor(): Promise<void> {
        return Promise.resolve();
    }
    filter(): FakeBrandedLocator {
        return new FakeBrandedLocator();
    }
    // A prototype method that reads private-ish state via `this`, to prove the
    // guarded object delegates correctly to the real instance for pass-through.
    _expect(): string {
        return this._selector;
    }
}

function wrap(loc: FakeBrandedLocator) {
    return wrapLocator(loc as never, { page: asPage(makeFakePage()), hook: passthroughHook, descriptor });
}

describe('Bug 1 — guarded locator preserves identity and brand', () => {
    it('is not a Proxy: the real locator is its prototype', () => {
        const real = new FakeBrandedLocator();
        const guarded = wrap(real);
        // Prototype delegation (Object.create) rather than Proxy wrapping.
        expect(Object.getPrototypeOf(guarded)).toBe(real);
    });

    it('passes the expect() receiver guard (_apiName resolves to "Locator")', () => {
        const guarded = wrap(new FakeBrandedLocator());
        // This is exactly what playwright/lib/util.js expectTypes checks.
        expect(typeof guarded).toBe('object');
        expect((guarded as unknown as { _apiName: string })._apiName).toBe('Locator');
    });

    it('satisfies instanceof against the real Locator constructor', () => {
        const guarded = wrap(new FakeBrandedLocator());
        expect(guarded instanceof FakeBrandedLocator).toBe(true);
    });

    it('delegates pass-through methods to the real instance with correct `this`', () => {
        const guarded = wrap(new FakeBrandedLocator());
        // _expect reads this._selector; must resolve via the prototype instance.
        expect((guarded as unknown as { _expect: () => string })._expect()).toBe('#x');
    });

    it('still guards terminal actions (identity fix does not remove healing)', async () => {
        const boom = new Error('element not found');
        const real = new FakeBrandedLocator();
        real.click = () => Promise.reject(boom);
        let consulted = false;
        const guarded = wrapLocator(real as never, {
            page: asPage(makeFakePage()),
            hook: {
                async onActionFailed(c) {
                    consulted = true;
                    throw c.error;
                },
            },
            descriptor,
        });
        await expect((guarded as unknown as { click: () => Promise<unknown> }).click()).rejects.toBe(boom);
        expect(consulted).toBe(true);
    });
});
