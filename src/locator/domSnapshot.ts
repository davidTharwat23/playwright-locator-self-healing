/**
 * DOM snapshot: capture the identifying signals of every plausible candidate
 * element on the page at failure time, via a single `page.evaluate`.
 *
 * We keep the snapshot to interactive / meaningful elements (links, buttons,
 * inputs, elements with a role, testid, or aria-label) to bound the work and
 * avoid ranking irrelevant nodes. Each element gets a stable index we can turn
 * into a candidate selector later.
 *
 * The function passed to `evaluate` runs in the BROWSER context: it may only
 * use DOM APIs and must be fully self-contained (no imports, no outer closure
 * variables). That is why the extraction logic is inlined as a string-free
 * function argument.
 */

import type { Page } from '@playwright/test';
import type { SignalProfile } from '../core/types';

/** A snapshotted element: its signals plus a 0-based document order index. */
export interface SnapshotElement extends SignalProfile {
    /** Index into the ordered candidate list, used to build a nth-match selector. */
    index: number;
    /** Whether the element was visible (non-zero box, not hidden) at snapshot time. */
    visible: boolean;
}

/**
 * Capture candidate elements from the live page. Returns [] on any failure —
 * snapshotting must never throw into the healing flow.
 *
 * @param maxElements Cap on how many candidates to return (bounds evaluate cost).
 */
export async function captureDomSnapshot(page: Page, maxElements = 400): Promise<SnapshotElement[]> {
    try {
        return await page.evaluate((cap: number) => {
            // ---- everything below runs in the browser ----
            const SELECTOR =
                'a,button,input,select,textarea,[role],[data-testid],[data-test-id],[aria-label],[placeholder],[title],label,summary,[onclick],[tabindex]';

            const isVisible = (el: Element): boolean => {
                const rect = el.getBoundingClientRect();
                if (rect.width === 0 || rect.height === 0) return false;
                const style = window.getComputedStyle(el);
                return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
            };

            const accessibleNameOf = (el: Element): string | null => {
                const aria = el.getAttribute('aria-label');
                if (aria && aria.trim()) return aria.trim();
                const labelledby = el.getAttribute('aria-labelledby');
                if (labelledby) {
                    const ref = document.getElementById(labelledby);
                    if (ref && ref.textContent && ref.textContent.trim()) return ref.textContent.trim();
                }
                const title = el.getAttribute('title');
                if (title && title.trim()) return title.trim();
                const text = (el as HTMLElement).innerText || el.textContent || '';
                const trimmed = text.trim();
                return trimmed ? trimmed.slice(0, 100) : null;
            };

            const labelTextOf = (el: Element): string | null => {
                const id = el.id;
                if (id) {
                    const forLabel = document.querySelector(`label[for="${CSS.escape(id)}"]`);
                    if (forLabel && forLabel.textContent && forLabel.textContent.trim()) {
                        return forLabel.textContent.trim().slice(0, 100);
                    }
                }
                const parentLabel = el.closest('label');
                if (parentLabel && parentLabel.textContent && parentLabel.textContent.trim()) {
                    return parentLabel.textContent.trim().slice(0, 100);
                }
                return null;
            };

            const domPathOf = (el: Element): string => {
                const parts: string[] = [];
                let node: Element | null = el;
                let depth = 0;
                while (node && depth < 4) {
                    parts.unshift(node.tagName.toLowerCase());
                    node = node.parentElement;
                    depth += 1;
                }
                return parts.join('>');
            };

            // Role resolution: an EXPLICIT `role` attribute always wins. When
            // absent, derive the IMPLICIT ARIA role for the common native
            // interactive elements so a `getByRole(...)` intent can match a
            // native <button>/<select>/<a>/<input>/<textarea> (which carry no
            // explicit role). Conservative on purpose — only unambiguous
            // mappings per the HTML-AAM; anything uncertain yields no role
            // rather than guessing.
            const implicitRoleOf = (el: Element): string | undefined => {
                const tag = el.tagName.toLowerCase();
                switch (tag) {
                    case 'button':
                        return 'button';
                    case 'a':
                        // Only a link when it is actually a hyperlink.
                        return el.hasAttribute('href') ? 'link' : undefined;
                    case 'select': {
                        // <select multiple> or size>1 is a listbox, not a
                        // combobox — leave ambiguous ones unmapped.
                        const multiple = el.hasAttribute('multiple');
                        const sizeAttr = el.getAttribute('size');
                        const size = sizeAttr ? parseInt(sizeAttr, 10) : 0;
                        return multiple || size > 1 ? undefined : 'combobox';
                    }
                    case 'textarea':
                        return 'textbox';
                    case 'input': {
                        const type = (el.getAttribute('type') || 'text').toLowerCase();
                        switch (type) {
                            case 'checkbox':
                                return 'checkbox';
                            case 'radio':
                                return 'radio';
                            case 'button':
                            case 'submit':
                            case 'reset':
                            case 'image':
                                return 'button';
                            case 'range':
                                return 'slider';
                            case 'text':
                            case 'email':
                            case 'tel':
                            case 'url':
                            case 'search':
                            case 'password':
                                return 'textbox';
                            // Other input types (date, color, file, hidden, …)
                            // have ambiguous/varied roles — leave unmapped.
                            default:
                                return undefined;
                        }
                    }
                    default:
                        return undefined;
                }
            };

            const roleOf = (el: Element): string | undefined => {
                const explicit = el.getAttribute('role');
                if (explicit && explicit.trim()) return explicit.trim();
                return implicitRoleOf(el);
            };

            const nodes = Array.from(document.querySelectorAll(SELECTOR)).slice(0, cap);
            const result: Array<Record<string, unknown>> = [];

            nodes.forEach((el, index) => {
                const text = ((el as HTMLElement).innerText || el.textContent || '').trim();
                result.push({
                    index,
                    visible: isVisible(el),
                    tag: el.tagName.toLowerCase(),
                    id: el.id || undefined,
                    testId: el.getAttribute('data-testid') || el.getAttribute('data-test-id') || undefined,
                    role: roleOf(el) || undefined,
                    accessibleName: accessibleNameOf(el) || undefined,
                    text: text ? text.slice(0, 100) : undefined,
                    label: labelTextOf(el) || undefined,
                    placeholder: el.getAttribute('placeholder') || undefined,
                    type: el.getAttribute('type') || undefined,
                    domPath: domPathOf(el),
                });
            });

            return result as unknown as SnapshotElementBrowser[];
            // ---- end browser context ----
        }, maxElements) as unknown as SnapshotElement[];
    } catch {
        return [];
    }
}

/** Mirror type used only to satisfy the in-browser return annotation. */
interface SnapshotElementBrowser {
    index: number;
    visible: boolean;
    tag?: string;
    id?: string;
    testId?: string;
    role?: string;
    accessibleName?: string;
    text?: string;
    label?: string;
    placeholder?: string;
    type?: string;
    domPath?: string;
}
