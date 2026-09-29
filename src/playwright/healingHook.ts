/**
 * The seam between the Playwright interception layer and the healing engine.
 *
 * The locator proxy does not know how healing works. When a guarded action
 * throws, it hands the failure to a `HealingHook` and does whatever the hook
 * returns. This keeps the proxy stable while the engine (classifier, scorer,
 * executor) is built up in later steps behind this one interface.
 */

import type { Locator, Page } from '@playwright/test';

/** Context describing the failed action, passed to the hook. */
export interface FailedActionContext {
    /** The page the locator belongs to (used to snapshot the DOM later). */
    page: Page;
    /** The locator whose action failed. */
    locator: Locator;
    /** How the locator was originally constructed, for logging + scoring. */
    descriptor: LocatorConstruction;
    /** The guarded action name, e.g. 'click'. */
    action: string;
    /** The arguments passed to the action. */
    args: unknown[];
    /** The original error Playwright threw. Always preserved. */
    error: unknown;
    /**
     * Re-run the original action against a (possibly different) locator. The
     * executor uses this to retry against a healed locator. Returns whatever
     * the action returns.
     */
    invoke: (target: Locator, args: unknown[]) => Promise<unknown>;
}

/**
 * How a locator was built. Captured by the page proxy at construction time so
 * the engine can reason about author intent without parsing Playwright internals.
 */
export interface LocatorConstruction {
    /** e.g. 'getByTestId', 'getByRole', 'locator'. */
    method: string;
    /** Primary string argument, e.g. the test id or selector. */
    primaryArg: string;
    /** Any remaining arguments (options object for getByRole, etc.). */
    options?: unknown;
}

/**
 * The healing hook. Given a failed action, either resolve (healing succeeded and
 * the action's result is returned) or reject (healing did not happen or failed —
 * the ORIGINAL error must be thrown so real failures are never hidden).
 *
 * In Step 2 the only implementation is a pass-through that always rethrows the
 * original error, which is what makes an enabled-but-not-yet-wired engine behave
 * exactly like plain Playwright. The real engine replaces it in later steps.
 */
export interface HealingHook {
    onActionFailed(context: FailedActionContext): Promise<unknown>;
}

/**
 * The default, safe hook: never heals, always rethrows the original error.
 * Used until the classify/heal pipeline is wired in. Guarantees that turning
 * the flag on before the engine exists does not change test behaviour.
 */
export const passthroughHook: HealingHook = {
    async onActionFailed(context: FailedActionContext): Promise<unknown> {
        throw context.error;
    },
};
