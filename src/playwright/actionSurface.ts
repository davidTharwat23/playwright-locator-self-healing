/**
 * The set of Playwright Locator methods the MVP guards with healing.
 *
 * These are the "terminal actions" — methods that actually interact with a
 * single element and therefore throw a locator-resolution error when the
 * element is gone. We intentionally keep this list small and explicit for the
 * MVP (reliability over coverage): every method here is one we know how to
 * retry safely against a healed locator.
 *
 * Methods NOT in this list (e.g. `filter`, `nth`, `first`, `and`, `or`) return
 * a new Locator rather than performing an action. Those are handled separately
 * by the proxy: it wraps the returned Locator so the chain stays guarded, but
 * it does not attempt to "heal" the act of composing a locator.
 */
export const GUARDED_ACTIONS = [
    'click',
    'dblclick',
    'fill',
    'type',
    'press',
    'check',
    'uncheck',
    'setChecked',
    'hover',
    'focus',
    'selectOption',
    'selectText',
    'tap',
    'clear',
    'waitFor',
    'scrollIntoViewIfNeeded',
    'dispatchEvent',
] as const;

export type GuardedAction = (typeof GUARDED_ACTIONS)[number];

const guardedSet = new Set<string>(GUARDED_ACTIONS);

/** Whether a property name is a guarded terminal action. */
export function isGuardedAction(name: string | symbol): name is GuardedAction {
    return typeof name === 'string' && guardedSet.has(name);
}

/**
 * Locator methods that return another Locator (chaining/composition). The proxy
 * wraps their return value so healing still applies to the final action, but it
 * does not treat calling them as an action to heal.
 */
export const CHAINING_METHODS = new Set<string>([
    'filter',
    'nth',
    'first',
    'last',
    'and',
    'or',
    'locator',
    'getByRole',
    'getByText',
    'getByLabel',
    'getByPlaceholder',
    'getByAltText',
    'getByTitle',
    'getByTestId',
]);
