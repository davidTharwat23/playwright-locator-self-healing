import { describe, it, expect, vi } from 'vitest';
import type { Page } from '@playwright/test';
import { captureDomSnapshot, SnapshotElement } from './domSnapshot';

/**
 * The in-page walk itself runs in a real browser and is exercised by the
 * Playwright integration example in a later step. Here we test the Node-side
 * wrapper contract: it delegates to page.evaluate, passes the cap, and never
 * throws (returns [] on error).
 */

function pageWithEvaluate(impl: (cap: number) => unknown): Page {
    return { evaluate: vi.fn(async (_fn: unknown, cap: number) => impl(cap)) } as unknown as Page;
}

describe('captureDomSnapshot', () => {
    it('returns the elements produced by page.evaluate', async () => {
        const fake: SnapshotElement[] = [
            { index: 0, visible: true, testId: 'login-button', tag: 'button' },
            { index: 1, visible: true, id: 'email', tag: 'input' },
        ];
        const page = pageWithEvaluate(() => fake);
        const result = await captureDomSnapshot(page);
        expect(result).toEqual(fake);
    });

    it('passes the maxElements cap through to evaluate', async () => {
        let receivedCap = -1;
        const page = pageWithEvaluate((cap) => {
            receivedCap = cap;
            return [];
        });
        await captureDomSnapshot(page, 42);
        expect(receivedCap).toBe(42);
    });

    it('returns an empty array when evaluate throws (never throws into healing)', async () => {
        const page = {
            evaluate: vi.fn(async () => {
                throw new Error('evaluate blew up');
            }),
        } as unknown as Page;
        await expect(captureDomSnapshot(page)).resolves.toEqual([]);
    });
});
