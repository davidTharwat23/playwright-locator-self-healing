/**
 * Public API for self-healing-playwright.
 *
 * Step 1 surface: configuration, types, logger, and the `SelfHealing` entry
 * object. The Playwright `test` fixture export is added in Step 2.
 */

export { SelfHealing } from './core/selfHealing';
export type { SelfHealingOptions } from './core/selfHealing';

export { createHealingTest } from './playwright/fixture';
export type { CreateTestParams, AnyTest, PlaywrightTest } from './playwright/fixture';
export { wrapPage } from './playwright/pageProxy';
export { wrapLocator } from './playwright/locatorProxy';
export { passthroughHook } from './playwright/healingHook';
export type { HealingHook, FailedActionContext, LocatorConstruction } from './playwright/healingHook';
export { GUARDED_ACTIONS } from './playwright/actionSurface';

/**
 * A ready-to-use `test` configured from environment variables (SELF_HEALING,
 * etc.). This is the "one import swap" entry point:
 *
 *   import { test } from 'self-healing-playwright';
 *
 * When SELF_HEALING is not truthy, `test` is the untouched Playwright `test`.
 * It is typed as Playwright's own `test` so existing specs keep full typing and
 * autocomplete after swapping the import — the runtime value is either the base
 * Playwright test (disabled) or a `.extend` of it (enabled), both assignable.
 */
import { test as playwrightTest } from '@playwright/test';
import { SelfHealing } from './core/selfHealing';

export const test: typeof playwrightTest = new SelfHealing().extendTest(
    playwrightTest as unknown as import('./playwright/fixture').AnyTest,
) as unknown as typeof playwrightTest;

export { expect } from '@playwright/test';

export { DEFAULT_CONFIG, resolveConfig } from './config/config';
export type { SelfHealingConfig } from './config/config';

export { configFromEnv } from './config/env';
export type { EnvSource } from './config/env';

export { HealingLogger } from './logging/logger';
export type { LogSink, LoggerOptions } from './logging/logger';

export { classifyFailure } from './classifier/failureClassifier';
export type { ClassificationInput, ClassificationResult } from './classifier/failureClassifier';

export { signalsFromConstruction, signalsFromCssSelector } from './locator/signals';
export { captureDomSnapshot } from './locator/domSnapshot';
export type { SnapshotElement } from './locator/domSnapshot';
export { generateCandidate, generateCandidates } from './locator/candidateGenerator';
export type { GeneratedCandidate } from './locator/candidateGenerator';

export { scoreCandidate, SIGNAL_WEIGHTS } from './scoring/confidence';
export type { ScoreBreakdown } from './scoring/confidence';
export { createHealingExecutor } from './healing/executor';
export type { ExecutorDeps, ReportSink, HistoryPort } from './healing/executor';

export { FileHistoryStore, toHistoryPort } from './history/fileStore';
export type { FileHistoryStoreOptions } from './history/fileStore';
export type { HealingHistoryStore, HealingHistoryEntry } from './history/store';

export { FileReportSink } from './reporting/fileReportSink';
export type { FileReportSinkOptions } from './reporting/fileReportSink';
export { default as HealingReporter, buildReport, parseJsonl } from './reporting/reporter';
export type { HealingReport, HealingReporterOptions } from './reporting/reporter';

export { selectSafeCandidate, scoreAll } from './scoring/safetyGate';
export type {
    ScorableCandidate,
    ScoredCandidate,
    SafetyGateOptions,
    SafetyGateResult,
    VisibleMatchCounter,
} from './scoring/safetyGate';

export {
    FailureClassification,
    HealingOutcome,
} from './core/types';
export type {
    LocatorDescriptor,
    SignalProfile,
    HealingCandidate,
    HealingReportEntry,
} from './core/types';
