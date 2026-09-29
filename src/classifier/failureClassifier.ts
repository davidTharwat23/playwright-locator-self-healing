/**
 * Failure classifier — the safety gate that decides whether a failure is a
 * broken locator (which may be healed) or a real E2E/business-flow failure
 * (which must never be healed).
 *
 * Design: CONSERVATIVE ALLOWLIST. We only return LOCATOR_FAILURE when the error
 * positively matches a known Playwright "could not resolve the element"
 * signature. Everything else — assertions, API/backend errors, auth failures,
 * bad test data, disabled/intercepted elements, and anything we do not
 * recognise — defaults to E2E_FLOW_FAILURE. When in doubt, we do NOT heal.
 *
 * This directly implements the core principle: heal broken locators, not broken
 * tests. A false "E2E_FLOW_FAILURE" only means "we didn't try to heal" (safe); a
 * false "LOCATOR_FAILURE" could mask a real bug (unsafe) — so the bias is
 * deliberately toward E2E_FLOW_FAILURE.
 */

import { FailureClassification } from '../core/types';

export interface ClassificationInput {
    /** The error thrown by the failed Playwright action. */
    error: unknown;
    /** The action that was attempted, e.g. 'click'. */
    action: string;
}

export interface ClassificationResult {
    classification: FailureClassification;
    /** Short human-readable reason, used in logs and the report. */
    reason: string;
}

/**
 * Signatures that positively indicate the element could not be resolved. These
 * are matched against the error message/stack. Kept specific to Playwright's
 * locator-resolution wording so unrelated timeouts are not swept in.
 */
const LOCATOR_FAILURE_SIGNATURES: Array<{ pattern: RegExp; reason: string }> = [
    {
        pattern: /waiting for locator\(/i,
        reason: 'Timed out waiting for the locator to resolve an element.',
    },
    {
        pattern: /waiting for (get_?by|getby)/i,
        reason: 'Timed out waiting for a getBy* locator to resolve an element.',
    },
    {
        pattern: /locator\.[a-z]+: Timeout .* exceeded/i,
        reason: 'Locator action timed out before the element was found.',
    },
    {
        pattern: /element(\(s\))? not found/i,
        reason: 'No element matched the selector.',
    },
    {
        pattern: /no element(s)? (match|matching|found)/i,
        reason: 'No element matched the selector.',
    },
    {
        pattern: /waiting for element to be visible, enabled and stable/i,
        reason: 'Element could not be resolved to a visible, actionable node.',
    },
];

/**
 * Signatures that positively indicate a NON-locator failure. Checked FIRST so
 * that, e.g., an assertion timeout is never mistaken for a locator timeout.
 * This is a safety belt: even without these, the default is E2E_FLOW_FAILURE,
 * but matching them yields a clearer reason and guards against an overly broad
 * locator signature.
 */
const E2E_FAILURE_SIGNATURES: Array<{ pattern: RegExp; reason: string }> = [
    {
        pattern: /expect(\.soft)?\(/i,
        reason: 'Assertion failure (expect) — business expectation not met.',
    },
    {
        pattern: /toBe|toEqual|toHaveText|toHaveValue|toHaveURL|toContain|toBeVisible|toBeHidden/,
        reason: 'Assertion matcher failed — not a locator resolution problem.',
    },
    {
        pattern: /\b(status(\s?code)?|http)\b.*\b(4\d\d|5\d\d)\b/i,
        reason: 'HTTP/API error status — backend failure, not a locator problem.',
    },
    {
        pattern: /\b(4\d\d|5\d\d)\b.*\b(status|response|request)\b/i,
        reason: 'HTTP/API error status — backend failure, not a locator problem.',
    },
    {
        pattern: /not authenticated|unauthori[sz]ed|forbidden|401|403/i,
        reason: 'Authentication/authorization failure — not a locator problem.',
    },
    {
        pattern: /intercepts pointer events|element is not enabled|element is disabled/i,
        reason: 'Element was found but not actionable due to app state — not a stale locator.',
    },
    {
        pattern: /strict mode violation/i,
        reason: 'Locator resolved to multiple elements (ambiguous) — not a missing element; healing would be unsafe.',
    },
];

/**
 * Classify a failed action. Order:
 *  1. If it matches a known E2E signature -> E2E_FLOW_FAILURE (never heal).
 *  2. Else if it matches a known locator signature -> LOCATOR_FAILURE (may heal).
 *  3. Else -> E2E_FLOW_FAILURE (unrecognised: default to safe).
 */
export function classifyFailure(input: ClassificationInput): ClassificationResult {
    const message = extractMessage(input.error);

    for (const sig of E2E_FAILURE_SIGNATURES) {
        if (sig.pattern.test(message)) {
            return { classification: FailureClassification.E2E_FLOW_FAILURE, reason: sig.reason };
        }
    }

    for (const sig of LOCATOR_FAILURE_SIGNATURES) {
        if (sig.pattern.test(message)) {
            return { classification: FailureClassification.LOCATOR_FAILURE, reason: sig.reason };
        }
    }

    return {
        classification: FailureClassification.E2E_FLOW_FAILURE,
        reason: 'Unrecognised failure — defaulting to E2E_FLOW_FAILURE so real problems are not masked.',
    };
}

/** Pull a searchable string out of any thrown value (Error, string, object). */
function extractMessage(error: unknown): string {
    if (error instanceof Error) {
        return `${error.message}\n${error.stack ?? ''}`;
    }
    if (typeof error === 'string') return error;
    if (error && typeof error === 'object') {
        const maybe = error as { message?: unknown };
        if (typeof maybe.message === 'string') return maybe.message;
        try {
            return JSON.stringify(error);
        } catch {
            return String(error);
        }
    }
    return String(error);
}
