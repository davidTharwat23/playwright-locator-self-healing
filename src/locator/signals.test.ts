import { describe, it, expect } from 'vitest';
import { signalsFromConstruction, signalsFromCssSelector } from './signals';

describe('signalsFromConstruction', () => {
    it('maps getByTestId to a testId signal', () => {
        expect(signalsFromConstruction({ method: 'getByTestId', primaryArg: 'login-button' })).toEqual({
            testId: 'login-button',
        });
    });

    it('maps getByRole with a name option to role + accessibleName', () => {
        expect(
            signalsFromConstruction({ method: 'getByRole', primaryArg: 'button', options: { name: 'Login' } }),
        ).toEqual({ role: 'button', accessibleName: 'Login' });
    });

    it('reads a RegExp name option via its source', () => {
        const signals = signalsFromConstruction({
            method: 'getByRole',
            primaryArg: 'button',
            options: { name: /log ?in/i },
        });
        expect(signals.role).toBe('button');
        expect(signals.accessibleName).toBe('log ?in');
    });

    it('maps getByPlaceholder and getByLabel and getByText', () => {
        expect(signalsFromConstruction({ method: 'getByPlaceholder', primaryArg: 'Email' })).toEqual({
            placeholder: 'Email',
        });
        expect(signalsFromConstruction({ method: 'getByLabel', primaryArg: 'Password' })).toEqual({
            label: 'Password',
        });
        expect(signalsFromConstruction({ method: 'getByText', primaryArg: 'Submit' })).toEqual({
            text: 'Submit',
        });
    });
});

describe('signalsFromCssSelector (via locator())', () => {
    it('parses an id selector', () => {
        expect(signalsFromCssSelector('#submit')).toEqual({ id: 'submit' });
    });

    it('parses a data-testid attribute selector', () => {
        expect(signalsFromCssSelector('[data-testid="login-button"]').testId).toBe('login-button');
    });

    it('parses tag + type', () => {
        const s = signalsFromCssSelector('input[type="email"]');
        expect(s.tag).toBe('input');
        expect(s.type).toBe('email');
    });

    it('parses placeholder and aria-label', () => {
        expect(signalsFromCssSelector('[placeholder="Search"]').placeholder).toBe('Search');
        expect(signalsFromCssSelector('[aria-label="Close"]').accessibleName).toBe('Close');
    });

    it('returns empty signals for an unparseable selector', () => {
        expect(signalsFromCssSelector('')).toEqual({});
        expect(signalsFromCssSelector('   ')).toEqual({});
    });

    it('routes locator() construction through the CSS parser', () => {
        expect(signalsFromConstruction({ method: 'locator', primaryArg: '#email' })).toEqual({ id: 'email' });
    });
});
