/**
 * Wraps a Playwright Locator so terminal actions are guarded by the healing
 * hook and locator chaining stays transparent — WITHOUT replacing the object's
 * identity.
 *
 * Why not a Proxy?
 *   A `new Proxy(locator, ...)` is not `===` the locator and, more importantly,
 *   some Playwright versions brand-check the receiver of `expect(locator)`
 *   (e.g. `receiver instanceof Locator` / an internal symbol). A Proxy can fail
 *   that check, which breaks `expect(page.locator(...))` for EVERY wrapped-page
 *   locator, healing or not. See ISSUE.md Bug 1.
 *
 * The approach (ISSUE.md suggested fix, option 1):
 *   Return a lightweight child object created with `Object.create(locator)` so
 *   the REAL locator is its prototype. The child carries only own-property
 *   overrides for the guarded terminal actions and the chaining methods; every
 *   other property (`_apiName`, `_expect`, private fields, `count`, …) resolves
 *   straight through the prototype to the real locator. The child therefore
 *   satisfies `typeof x === 'object'`, `x._apiName === 'Locator'`, and any
 *   prototype-based brand check, so `expect(x)` behaves exactly as on the real
 *   locator.
 *
 * Behaviour is otherwise identical to before:
 *  - A guarded action (click, fill, …) runs the REAL Playwright method first.
 *    Only if it throws is the healing hook consulted. Zero added latency and
 *    zero behavioural change on the happy path.
 *  - A chaining method (filter, nth, getByRole, …) has its returned Locator
 *    re-wrapped so the final action in the chain is still guarded.
 *  - Everything else passes straight through to the underlying locator.
 */

import type { Locator, Page } from '@playwright/test';
import { CHAINING_METHODS, GUARDED_ACTIONS, isGuardedAction } from './actionSurface';
import type { HealingHook, LocatorConstruction } from './healingHook';

export interface WrapContext {
    page: Page;
    hook: HealingHook;
    descriptor: LocatorConstruction;
    /**
     * Bounded probe timeout (ms) for the ORIGINAL action attempt when healing
     * is enabled. Prevents the failing original action from consuming the whole
     * action/test timeout budget so the heal + retry can run before the test
     * times out (see ISSUE.md Bug 2). When undefined or 0, the caller's original
     * timeout is used untouched (legacy behaviour). A caller-supplied timeout
     * that is already smaller than this value is never widened.
     */
    probeTimeoutMs?: number;
}

/**
 * Return a guarded Locator. The `descriptor` records how this locator was built
 * so the engine can reason about intent when an action fails.
 *
 * The returned object is a prototype-delegating child of `locator` (not a
 * Proxy): it keeps the real locator's identity and brand so `expect()` works,
 * while shadowing only the action and chaining methods.
 */
export function wrapLocator(locator: Locator, context: WrapContext): Locator {
    // Child whose prototype IS the real locator. Untouched members resolve
    // through the prototype chain to the real object (correct _apiName, brand,
    // and internal methods).
    const guarded = Object.create(locator) as Locator;

    const members = locator as unknown as Record<string, unknown>;

    // Shadow the guarded terminal actions with a healing wrapper.
    for (const action of GUARDED_ACTIONS) {
        if (typeof members[action] !== 'function') continue;
        Object.defineProperty(guarded, action, {
            configurable: true,
            enumerable: false,
            writable: true,
            value: function guardedAction(this: unknown, ...args: unknown[]): Promise<unknown> {
                return runGuarded(locator, action, args, context);
            },
        });
    }

    // Shadow the chaining methods so any derived locator stays guarded.
    for (const method of CHAINING_METHODS) {
        if (typeof members[method] !== 'function') continue;
        Object.defineProperty(guarded, method, {
            configurable: true,
            enumerable: false,
            writable: true,
            value: function chaining(this: unknown, ...args: unknown[]): unknown {
                // Resolve the underlying method at call time so a late override
                // on the real locator is honoured (matches prior Proxy semantics).
                const original = Reflect.get(locator, method) as (...a: unknown[]) => unknown;
                const result = original.apply(locator, args);
                if (isLocatorLike(result)) {
                    return wrapLocator(result as Locator, {
                        ...context,
                        // A derived locator keeps the parent's descriptor as
                        // context; refining intent per chain step is a future
                        // enhancement, not needed for the MVP.
                    });
                }
                return result;
            },
        });
    }

    return guarded;
}

/**
 * Run a guarded action: execute the real Playwright method; if it throws, hand
 * the failure to the healing hook. The hook either returns a value (healed) or
 * rethrows the original error (not healed / not a locator failure).
 *
 * The underlying method is resolved at call time (`Reflect.get(target, prop)`)
 * and applied with `this` bound to the real locator, so late overrides and
 * internal private state both behave exactly as on the real object.
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

    // Bug 2 fix: bound the ORIGINAL attempt so a failing action cannot consume
    // the whole action/test timeout and starve the heal. The heal + retry then
    // run against the caller's ORIGINAL args (their intended timeout), so a
    // valid high-confidence heal applies even under default timeouts.
    const probeArgs = withProbeTimeout(prop, args, context.probeTimeoutMs);

    try {
        return await invoke(target, probeArgs);
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

/**
 * Options-bearing guarded actions accept a trailing `{ timeout }` option. Merge
 * a bounded probe timeout into that option for the ORIGINAL attempt, without
 * ever widening a smaller caller-supplied timeout and without altering the
 * caller's own args array (the heal retry still uses the untouched args).
 *
 * Returns the args unchanged when: no bound is configured (undefined/<=0), the
 * action does not take options we recognise, or the caller already set an equal
 * or smaller timeout.
 */
function withProbeTimeout(action: string, args: unknown[], probeTimeoutMs?: number): unknown[] {
    if (!probeTimeoutMs || probeTimeoutMs <= 0) return args;
    if (!ACTIONS_WITH_TIMEOUT.has(action)) return args;

    // Options is the last argument for these actions (index varies: fill/press
    // take a value first, so options may be at index 1). Find the trailing
    // plain-object arg, or synthesise one.
    const lastIndex = args.length - 1;
    const last = args[lastIndex];
    const hasOptions = isPlainObject(last);
    const options = hasOptions ? { ...(last as Record<string, unknown>) } : {};

    const existing = options.timeout;
    if (typeof existing === 'number' && existing > 0 && existing <= probeTimeoutMs) {
        // Caller already asked for an equal/tighter budget — respect it.
        return args;
    }
    options.timeout = probeTimeoutMs;

    const next = args.slice();
    if (hasOptions) {
        next[lastIndex] = options;
    } else {
        next.push(options);
    }
    return next;
}

/** Guarded actions that accept a Playwright `{ timeout }` option. */
const ACTIONS_WITH_TIMEOUT = new Set<string>([
    'click',
    'dblclick',
    'fill',
    'press',
    'check',
    'uncheck',
    'setChecked',
    'hover',
    'focus',
    // NOTE: `selectOption` is omitted: its `values` argument can itself be a
    // plain object (e.g. `{ label: 'x' }`), which is indistinguishable from a
    // trailing options object, so injecting `{ timeout }` risks corrupting it.
    'selectText',
    'tap',
    'clear',
    'waitFor',
    'scrollIntoViewIfNeeded',
    // NOTE: `dispatchEvent(type, eventInit?, options?)` is intentionally omitted.
    // Its options object is not always the trailing arg (eventInit can precede
    // it), so blindly appending `{ timeout }` could be mistaken for eventInit.
    // Losing the bounded probe on dispatchEvent is preferable to corrupting its
    // arguments; it still heals, just without the tightened first-attempt bound.
]);

/** True for a non-null, non-array plain object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Kept for symmetry / potential external callers; not used internally now. */
export { isGuardedAction };

/** Heuristic: does this look like a Playwright Locator? (has the action methods) */
function isLocatorLike(value: unknown): boolean {
    if (value === null || typeof value !== 'object') return false;
    const candidate = value as Record<string, unknown>;
    return typeof candidate.click === 'function' && typeof candidate.waitFor === 'function';
}
