/**
 * Derive a `SignalProfile` (author intent) from how a locator was constructed.
 *
 * The page proxy captured a `LocatorConstruction` (method + primaryArg +
 * options). Here we translate that into the neutral `SignalProfile` shape the
 * scorer compares against DOM elements. This is pure and framework-neutral:
 * given a construction, produce the signals the author implicitly asked for.
 *
 * Examples:
 *   getByTestId('login-button')            -> { testId: 'login-button' }
 *   getByRole('button', { name: 'Login' }) -> { role: 'button', accessibleName: 'Login' }
 *   getByPlaceholder('Email')              -> { placeholder: 'Email' }
 *   locator('#submit')                     -> { id: 'submit' } (parsed from CSS)
 *   locator('[data-testid="x"]')           -> { testId: 'x' }
 */

import type { SignalProfile } from '../core/types';
import type { LocatorConstruction } from '../playwright/healingHook';

/** Options object accepted by getByRole and friends. */
interface RoleLikeOptions {
    name?: string | RegExp;
    exact?: boolean;
}

export function signalsFromConstruction(construction: LocatorConstruction): SignalProfile {
    const { method, primaryArg, options } = construction;
    const arg = primaryArg?.trim() ?? '';

    switch (method) {
        case 'getByTestId':
            return { testId: arg };
        case 'getByRole':
            return { role: arg, accessibleName: optionName(options) };
        case 'getByLabel':
            return { label: arg };
        case 'getByPlaceholder':
            return { placeholder: arg };
        case 'getByText':
            return { text: arg };
        case 'getByAltText':
            return { accessibleName: arg };
        case 'getByTitle':
            return { accessibleName: arg };
        case 'locator':
            return signalsFromCssSelector(arg);
        default:
            // Unknown construction method: best-effort parse as CSS.
            return signalsFromCssSelector(arg);
    }
}

/** Extract the `name` option from a getByRole-style options object. */
function optionName(options: unknown): string | undefined {
    if (options && typeof options === 'object') {
        const name = (options as RoleLikeOptions).name;
        if (typeof name === 'string') return name;
        if (name instanceof RegExp) return name.source;
    }
    return undefined;
}

/**
 * Parse a limited, common subset of CSS selectors into signals. This is not a
 * full CSS parser — it recognises the high-value stable patterns (id,
 * data-testid, [name], [type], [placeholder], [aria-label], tag) so a locator
 * like `#submit` or `[data-testid="x"]` yields useful intent signals. Anything
 * it cannot parse simply yields no signals for that facet.
 */
export function signalsFromCssSelector(selector: string): SignalProfile {
    const signals: SignalProfile = {};
    if (!selector) return signals;

    // #id
    const idMatch = selector.match(/#([A-Za-z0-9_-]+)/);
    if (idMatch) signals.id = idMatch[1];

    // [data-testid="..."] or [data-test-id="..."]
    const testIdMatch = selector.match(/\[data-test-?id\s*=\s*["']?([^"'\]]+)["']?\]/i);
    if (testIdMatch) signals.testId = testIdMatch[1];

    // [name="..."]
    const nameMatch = selector.match(/\[name\s*=\s*["']?([^"'\]]+)["']?\]/i);
    if (nameMatch) signals.accessibleName = signals.accessibleName ?? nameMatch[1];

    // [type="..."]
    const typeMatch = selector.match(/\[type\s*=\s*["']?([^"'\]]+)["']?\]/i);
    if (typeMatch) signals.type = typeMatch[1];

    // [placeholder="..."]
    const placeholderMatch = selector.match(/\[placeholder\s*=\s*["']?([^"'\]]+)["']?\]/i);
    if (placeholderMatch) signals.placeholder = placeholderMatch[1];

    // [aria-label="..."]
    const ariaMatch = selector.match(/\[aria-label\s*=\s*["']?([^"'\]]+)["']?\]/i);
    if (ariaMatch) signals.accessibleName = signals.accessibleName ?? ariaMatch[1];

    // leading tag name (e.g. "button#submit" -> tag "button")
    const tagMatch = selector.match(/^\s*([a-zA-Z][a-zA-Z0-9]*)/);
    if (tagMatch && !isPseudoOrCombinator(tagMatch[1])) {
        signals.tag = tagMatch[1].toLowerCase();
    }

    return signals;
}

/** Guard against treating a leading pseudo/combinator token as a tag. */
function isPseudoOrCombinator(token: string): boolean {
    return ['and', 'or', 'has', 'text', 'nth', 'is', 'not', 'visible'].includes(token.toLowerCase());
}
