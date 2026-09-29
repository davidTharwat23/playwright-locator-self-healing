/**
 * Wraps a Playwright Locator in a Proxy that guards terminal actions with the
 * healing hook and keeps locator chaining transparent.
 *
 * Behaviour:
 *  - A guarded action (click, fill, ...) runs the REAL Playwright method first.
 *    Only if it throws is the healing hook consulted. On the happy path there
 *    is zero added latency and zero behavioural change.
 *  - A chaining method (filter, nth, getByRole, ...) has its returned Locator
 *    re-wrapped so the final action in the chain is still guarded.
 *  - Everything else (properties, other methods) passes straight through.
 *
 * The proxy is transparent: `instanceof`, property access, and unknown methods
 * behave exactly as on the underlying Locator.
 */

import type { Locator, Page } from '@playwright/test';
import { CHAINING_METHODS, isGuardedAction } from './actionSurface';
import type { HealingHook, LocatorConstruction } from './healingHook';

export interface WrapContext {
    page: Page;
    hook: HealingHook;
    descriptor: LocatorConstruction;
}

/**
 * Return a proxied Locator. The `descriptor` records how this locator was built
 * so the engine can reason about intent when an action fails.
 */
export function wrapLocator(locator: Locator, context: WrapContext): Locator {
    return new Proxy(locator, {
        get(target, prop, receiver) {
            const original = Reflect.get(target, prop, receiver);

            if (typeof original !== 'function') {
                return original;
            }

            // Guarded terminal action: try for real, heal on failure.
            if (isGuardedAction(prop)) {
                return function guardedAction(this: unknown, ...args: unknown[]): Promise<unknown> {
                    return runGuarded(target, prop, args, context);
                };
            }

            // Chaining method: wrap the returned locator so the chain stays guarded.
            if (typeof prop === 'string' && CHAINING_METHODS.has(prop)) {
                return function chaining(this: unknown, ...args: unknown[]): unknown {
                    const result = (original as (...a: unknown[]) => unknown).apply(target, args);
                    if (isLocatorLike(result)) {
                        return wrapLocator(result as Locator, {
                            ...context,
                            // A derived locator keeps the parent's descriptor as
                            // context; refining intent per chain step is a future
                            // enhancement, not needed for the MVP.
                        });
                    }
                    return result;
                };
            }

            // Any other method: bind and pass through unchanged.
            return function passthrough(this: unknown, ...args: unknown[]): unknown {
                return (original as (...a: unknown[]) => unknown).apply(target, args);
            };
        },
    });
}

/**
 * Run a guarded action: execute the real Playwright method; if it throws, hand
 * the failure to the healing hook. The hook either returns a value (healed) or
 * rethrows the original error (not healed / not a locator failure).
 */
async function runGuarded(
    target: Locator,
    prop: string,
    args: unknown[],
    context: WrapContext,
): Promise<unknown> {
    const invoke = (locator: Locator, invokeArgs: unknown[]): Promise<unknown> => {
        const method = Reflect.get(locator, prop) as (...a: unknown[]) => Promise<unknown>;
        return method.apply(locator, invokeArgs);
    };

    try {
        return await invoke(target, args);
    } catch (error) {
        return context.hook.onActionFailed({
            page: context.page,
            locator: target,
            descriptor: context.descriptor,
            action: prop,
            args,
            error,
            invoke,
        });
    }
}

/** Heuristic: does this look like a Playwright Locator? (has the action methods) */
function isLocatorLike(value: unknown): boolean {
    if (value === null || typeof value !== 'object') return false;
    const candidate = value as Record<string, unknown>;
    return typeof candidate.click === 'function' && typeof candidate.waitFor === 'function';
}
