import { describe, it, expect, vi } from 'vitest';
import { createHealingTest, AnyTest } from './fixture';
import { resolveConfig } from '../config/config';

/**
 * A fake base `test` that records whether `.extend` was called. It implements
 * the minimal `AnyTest` shape the fixture relies on; the real Playwright fixture
 * wiring is exercised by the Playwright integration example in a later step.
 */
type FakeBaseTest = AnyTest & { extend: ReturnType<typeof vi.fn>; __base: true };

function makeFakeBaseTest(): FakeBaseTest {
    const extend = vi.fn((_fixtures: Record<string, unknown>): AnyTest => {
        return { extend: vi.fn() } as unknown as AnyTest;
    });
    return { extend, __base: true } as unknown as FakeBaseTest;
}

describe('createHealingTest — no-op when disabled', () => {
    it('returns the identical base test object and never calls extend', () => {
        const base = makeFakeBaseTest();
        const result = createHealingTest({ config: resolveConfig({ enabled: false }), baseTest: base });
        // Same reference — a true no-op, not a re-wrapped equivalent.
        expect(result).toBe(base);
        expect(base.extend).not.toHaveBeenCalled();
    });

    it('is disabled by default (no enabled flag set)', () => {
        const base = makeFakeBaseTest();
        const result = createHealingTest({ config: resolveConfig(), baseTest: base });
        expect(result).toBe(base);
        expect(base.extend).not.toHaveBeenCalled();
    });
});

describe('createHealingTest — enabled', () => {
    it('extends the base test with a page fixture override', () => {
        const base = makeFakeBaseTest();
        const result = createHealingTest({ config: resolveConfig({ enabled: true }), baseTest: base });
        expect(base.extend).toHaveBeenCalledOnce();
        const fixtures = base.extend.mock.calls[0][0] as Record<string, unknown>;
        expect(Object.keys(fixtures)).toContain('page');
        expect(result).not.toBe(base);
    });

    it('the page fixture wraps the provided page and calls use with it', async () => {
        const base = makeFakeBaseTest();
        createHealingTest({ config: resolveConfig({ enabled: true }), baseTest: base });
        const fixtures = base.extend.mock.calls[0][0] as {
            page: (deps: { page: unknown }, use: (p: unknown) => Promise<void>) => Promise<void>;
        };

        // Minimal fake page with one factory method to confirm wrapping occurred.
        const rawPage = {
            getByTestId: () => ({ click: () => Promise.resolve('ok'), waitFor: () => Promise.resolve() }),
            title: () => Promise.resolve('t'),
        };
        let provided: unknown;
        await fixtures.page({ page: rawPage }, async (p) => {
            provided = p;
        });
        // The provided page is a proxy, not the raw object.
        expect(provided).not.toBe(rawPage);
        // But it behaves like the page (proxy is transparent).
        expect(await (provided as { title: () => Promise<string> }).title()).toBe('t');
    });
});
