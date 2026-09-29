import { describe, it, expect, vi } from 'vitest';
import { selectSafeCandidate, scoreAll } from './safetyGate';
import type { SignalProfile } from '../core/types';

const original: SignalProfile = { testId: 'login-button' };

/** A counter that returns 1 for every selector (unique match). */
const alwaysUnique = async () => 1;

describe('scoreAll', () => {
    it('scores and sorts candidates best-first', () => {
        const scored = scoreAll(original, [
            { selector: 'a', signals: { testId: 'other' } },
            { selector: 'b', signals: { testId: 'login-button' } },
        ]);
        expect(scored[0].selector).toBe('b');
        expect(scored[0].confidence).toBe(1);
        expect(scored[1].confidence).toBe(0);
    });
});

describe('selectSafeCandidate — threshold', () => {
    it('selects a confident, unique candidate', async () => {
        const result = await selectSafeCandidate(
            original,
            [{ selector: '[data-testid="login-button"]', signals: { testId: 'login-button' } }],
            alwaysUnique,
            { confidenceThreshold: 0.85 },
        );
        expect(result).not.toBeNull();
        expect(result?.selector).toBe('[data-testid="login-button"]');
        expect(result?.confidence).toBe(1);
    });

    it('rejects when the best candidate is below threshold', async () => {
        const result = await selectSafeCandidate(
            { role: 'button', accessibleName: 'Login' },
            [{ selector: 'x', signals: { role: 'button', accessibleName: 'Totally Different' } }],
            alwaysUnique,
            { confidenceThreshold: 0.85 },
        );
        expect(result).toBeNull();
    });

    it('returns null for an empty candidate list', async () => {
        const result = await selectSafeCandidate(original, [], alwaysUnique, { confidenceThreshold: 0.85 });
        expect(result).toBeNull();
    });
});

describe('selectSafeCandidate — uniqueness gate', () => {
    it('rejects a confident candidate that matches zero visible elements', async () => {
        const result = await selectSafeCandidate(
            original,
            [{ selector: '[data-testid="login-button"]', signals: { testId: 'login-button' } }],
            async () => 0,
            { confidenceThreshold: 0.85 },
        );
        expect(result).toBeNull();
    });

    it('rejects a confident candidate that matches multiple visible elements', async () => {
        const result = await selectSafeCandidate(
            original,
            [{ selector: '[data-testid="login-button"]', signals: { testId: 'login-button' } }],
            async () => 3,
            { confidenceThreshold: 0.85 },
        );
        expect(result).toBeNull();
    });

    it('skips an ambiguous top candidate and uses the next unique one', async () => {
        // Two candidates: first is confident but matches 2 elements; second is
        // also confident (same testId intent via different selector) and unique.
        const countVisible = vi.fn(async (selector: string) => (selector === 'dup' ? 2 : 1));
        const result = await selectSafeCandidate(
            original,
            [
                { selector: 'dup', signals: { testId: 'login-button' } },
                { selector: 'unique', signals: { testId: 'login-button' } },
            ],
            countVisible,
            { confidenceThreshold: 0.85, ambiguityMargin: -1 }, // allow equal-confidence to pass the ambiguity check
        );
        expect(result?.selector).toBe('unique');
    });

    it('treats a probe error as no match (safe)', async () => {
        const result = await selectSafeCandidate(
            original,
            [{ selector: 'x', signals: { testId: 'login-button' } }],
            async () => {
                throw new Error('probe failed');
            },
            { confidenceThreshold: 0.85 },
        );
        expect(result).toBeNull();
    });
});

describe('selectSafeCandidate — ambiguity between distinct selectors', () => {
    it('refuses when two different selectors tie at the top', async () => {
        const result = await selectSafeCandidate(
            original,
            [
                { selector: 'a', signals: { testId: 'login-button' } },
                { selector: 'b', signals: { testId: 'login-button' } },
            ],
            alwaysUnique,
            { confidenceThreshold: 0.85 }, // default margin 0 → equal confidence is a tie → refuse
        );
        expect(result).toBeNull();
    });
});
