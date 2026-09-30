/**
 * Healing executor — the concrete HealingHook that orchestrates the pipeline:
 *
 *   classify -> (locator failure?) -> snapshot DOM -> generate candidates ->
 *   score + safety gate -> retry the REAL action on the healed locator.
 *
 * Safety contract (never hide real failures):
 *   - Non-locator failures are never healed; the original error is rethrown.
 *   - A heal only "succeeds" if the retried action actually completes; a passing
 *     safety gate is necessary but not sufficient.
 *   - On any failure to heal (no candidate, gate rejects, retry throws) the
 *     ORIGINAL error is rethrown so the report points at the intended selector.
 *   - Every outcome is logged and emitted to the report sink.
 */

import type { Locator, Page } from '@playwright/test';
import { classifyFailure } from '../classifier/failureClassifier';
import type { SelfHealingConfig } from '../config/config';
import { FailureClassification, HealingOutcome, HealingReportEntry, SignalProfile } from '../core/types';
import { captureDomSnapshot } from '../locator/domSnapshot';
import { generateCandidates } from '../locator/candidateGenerator';
import { signalsFromConstruction } from '../locator/signals';
import type { HealingLogger } from '../logging/logger';
import type { FailedActionContext, HealingHook, LocatorConstruction } from '../playwright/healingHook';
import { selectSafeCandidate, ScorableCandidate } from '../scoring/safetyGate';
import { createDeadline, Deadline, HealingDeadlineExceeded } from './deadline';

/** Sink that receives a structured entry for every heal attempt. */
export interface ReportSink {
    record(entry: HealingReportEntry): void;
}

/** Optional history hooks (wired in Step 7). Kept minimal and injectable. */
export interface HistoryPort {
    /** Return a previously-successful selector for this locator key, if any. */
    lookup(locatorKey: string): string | undefined;
    /** Persist a successful heal mapping. */
    remember(locatorKey: string, healedSelector: string): void;
}

export interface ExecutorDeps {
    config: SelfHealingConfig;
    logger: HealingLogger;
    report?: ReportSink;
    history?: HistoryPort;
    /**
     * Build a Playwright Locator from a selector string against a page.
     * Injected so the executor is unit-testable without a real page. Defaults
     * to `page.locator(selector)`.
     */
    buildLocator?: (page: Page, selector: string) => Locator;
    /**
     * Count visible elements matching a selector. Injected for tests. Defaults
     * to a Playwright implementation using `locator(...).count()` filtered to
     * visible elements.
     */
    countVisible?: (page: Page, selector: string) => Promise<number>;
}

/** Create the healing hook used by the fixture when enabled. */
export function createHealingExecutor(deps: ExecutorDeps): HealingHook {
    const buildLocator = deps.buildLocator ?? ((page, selector) => page.locator(selector));
    const countVisible = deps.countVisible ?? defaultCountVisible;

    return {
        async onActionFailed(context: FailedActionContext): Promise<unknown> {
            const locatorKey = keyOf(context.descriptor);
            const originalSelector = describeOriginal(context.descriptor);
            const originalError = context.error;

            // 1. Classify. Only locator failures are eligible for healing.
            const { classification, reason } = classifyFailure({
                error: originalError,
                action: context.action,
            });

            if (classification !== FailureClassification.LOCATOR_FAILURE) {
                deps.logger.notLocatorFailure({ classification });
                emit(deps.report, {
                    timestamp: new Date().toISOString(),
                    locatorKey,
                    originalSelector,
                    action: context.action,
                    classification,
                    outcome: HealingOutcome.NOT_ATTEMPTED,
                    originalError: messageOf(originalError),
                });
                throw originalError;
            }

            void reason;

            // Overall healing budget. Every live-page operation below (snapshot,
            // uniqueness probes, retry) is raced against this single deadline so
            // healing cannot outlast healTimeoutMs regardless of how slow any one
            // operation is. This is INDEPENDENT of Playwright's test/action
            // timeouts and only applies on the post-failure healing path — the
            // normal success path never reaches here, so it adds zero overhead.
            const deadline = createDeadline(deps.config.healTimeoutMs);

            try {
                return await runHealingPipeline(context, {
                    deps,
                    deadline,
                    classification,
                    locatorKey,
                    originalSelector,
                    originalError,
                    buildLocator,
                    countVisible,
                });
            } catch (healError) {
                // The budget elapsed mid-pipeline. Report HEALING_FAILED and
                // rethrow the ORIGINAL error promptly; any still-in-flight browser
                // work is now irrelevant to the test outcome.
                if (healError instanceof HealingDeadlineExceeded) {
                    deps.logger.healingFailed({ originalSelector, action: context.action });
                    emit(deps.report, {
                        timestamp: new Date().toISOString(),
                        locatorKey,
                        originalSelector,
                        action: context.action,
                        classification,
                        outcome: HealingOutcome.HEALING_FAILED,
                        originalError: messageOf(originalError),
                    });
                    throw originalError;
                }
                throw healError;
            }
        },
    };
}

/** Dependencies threaded into the bounded healing pipeline. */
interface PipelineDeps {
    deps: ExecutorDeps;
    deadline: Deadline;
    classification: FailureClassification;
    locatorKey: string;
    originalSelector: string;
    originalError: unknown;
    buildLocator: (page: Page, selector: string) => Locator;
    countVisible: (page: Page, selector: string) => Promise<number>;
}

/**
 * The healing pipeline (snapshot -> generate -> gate -> retry), fully bounded by
 * `p.deadline`. Any operation that would block past the deadline instead rejects
 * with `HealingDeadlineExceeded`, which the caller turns into a prompt rethrow of
 * the original error.
 */
async function runHealingPipeline(context: FailedActionContext, p: PipelineDeps): Promise<unknown> {
    const { deps, deadline, classification, locatorKey, originalSelector, originalError } = p;

    // 2. Derive intent + snapshot the live DOM + generate candidates.
    const original: SignalProfile = signalsFromConstruction(context.descriptor);
    const snapshot = await deadline.race(captureDomSnapshot(context.page));
    const generated = generateCandidates(snapshot.filter((el) => el.visible));

    // Bias: if history has a known-good selector for this key, try it first as
    // an extra candidate. It still must pass the gate.
    const candidates: ScorableCandidate[] = generated.map((g) => ({
        selector: g.selector,
        signals: g.element,
    }));
    const historical = deps.history?.lookup(locatorKey);
    if (historical && !candidates.some((c) => c.selector === historical)) {
        candidates.unshift({ selector: historical, signals: original });
    }

    // 3. Score + safety gate (threshold, ambiguity, uniqueness). Each uniqueness
    // probe is raced against the shared deadline so a slow/hanging probe cannot
    // extend healing past the budget.
    const safe = await selectSafeCandidate(
        original,
        candidates,
        (selector) => deadline.race(p.countVisible(context.page, selector)),
        { confidenceThreshold: deps.config.confidenceThreshold },
    );

    if (!safe) {
        deps.logger.healingFailed({ originalSelector, action: context.action });
        emit(deps.report, {
            timestamp: new Date().toISOString(),
            locatorKey,
            originalSelector,
            action: context.action,
            classification,
            outcome: HealingOutcome.HEALING_FAILED,
            originalError: messageOf(originalError),
        });
        throw originalError;
    }

    // 4. Retry the REAL action on the healed locator, bounded by retryCount AND
    // by the remaining budget. The retry's own action timeout is capped to the
    // time left so a healed-but-slow action cannot run to the caller's full
    // action timeout; the whole retry is also raced against the deadline.
    const healedLocator = p.buildLocator(context.page, safe.selector);
    const attempts = Math.max(1, deps.config.retryCount);
    let lastRetryError: unknown;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (deadline.expired()) break;
        try {
            const retryArgs = withRetryTimeout(context.action, context.args, deadline.remaining());
            const result = await deadline.race(context.invoke(healedLocator, retryArgs));
            // SUCCESS — the action actually worked on the healed element.
            deps.logger.success({
                originalSelector,
                action: context.action,
                healedSelector: safe.selector,
                confidence: safe.confidence,
            });
            deps.history?.remember(locatorKey, safe.selector);
            emit(deps.report, {
                timestamp: new Date().toISOString(),
                locatorKey,
                originalSelector,
                action: context.action,
                classification,
                outcome: HealingOutcome.SUCCESS,
                healedSelector: safe.selector,
                confidence: safe.confidence,
                originalError: messageOf(originalError),
            });
            return result;
        } catch (retryError) {
            // A deadline hit during retry propagates up to the prompt rethrow.
            if (retryError instanceof HealingDeadlineExceeded) throw retryError;
            lastRetryError = retryError;
        }
    }

    // Retry exhausted: the gate liked the element but the action still failed.
    // This is NOT a heal — surface the ORIGINAL error.
    void lastRetryError;
    deps.logger.healingFailed({ originalSelector, action: context.action });
    emit(deps.report, {
        timestamp: new Date().toISOString(),
        locatorKey,
        originalSelector,
        action: context.action,
        classification,
        outcome: HealingOutcome.HEALING_FAILED,
        healedSelector: safe.selector,
        confidence: safe.confidence,
        originalError: messageOf(originalError),
    });
    throw originalError;
}

/**
 * Cap a retry action's timeout to the remaining healing budget, mirroring the
 * options-merging rules used for the original probe. `selectOption` and
 * `dispatchEvent` are intentionally excluded (their argument shapes are
 * ambiguous) — those are still bounded by the surrounding `deadline.race`.
 */
function withRetryTimeout(action: string, args: unknown[], remainingMs: number): unknown[] {
    if (!Number.isFinite(remainingMs) || remainingMs <= 0) return args;
    if (!ACTIONS_WITH_TIMEOUT.has(action)) return args;
    const cap = Math.max(1, Math.floor(remainingMs));

    const lastIndex = args.length - 1;
    const last = args[lastIndex];
    const hasOptions = typeof last === 'object' && last !== null && !Array.isArray(last);
    const options = hasOptions ? { ...(last as Record<string, unknown>) } : {};
    const existing = options.timeout;
    if (typeof existing === 'number' && existing > 0 && existing <= cap) return args;
    options.timeout = cap;

    const next = args.slice();
    if (hasOptions) next[lastIndex] = options;
    else next.push(options);
    return next;
}

/** Actions that accept a Playwright `{ timeout }` option (safe to cap). */
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
    'selectText',
    'tap',
    'clear',
    'waitFor',
    'scrollIntoViewIfNeeded',
]);

/** Default visible-match counter using Playwright's locator visibility filter. */
async function defaultCountVisible(page: Page, selector: string): Promise<number> {
    try {
        return await page.locator(selector).locator('visible=true').count();
    } catch {
        try {
            // Fallback: some selector engines don't compose with visible=true.
            return await page.locator(selector).count();
        } catch {
            return 0;
        }
    }
}

/** Stable key for a locator, e.g. "getByTestId:login-button". */
function keyOf(descriptor: LocatorConstruction): string {
    return `${descriptor.method}:${descriptor.primaryArg}`;
}

/** Human-readable original selector for logs/report. */
function describeOriginal(descriptor: LocatorConstruction): string {
    const opts = descriptor.options ? ` ${safeStringify(descriptor.options)}` : '';
    return `${descriptor.method}(${descriptor.primaryArg})${opts}`;
}

function emit(report: ReportSink | undefined, entry: HealingReportEntry): void {
    report?.record(entry);
}

function messageOf(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
}

function safeStringify(value: unknown): string {
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}
