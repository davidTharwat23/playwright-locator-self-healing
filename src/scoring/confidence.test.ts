import { describe, it, expect } from 'vitest';
import { scoreCandidate } from './confidence';
import type { SignalProfile } from '../core/types';

describe('scoreCandidate — matching', () => {
    it('scores a perfect testId match as 1', () => {
        const r = scoreCandidate({ testId: 'login-button' }, { testId: 'login-button' });
        expect(r.confidence).toBe(1);
        expect(r.matched).toContain('testId');
    });

    it('scores a total miss as 0', () => {
        const r = scoreCandidate({ testId: 'login-button' }, { testId: 'other' });
        expect(r.confidence).toBe(0);
        expect(r.missed).toContain('testId');
    });

    it('normalises by the original signals only (unspecified signals do not penalise)', () => {
        // Original only asked for a role+name; candidate matches both → 1.0,
        // even though the candidate also has a testId the original never wanted.
        const original: SignalProfile = { role: 'button', accessibleName: 'Login' };
        const candidate: SignalProfile = { role: 'button', accessibleName: 'Login', testId: 'x' };
        expect(scoreCandidate(original, candidate).confidence).toBe(1);
    });

    it('gives partial confidence for a partial match', () => {
        // Original asked for role + name; only role matches.
        const r = scoreCandidate({ role: 'button', accessibleName: 'Login' }, { role: 'button', accessibleName: 'Signup' });
        expect(r.confidence).toBeGreaterThan(0);
        expect(r.confidence).toBeLessThan(1);
    });

    it('returns 0 when the original has no weighted signals', () => {
        expect(scoreCandidate({}, { testId: 'x' }).confidence).toBe(0);
    });
});

describe('scoreCandidate — text-like partial matching', () => {
    it('matches accessible names case-insensitively', () => {
        const r = scoreCandidate({ role: 'button', accessibleName: 'LOGIN' }, { role: 'button', accessibleName: 'login' });
        expect(r.confidence).toBe(1);
    });

    it('gives credit for containment in accessible name', () => {
        const r = scoreCandidate(
            { role: 'button', accessibleName: 'Login' },
            { role: 'button', accessibleName: 'Login now' },
        );
        expect(r.matched).toContain('accessibleName');
    });
});

describe('scoreCandidate — type/tag gate', () => {
    it('caps confidence when tag contradicts (button vs div)', () => {
        const original: SignalProfile = { role: 'button', accessibleName: 'Login', tag: 'button' };
        const candidate: SignalProfile = { role: 'button', accessibleName: 'Login', tag: 'div' };
        const r = scoreCandidate(original, candidate);
        expect(r.typeMismatchPenalised).toBe(true);
        expect(r.confidence).toBeLessThanOrEqual(0.3);
    });

    it('caps confidence when input type contradicts', () => {
        const original: SignalProfile = { id: 'field', type: 'email' };
        const candidate: SignalProfile = { id: 'field', type: 'password' };
        const r = scoreCandidate(original, candidate);
        expect(r.typeMismatchPenalised).toBe(true);
        expect(r.confidence).toBeLessThanOrEqual(0.3);
    });

    it('does not penalise when a type/tag is merely absent on one side', () => {
        const original: SignalProfile = { testId: 'x', tag: 'button' };
        const candidate: SignalProfile = { testId: 'x' }; // no tag → not a contradiction
        const r = scoreCandidate(original, candidate);
        expect(r.typeMismatchPenalised).toBe(false);
    });
});
