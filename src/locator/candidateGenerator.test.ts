import { describe, it, expect } from 'vitest';
import { generateCandidate, generateCandidates } from './candidateGenerator';
import type { SnapshotElement } from './domSnapshot';

function el(partial: Partial<SnapshotElement>): SnapshotElement {
    return { index: 0, visible: true, ...partial };
}

describe('generateCandidate — stability hierarchy', () => {
    it('prefers testId above everything', () => {
        const c = generateCandidate(el({ testId: 'login', id: 'x', role: 'button', accessibleName: 'Login' }));
        expect(c?.basis).toBe('testId');
        expect(c?.selector).toBe('[data-testid="login"]');
    });

    it('uses id when no testId', () => {
        const c = generateCandidate(el({ id: 'submit', role: 'button', accessibleName: 'Go' }));
        expect(c?.basis).toBe('id');
        expect(c?.selector).toBe('#submit');
    });

    it('uses role + accessible name when no id/testId', () => {
        const c = generateCandidate(el({ role: 'button', accessibleName: 'Login' }));
        expect(c?.basis).toBe('role');
        expect(c?.selector).toBe('role=button[name="Login"]');
    });

    it('uses placeholder before label and text', () => {
        const c = generateCandidate(el({ placeholder: 'Email', label: 'E', text: 'x', tag: 'input' }));
        expect(c?.basis).toBe('placeholder');
        expect(c?.selector).toBe('[placeholder="Email"]');
    });

    it('uses label before text', () => {
        const c = generateCandidate(el({ label: 'Password', text: 'x', tag: 'input' }));
        expect(c?.basis).toBe('label');
        expect(c?.selector).toBe('label="Password"');
    });

    it('falls back to tag + exact text', () => {
        const c = generateCandidate(el({ tag: 'button', text: 'Continue' }));
        expect(c?.basis).toBe('text');
        expect(c?.selector).toBe('button:text-is("Continue")');
    });

    it('returns null when no usable signal exists', () => {
        expect(generateCandidate(el({ tag: 'div' }))).toBeNull();
    });

    it('escapes quotes in attribute values', () => {
        const c = generateCandidate(el({ testId: 'a"b' }));
        expect(c?.selector).toBe('[data-testid="a\\"b"]');
    });

    it('escapes special characters in ids', () => {
        const c = generateCandidate(el({ id: 'a.b:c' }));
        expect(c?.selector).toBe('#a\\.b\\:c');
    });
});

describe('generateCandidates', () => {
    it('skips elements with no usable signal', () => {
        const elements = [el({ testId: 'a', index: 0 }), el({ tag: 'div', index: 1 }), el({ id: 'b', index: 2 })];
        const candidates = generateCandidates(elements);
        expect(candidates).toHaveLength(2);
        expect(candidates.map((c) => c.basis)).toEqual(['testId', 'id']);
    });
});
