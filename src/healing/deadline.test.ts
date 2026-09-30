/**
 * Unit tests for the healing time-budget primitive.
 *
 * These assert the guarantees the executor relies on: a fast operation passes
 * through, a slow operation is cut off at the budget with a
 * HealingDeadlineExceeded, timers are cleared (no open handles), and a budget
 * of 0 is an unbounded passthrough.
 */

import { describe, it, expect, vi } from 'vitest';
import { createDeadline, HealingDeadlineExceeded } from './deadline';

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('createDeadline', () => {
    it('passes a fast operation through and returns its value', async () => {
        const d = createDeadline(1000);
        const result = await d.race(Promise.resolve('ok'));
        expect(result).toBe('ok');
    });

    it('rejects with HealingDeadlineExceeded when the operation is too slow', async () => {
        const d = createDeadline(200);
        const started = Date.now();
        await expect(d.race(sleep(5000).then(() => 'late'))).rejects.toBeInstanceOf(HealingDeadlineExceeded);
        expect(Date.now() - started).toBeLessThan(1500);
    });

    it('propagates the operation error if it rejects before the deadline', async () => {
        const d = createDeadline(1000);
        const boom = new Error('op failed');
        await expect(d.race(Promise.reject(boom))).rejects.toBe(boom);
    });

    it('clears the timer when the operation settles (no dangling handle)', async () => {
        const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
        const d = createDeadline(1000);
        await d.race(Promise.resolve('done'));
        expect(clearSpy).toHaveBeenCalled();
        clearSpy.mockRestore();
    });

    it('treats budget 0 as unbounded passthrough (no deadline timer scheduled)', async () => {
        const setSpy = vi.spyOn(globalThis, 'setTimeout');
        const d = createDeadline(0);
        expect(d.remaining()).toBe(Number.POSITIVE_INFINITY);
        expect(d.expired()).toBe(false);
        // Use an already-resolved promise so the ONLY possible setTimeout would
        // be one scheduled by the deadline itself (there must be none).
        const result = await d.race(Promise.resolve('unbounded-ok'));
        expect(result).toBe('unbounded-ok');
        expect(setSpy).not.toHaveBeenCalled();
        setSpy.mockRestore();
    });

    it('returns the SAME promise reference for an unbounded budget (true passthrough)', async () => {
        const d = createDeadline(0);
        const op = Promise.resolve('x');
        expect(d.race(op)).toBe(op);
        await op;
    });

    it('reports remaining budget decreasing and expired() after elapse', async () => {
        const d = createDeadline(150);
        expect(d.remaining()).toBeGreaterThan(0);
        expect(d.remaining()).toBeLessThanOrEqual(150);
        await sleep(200);
        expect(d.remaining()).toBe(0);
        expect(d.expired()).toBe(true);
    });
});
