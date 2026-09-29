/**
 * Healing history — storage interface.
 *
 * The engine only ever depends on this interface (via the executor's
 * `HistoryPort`), never on a concrete store. That is what lets the storage
 * mechanism be swapped later (a DB, a shared cache, an HTTP service) without
 * touching the healing engine.
 *
 * A history entry records that a locator identified by `key` was successfully
 * healed to `healedSelector`. It is a HINT for future runs: the executor may
 * try a remembered selector first, but it still must pass the full safety gate
 * (confidence + uniqueness + ambiguity) before it can be used. A stale mapping
 * therefore cannot silently mis-heal.
 */

export interface HealingHistoryEntry {
    /** Stable locator key, e.g. "getByTestId:login-button". */
    key: string;
    /** The selector that healed it last time. */
    healedSelector: string;
    /** ISO timestamp of the last successful heal. */
    updatedAt: string;
    /** How many times this mapping has been (re)confirmed. */
    hitCount: number;
}

/**
 * Storage-agnostic history store. Implementations must be resilient: read/write
 * failures should degrade gracefully (return undefined / no-op) and never throw
 * into a running test.
 */
export interface HealingHistoryStore {
    /** Return the remembered selector for a key, or undefined. Must not throw. */
    get(key: string): string | undefined;
    /** Record (or refresh) a successful heal mapping. Must not throw. */
    set(key: string, healedSelector: string): void;
    /** All entries (read-only), mainly for reporting/inspection. */
    entries(): HealingHistoryEntry[];
}
