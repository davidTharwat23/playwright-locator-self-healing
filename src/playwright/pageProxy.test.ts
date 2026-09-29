import { describe, it, expect } from 'vitest';
import { wrapPage, describeConstruction } from './pageProxy';
import { passthroughHook } from './healingHook';
import type { FailedActionContext, HealingHook } from './healingHook';
import { makeFakePage, asPage } from '../../tests/fakes';

describe('wrapPage', () => {
    it('returns guarded locators from factory methods', async () => {
        const page = makeFakePage();
        const wrapped = wrapPage(asPage(page), { hook: passthroughHook });
        const loc = wrapped.getByTestId('login-button');
        const res = await loc.click();
        expect(res).toBe('click:ok');
        expect(page.factoryCalls[0]).toEqual({ method: 'getByTestId', args: ['login-button'] });
    });

    it('captures the construction descriptor and hands it to the hook on failure', async () => {
        const page = makeFakePage();
        let captured: FailedActionContext | undefined;
        const hook: HealingHook = {
            async onActionFailed(c) {
                captured = c;
                throw c.error;
            },
        };
        const wrapped = wrapPage(asPage(page), { hook });
        // Make the produced locator's click fail.
        const loc = wrapped.getByTestId('login-button');
        (page.lastReturned as unknown as { click: () => Promise<never> }).click = () =>
            Promise.reject(new Error('nope'));

        await expect(loc.click()).rejects.toThrow('nope');
        expect(captured?.descriptor).toEqual({
            method: 'getByTestId',
            primaryArg: 'login-button',
            options: undefined,
        });
    });

    it('passes non-factory methods and properties straight through', async () => {
        const page = makeFakePage();
        const wrapped = wrapPage(asPage(page), { hook: passthroughHook });
        expect(await wrapped.title()).toBe('fake-title');
        expect(wrapped.url()).toBe('https://fake.test/');
    });
});

describe('describeConstruction', () => {
    it('records method, primary arg, and options', () => {
        const d = describeConstruction('getByRole', ['button', { name: 'Login' }]);
        expect(d).toEqual({ method: 'getByRole', primaryArg: 'button', options: { name: 'Login' } });
    });

    it('stringifies a RegExp primary arg', () => {
        const d = describeConstruction('getByText', [/hello/i]);
        expect(d.primaryArg).toBe('/hello/i');
    });

    it('handles a missing primary arg', () => {
        const d = describeConstruction('locator', []);
        expect(d.primaryArg).toBe('');
    });
});
