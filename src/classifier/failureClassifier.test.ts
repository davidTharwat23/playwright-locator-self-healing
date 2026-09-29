import { describe, it, expect } from 'vitest';
import { classifyFailure } from './failureClassifier';
import { FailureClassification } from '../core/types';

const LOCATOR = FailureClassification.LOCATOR_FAILURE;
const E2E = FailureClassification.E2E_FLOW_FAILURE;

function classify(message: string, action = 'click') {
    return classifyFailure({ error: new Error(message), action }).classification;
}

describe('classifyFailure — locator failures (may heal)', () => {
    it('classifies a Playwright locator timeout as LOCATOR_FAILURE', () => {
        const msg =
            'locator.click: Timeout 20000ms exceeded.\n' +
            'Call log:\n  - waiting for locator(\'[data-testid="login-button"]\')';
        expect(classify(msg)).toBe(LOCATOR);
    });

    it('classifies a getByTestId resolution timeout as LOCATOR_FAILURE', () => {
        const msg =
            'locator.click: Timeout 20000ms exceeded.\n' +
            'Call log:\n  - waiting for getByTestId(\'login-button\')';
        expect(classify(msg)).toBe(LOCATOR);
    });

    it('classifies "element not found" as LOCATOR_FAILURE', () => {
        expect(classify('Error: element not found for selector #login')).toBe(LOCATOR);
    });

    it('classifies "no element matches selector" as LOCATOR_FAILURE', () => {
        expect(classify('no element matches selector [data-testid="x"]')).toBe(LOCATOR);
    });
});

describe('classifyFailure — E2E/business failures (never heal)', () => {
    it('classifies an assertion (expect) failure as E2E_FLOW_FAILURE', () => {
        const msg = 'Error: expect(received).toHaveText(expected)\n\nExpected: "Welcome"\nReceived: "Error"';
        expect(classify(msg)).toBe(E2E);
    });

    it('classifies a toBeVisible assertion timeout as E2E, not locator', () => {
        const msg =
            'expect.soft(locator).toBeVisible() failed\n' +
            'Call log:\n  - waiting for locator(\'.banner\')';
        // Even though it mentions "waiting for locator", the expect() signature
        // is checked first and wins — assertions are never healed.
        expect(classify(msg)).toBe(E2E);
    });

    it('classifies an HTTP 500 as E2E_FLOW_FAILURE', () => {
        expect(classify('Request failed with status code 500')).toBe(E2E);
    });

    it('classifies "Expected response 200 but received 403" as E2E_FLOW_FAILURE', () => {
        expect(classify('Expected response 200 but received 403')).toBe(E2E);
    });

    it('classifies an auth failure as E2E_FLOW_FAILURE', () => {
        expect(classify('User is not authenticated')).toBe(E2E);
        expect(classify('401 Unauthorized')).toBe(E2E);
    });

    it('classifies a disabled/intercepted element as E2E (found but not actionable)', () => {
        expect(classify('element is not enabled')).toBe(E2E);
        expect(
            classify('<button> intercepts pointer events'),
        ).toBe(E2E);
    });

    it('classifies strict mode violation as E2E (ambiguous, unsafe to heal)', () => {
        const msg =
            'locator.click: Error: strict mode violation: locator(\'button\') resolved to 3 elements';
        expect(classify(msg)).toBe(E2E);
    });
});

describe('classifyFailure — unrecognised defaults to safe', () => {
    it('defaults an unknown error to E2E_FLOW_FAILURE', () => {
        expect(classify('Something completely unexpected happened')).toBe(E2E);
    });

    it('defaults a thrown string to E2E_FLOW_FAILURE', () => {
        expect(classifyFailure({ error: 'weird', action: 'click' }).classification).toBe(E2E);
    });

    it('defaults undefined/null errors to E2E_FLOW_FAILURE', () => {
        expect(classifyFailure({ error: undefined, action: 'click' }).classification).toBe(E2E);
        expect(classifyFailure({ error: null, action: 'click' }).classification).toBe(E2E);
    });

    it('handles a non-Error object with a message field', () => {
        expect(
            classifyFailure({ error: { message: 'element not found' }, action: 'click' }).classification,
        ).toBe(LOCATOR);
    });
});

describe('classifyFailure — always returns a reason', () => {
    it('provides a non-empty reason for every classification', () => {
        const cases = [
            new Error('waiting for locator(\'#x\')'),
            new Error('expect(x).toBe(y)'),
            new Error('mystery'),
        ];
        for (const error of cases) {
            const result = classifyFailure({ error, action: 'click' });
            expect(result.reason.length).toBeGreaterThan(0);
        }
    });
});
