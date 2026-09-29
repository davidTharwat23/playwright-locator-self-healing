/**
 * Core domain types for the self-healing engine.
 *
 * This module is framework-agnostic on purpose: it does not import from
 * `@playwright/test`. Playwright-specific types live in the `playwright/`
 * layer. Keeping the core types free of framework imports is what makes it
 * possible to add another framework's integration layer later without
 * touching the engine.
 */

/**
 * How a failure was classified. The engine only ever attempts healing for
 * `LOCATOR_FAILURE`. Everything else is a real test/application problem and
 * must be re-thrown untouched.
 */
export enum FailureClassification {
    /** The failure looks like a locator that no longer matches an element. */
    LOCATOR_FAILURE = 'LOCATOR_FAILURE',
    /**
     * The failure is an assertion, API/backend error, auth error, bad test
     * data, or any failure we do not positively recognise as locator-related.
     * Never healed.
     */
    E2E_FLOW_FAILURE = 'E2E_FLOW_FAILURE',
}

/** Final outcome of a heal attempt, used for logging and reporting. */
export enum HealingOutcome {
    /** A confident, unique alternative was found and the action succeeded. */
    SUCCESS = 'SUCCESS',
    /** No safe alternative was found, or the retried action failed. */
    HEALING_FAILED = 'HEALING_FAILED',
    /** The failure was not locator-related, so healing was never attempted. */
    NOT_ATTEMPTED = 'NOT_ATTEMPTED',
}

/**
 * A description of how the original (failed) locator was constructed. This is
 * the "intent" of the test author, captured so we can compare it to candidate
 * elements found in the DOM. It is a plain data object, not a Playwright
 * Locator, so it is serialisable and framework-neutral.
 */
export interface LocatorDescriptor {
    /**
     * A stable, human-readable key identifying this locator across runs, used
     * as the history key and in logs. Derived from the construction method and
     * arguments, e.g. `getByTestId:login-button`.
     */
    key: string;
    /** How the locator was built, e.g. 'getByTestId', 'getByRole', 'locator'. */
    method: string;
    /** The raw selector/args string the author used, e.g. 'login-button'. */
    raw: string;
    /**
     * The signal profile derived from the construction method: what the author
     * implicitly asked for (a test id, a role + name, some text, etc.). Used by
     * the scorer. Populated by the signal layer in a later step.
     */
    signals?: SignalProfile;
}

/**
 * The set of identifying signals for an element or a locator's intent.
 * All fields optional: a locator built with `getByTestId` only carries a
 * `testId`; an element in the DOM may carry many. Comparison is signal-by-signal.
 */
export interface SignalProfile {
    testId?: string;
    id?: string;
    role?: string;
    accessibleName?: string;
    text?: string;
    label?: string;
    placeholder?: string;
    tag?: string;
    type?: string;
    /** Compact structural path (e.g. tag chain) used only as a tie-breaker. */
    domPath?: string;
}

/**
 * A single healing candidate: a selector we could retry, plus the signals of
 * the element it points to and its computed confidence score.
 */
export interface HealingCandidate {
    /** A Playwright-compatible selector string for this candidate. */
    selector: string;
    /** The signals of the DOM element this candidate points to. */
    signals: SignalProfile;
    /** Confidence in [0, 1] that this is the element the author intended. */
    confidence: number;
}

/**
 * The structured record of one heal attempt. Emitted to logs and to the
 * optional reporter. Always preserves the original locator and error so a
 * real problem is never hidden.
 */
export interface HealingReportEntry {
    /** ISO timestamp of the attempt. */
    timestamp: string;
    /** Stable key of the original locator. */
    locatorKey: string;
    /** How the original locator was built (method + raw). */
    originalSelector: string;
    /** The action being attempted, e.g. 'click', 'fill'. */
    action: string;
    classification: FailureClassification;
    outcome: HealingOutcome;
    /** The healed selector, when outcome is SUCCESS. */
    healedSelector?: string;
    /** Confidence of the chosen candidate, when a candidate was chosen. */
    confidence?: number;
    /** The original Playwright error message, always retained. */
    originalError: string;
}
