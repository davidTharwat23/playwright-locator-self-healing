/**
 * The Playwright integration: a `test` object that overrides the built-in
 * `page` fixture with a self-healing page.
 *
 * The no-op guarantee (spec requirement #5): when healing is disabled, the
 * fixture uses the raw Playwright `page` WITHOUT wrapping it in any proxy. There
 * is no interception, no descriptor tracking, no added code path — behaviour is
 * byte-for-byte identical to importing `test` straight from '@playwright/test'.
 *
 * Only when enabled does it substitute the proxied page.
 */

import { test as base } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { SelfHealingConfig } from '../config/config';
import type { HealingHook } from './healingHook';
import { passthroughHook } from './healingHook';
import { wrapPage } from './pageProxy';

/**
 * The minimal structural shape we rely on: a `test` exposing `.extend`. Used as
 * the generic CONSTRAINT so any Playwright `test` (base or already-extended)
 * satisfies it. It is deliberately NOT the default return type — see below.
 */
export type AnyTest = {
    extend: (fixtures: Record<string, unknown>) => unknown;
};

/**
 * The type of Playwright's own `test`. Used as the DEFAULT generic so a
 * no-argument `extendTest()` returns the full Playwright `TestType` (with
 * `.step`, `.describe`, `.beforeEach`, call signatures, …), not the minimal
 * `AnyTest` shape. A caller that passes its own extended `test` gets that exact
 * type back instead.
 */
export type PlaywrightTest = typeof base;

export interface CreateTestParams<T extends AnyTest = PlaywrightTest> {
    config: SelfHealingConfig;
    /**
     * The hook that performs healing. Defaults to the pass-through hook, which
     * always rethrows the original error. The real engine is injected here in
     * later steps.
     */
    hook?: HealingHook;
    /**
     * The base test to extend. Defaults to Playwright's own `test`. Injectable
     * so a project that already extends `test` can pass its extended version;
     * its type is preserved on the return value.
     */
    baseTest?: T;
}

/**
 * Build a `test` whose `page` fixture is self-healing when enabled.
 *
 * When `config.enabled` is false, this returns the untouched base test — a
 * genuine no-op (`.extend` is never called). When enabled, it overrides only
 * the `page` fixture, leaving every other fixture on the base test intact.
 */
export function createHealingTest<T extends AnyTest = PlaywrightTest>(params: CreateTestParams<T>): T {
    const { config, hook = passthroughHook } = params;
    const baseTest = (params.baseTest ?? (base as unknown as T)) as T;

    if (!config.enabled) {
        // True no-op: hand back the base test unchanged. No fixture override,
        // no proxy, no descriptor tracking. Identical to plain Playwright.
        return baseTest;
    }

    const extended = (baseTest.extend as (fixtures: Record<string, unknown>) => unknown)({
        page: async ({ page }: { page: Page }, use: (page: Page) => Promise<void>) => {
            const healingPage = wrapPage(page, { hook });
            await use(healingPage);
        },
    });
    return extended as T;
}
