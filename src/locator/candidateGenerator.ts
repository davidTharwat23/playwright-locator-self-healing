/**
 * Candidate generator: turn a snapshot element into a single, stable
 * Playwright-compatible selector string.
 *
 * It picks ONE selector per element using a stability hierarchy (id and
 * data-testid first, then role+name, then label/placeholder, then text). We do
 * not emit broad selectors like `div:has-text("...")` that could match many
 * nodes — the review of the prior implementation flagged those as a source of
 * wrong-element heals. The selector we emit is meant to be specific; the
 * uniqueness gate in Step 5 still verifies it resolves to exactly one element
 * before any heal is allowed.
 *
 * The generated selector uses Playwright's engine prefixes where helpful:
 *   - `internal:testid` is avoided (private); we use `[data-testid="..."]`.
 *   - role is expressed via Playwright's `role=` selector engine.
 */

import type { SnapshotElement } from './domSnapshot';

/** A candidate: a selector plus the element signals it came from. */
export interface GeneratedCandidate {
    selector: string;
    element: SnapshotElement;
    /** Which signal the selector is based on (for logging/debug). */
    basis: 'testId' | 'id' | 'role' | 'label' | 'placeholder' | 'text' | 'none';
}

/**
 * Generate at most one candidate per element, choosing the most stable signal
 * available. Returns null when the element has no signal we consider safe
 * enough to build a selector from.
 */
export function generateCandidate(element: SnapshotElement): GeneratedCandidate | null {
    if (element.testId) {
        return { selector: `[data-testid="${cssEscape(element.testId)}"]`, element, basis: 'testId' };
    }
    if (element.id) {
        return { selector: `#${cssIdentifier(element.id)}`, element, basis: 'id' };
    }
    if (element.role && element.accessibleName) {
        return {
            selector: `role=${element.role}[name=${quote(element.accessibleName)}]`,
            element,
            basis: 'role',
        };
    }
    if (element.placeholder) {
        return { selector: `[placeholder="${cssEscape(element.placeholder)}"]`, element, basis: 'placeholder' };
    }
    if (element.label) {
        // Playwright label engine matches by associated label text.
        return { selector: `label=${quote(element.label)}`, element, basis: 'label' };
    }
    if (element.tag && element.text) {
        // Constrain by tag AND exact text to keep it specific; uniqueness gate
        // still verifies a single match before this can be used.
        return { selector: `${element.tag}:text-is(${quote(element.text)})`, element, basis: 'text' };
    }
    return null;
}

/** Generate candidates for a list of snapshot elements, skipping unusable ones. */
export function generateCandidates(elements: SnapshotElement[]): GeneratedCandidate[] {
    const candidates: GeneratedCandidate[] = [];
    for (const element of elements) {
        const candidate = generateCandidate(element);
        if (candidate) candidates.push(candidate);
    }
    return candidates;
}

/** Escape a value for use inside a double-quoted CSS attribute selector. */
function cssEscape(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Escape an id for use after `#`. Uses CSS.escape semantics conservatively. */
function cssIdentifier(value: string): string {
    // Escape characters that are not valid unescaped in a CSS identifier.
    return value.replace(/([^a-zA-Z0-9_-])/g, '\\$1');
}

/** Quote a value for Playwright text/role/label engines. */
function quote(value: string): string {
    return `"${value.replace(/"/g, '\\"')}"`;
}
