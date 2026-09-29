/**
 * The `SelfHealing` entry-point object.
 *
 * For Step 1 this only resolves and exposes configuration and a logger. The
 * Playwright integration (`extendTest`) is added in Step 2. Keeping it here
 * now fixes the public API shape the spec asked for:
 *
 *   const selfHealing = new SelfHealing({ enabled: process.env.SELF_HEALING === 'true' });
 */

import { resolveConfig, SelfHealingConfig } from '../config/config';
import { configFromEnv, EnvSource } from '../config/env';
import { createHealingExecutor, HistoryPort, ReportSink } from '../healing/executor';
import { FileHistoryStore, toHistoryPort } from '../history/fileStore';
import { FileReportSink } from '../reporting/fileReportSink';
import { HealingLogger, LogSink } from '../logging/logger';
import { createHealingTest, AnyTest, PlaywrightTest } from '../playwright/fixture';
import type { HealingHook } from '../playwright/healingHook';

export interface SelfHealingOptions extends Partial<SelfHealingConfig> {
    /** Optional log sink override, mainly for testing. */
    logSink?: LogSink;
    /** Optional environment source override, mainly for testing. */
    env?: EnvSource;
    /**
     * Optional healing hook override. When omitted, an enabled instance builds
     * the real healing executor. Injectable for testing.
     */
    hook?: HealingHook;
    /** Optional structured report sink (wired by the reporter in Step 8). */
    report?: ReportSink;
    /** Optional healing history store (wired in Step 7). */
    history?: HistoryPort;
}

export class SelfHealing {
    readonly config: SelfHealingConfig;
    readonly logger: HealingLogger;
    private readonly hook: HealingHook;

    /**
     * Precedence: explicit options > environment variables > built-in defaults.
     * This means a caller who passes `{ enabled: true }` always wins, but a
     * caller who passes nothing still respects `SELF_HEALING` from the env.
     */
    constructor(options: SelfHealingOptions = {}) {
        const { logSink, env, hook, report, history, ...explicit } = options;
        const fromEnv = configFromEnv(env);
        this.config = resolveConfig({ ...fromEnv, ...explicit });
        this.logger = new HealingLogger({ enabled: this.config.logging, sink: logSink });

        // Resolve the history port: an explicitly-provided one wins; otherwise,
        // when saving is enabled, build the default file-backed store. When
        // saving is disabled, history is left undefined (no reads or writes).
        const resolvedHistory = history ?? this.buildDefaultHistory();

        // Resolve the report sink: explicit wins; otherwise a default per-worker
        // file sink writes events under the history dir for the reporter to
        // aggregate. Writing happens in the worker at heal time (correct process).
        const resolvedReport = report ?? new FileReportSink({ dir: this.config.historyDir });

        // Explicit hook wins (tests); otherwise build the real executor. The
        // hook is only ever consulted when enabled (the fixture is a no-op when
        // disabled), so constructing it unconditionally is harmless and keeps
        // the type non-optional.
        this.hook =
            hook ??
            createHealingExecutor({
                config: this.config,
                logger: this.logger,
                report: resolvedReport,
                history: resolvedHistory,
            });
    }

    /** Convenience accessor mirroring the feature flag. */
    get isEnabled(): boolean {
        return this.config.enabled;
    }

    /**
     * Build the default file-backed history port when saving is enabled, else
     * undefined (history entirely off — no reads, no writes).
     */
    private buildDefaultHistory(): HistoryPort | undefined {
        if (!this.config.saveHealingHistory) return undefined;
        return toHistoryPort(new FileHistoryStore({ dir: this.config.historyDir }));
    }

    /**
     * Extend a Playwright `test` with a self-healing `page` fixture.
     *
     * When healing is disabled this returns the base test unchanged (a true
     * no-op). Pass a project's already-extended `test` as `baseTest` to layer
     * healing on top of existing fixtures.
     */
    extendTest<T extends AnyTest = PlaywrightTest>(baseTest?: T): T {
        return createHealingTest<T>({ config: this.config, hook: this.hook, baseTest });
    }
}
