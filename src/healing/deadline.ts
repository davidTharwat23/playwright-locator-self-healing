/**
 * A hard time budget for the self-healing pipeline.
 *
 * Healing runs only after an eligible failure, and every operation it performs
 * (DOM snapshot, uniqueness probe, retry) touches a live, possibly-busy page —
 * none of which exposes its own reliable timeout. Without an overall bound, a
 * single slow operation can make healing run far longer than intended (see the
 * >10-minute report). This module provides that bound.
 *
 * Design goals:
 *  - ONE budget for the whole pipeline (`healTimeoutMs`), independent of
 *    Playwright's test/action timeouts.
 *  - `race(promise)` resolves with the operation's result if it finishes in
 *    time, or rejects with a `HealingDeadlineExceeded` the moment the budget
 *    elapses — so no caller ever blocks past the deadline.
 *  - Timers are always cleared; there are NO dangling `setTimeout` handles and
 *    no background polling. When the deadline fires it fires once.
 *
 * IMPORTANT: racing does not, and cannot, abort the underlying async work in
 * the browser. What it guarantees is that the HEALING FLOW stops waiting and
 * returns control immediately. The executor treats a deadline as "healing
 * failed" and rethrows the original error, so any still-in-flight browser
 * operation becomes irrelevant to the test outcome.
 */

/** Error used internally to signal the healing budget elapsed. */
export class HealingDeadlineExceeded extends Error {
    constructor(budgetMs: number) {
        super(`Healing budget of ${budgetMs}ms exceeded`);
        this.name = 'HealingDeadlineExceeded';
    }
}

export interface Deadline {
    /** Milliseconds remaining until the deadline (never negative). */
    remaining(): number;
    /** True once the budget has elapsed. */
    expired(): boolean;
    /**
     * Race an operation against the remaining budget. Resolves with the
     * operation's value if it settles first; rejects with
     * `HealingDeadlineExceeded` if the budget elapses first. The internal timer
     * is always cleared.
     */
    race<T>(operation: Promise<T>): Promise<T>;
}

/**
 * Create a deadline `budgetMs` from now. A budget of 0 (or negative) means "no
 * bound" — `race` passes the operation through unchanged and `remaining()`
 * reports Infinity. This preserves the documented `healTimeoutMs: 0` escape
 * hatch (bounded probe / budget disabled).
 */
export function createDeadline(budgetMs: number): Deadline {
    const unbounded = !budgetMs || budgetMs <= 0;
    const end = Date.now() + budgetMs;

    return {
        remaining(): number {
            if (unbounded) return Number.POSITIVE_INFINITY;
            return Math.max(0, end - Date.now());
        },
        expired(): boolean {
            if (unbounded) return false;
            return Date.now() >= end;
        },
        race<T>(operation: Promise<T>): Promise<T> {
            if (unbounded) return operation;

            const remaining = Math.max(0, end - Date.now());
            let timer: ReturnType<typeof setTimeout> | undefined;

            const timeout = new Promise<never>((_resolve, reject) => {
                timer = setTimeout(() => reject(new HealingDeadlineExceeded(budgetMs)), remaining);
                // Do not keep the event loop alive solely for this timer.
                if (typeof timer === 'object' && typeof (timer as { unref?: () => void }).unref === 'function') {
                    (timer as { unref: () => void }).unref();
                }
            });

            return Promise.race([operation, timeout]).finally(() => {
                if (timer) clearTimeout(timer);
            }) as Promise<T>;
        },
    };
}
