/**
 * Wraps a Playwright Page in a Proxy so that every locator it produces is a
 * guarded (self-healing) locator.
 *
 * Only the locator-returning methods are intercepted; every other Page method
 * and property passes straight through. The wrapper records HOW each locator
 * was constructed (method + arguments) into a `LocatorConstruction` descriptor,
 * which the engine later uses to understand author intent when an action fails.
 */

import type { Locator, Page } from '@playwright/test';
import type { HealingHook, LocatorConstruction } from './healingHook';
import { wrapLocator } from './locatorProxy';

/** Page methods that construct and return a Locator. */
const LOCATOR_FACTORIES = new Set<string>([
    'locator',
    'getByRole',
    'getByText',
    'getByLabel',
    'getByPlaceholder',
    'getByAltText',
    'getByTitle',
    'getByTestId',
]);

export interface PageWrapContext {
    hook: HealingHook;
    /**
     * Bounded probe timeout (ms) for the original action attempt, forwarded to
     * each guarded locator. See `WrapContext.probeTimeoutMs` and ISSUE.md Bug 2.
     */
    probeTimeoutMs?: number;
}

/** Return a proxied Page whose locator factories yield guarded locators. */
export function wrapPage(page: Page, context: PageWrapContext): Page {
    return new Proxy(page, {
        get(target, prop, receiver) {
            const original = Reflect.get(target, prop, receiver);

            if (typeof original !== 'function' || typeof prop !== 'string' || !LOCATOR_FACTORIES.has(prop)) {
                return original;
            }

            return function locatorFactory(this: unknown, ...args: unknown[]): unknown {
                const result = (original as (...a: unknown[]) => unknown).apply(target, args);
                if (!isLocatorLike(result)) {
                    return result;
                }
                const descriptor = describeConstruction(prop, args);
                return wrapLocator(result as Locator, {
                    page: target,
                    hook: context.hook,
                    descriptor,
                    probeTimeoutMs: context.probeTimeoutMs,
                });
            };
        },
    });
}

/** Build a construction descriptor from the factory method and its arguments. */
export function describeConstruction(method: string, args: unknown[]): LocatorConstruction {
    const primaryArg = stringifyPrimaryArg(args[0]);
    const options = args.length > 1 ? args[1] : undefined;
    return { method, primaryArg, options };
}

/** Best-effort string form of the primary argument (string selector or RegExp). */
function stringifyPrimaryArg(arg: unknown): string {
    if (typeof arg === 'string') return arg;
    if (arg instanceof RegExp) return arg.toString();
    if (arg === undefined || arg === null) return '';
    return String(arg);
}

/** Heuristic: does this look like a Playwright Locator? */
function isLocatorLike(value: unknown): boolean {
    if (value === null || typeof value !== 'object') return false;
    const candidate = value as Record<string, unknown>;
    return typeof candidate.click === 'function' && typeof candidate.waitFor === 'function';
}
