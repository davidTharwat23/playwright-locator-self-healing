/**
 * The [SELF-HEALING] logger.
 *
 * Formats the human-readable log blocks described in the package spec. Output
 * is plain text so it is readable in any CI console (GitLab, GitHub Actions,
 * Jenkins) with no interactive dependency. Logging can be disabled via config.
 */

import { FailureClassification, HealingOutcome } from '../core/types';

/** A minimal sink so tests can capture output without touching the console. */
export interface LogSink {
    info(message: string): void;
    warn(message: string): void;
}

const consoleSink: LogSink = {
    info: (message) => console.log(message),
    warn: (message) => console.warn(message),
};

export interface LoggerOptions {
    enabled: boolean;
    sink?: LogSink;
}

export class HealingLogger {
    private readonly enabled: boolean;
    private readonly sink: LogSink;

    constructor(options: LoggerOptions) {
        this.enabled = options.enabled;
        this.sink = options.sink ?? consoleSink;
    }

    /** Log a successful heal. */
    success(params: {
        originalSelector: string;
        action: string;
        healedSelector: string;
        confidence: number;
    }): void {
        if (!this.enabled) return;
        this.sink.info(
            block([
                'Original locator:',
                params.originalSelector,
                '',
                `Original action:`,
                `${params.action}()`,
                '',
                'Original locator failed.',
                '',
                'Alternative locator:',
                params.healedSelector,
                '',
                'Confidence:',
                `${toPercent(params.confidence)}%`,
                '',
                'Result:',
                HealingOutcome.SUCCESS,
                '',
                'The test continued using the healed locator.',
            ]),
        );
    }

    /** Log a failed heal (no safe alternative, or retried action failed). */
    healingFailed(params: { originalSelector: string; action: string }): void {
        if (!this.enabled) return;
        this.sink.warn(
            block([
                'Original locator:',
                params.originalSelector,
                '',
                `Original action:`,
                `${params.action}()`,
                '',
                'No reliable alternative locator was found.',
                '',
                'Result:',
                HealingOutcome.HEALING_FAILED,
                '',
                'The original Playwright error will be reported.',
            ]),
        );
    }

    /** Log that healing was not attempted because the failure is not locator-related. */
    notLocatorFailure(params: { classification: FailureClassification }): void {
        if (!this.enabled) return;
        this.sink.info(
            block([
                'Failure detected.',
                '',
                'Classification:',
                params.classification,
                '',
                'Self-Healing was not triggered because the failure does not appear to be locator-related.',
            ]),
        );
    }
}

/** Wrap lines in the [SELF-HEALING] header + blank-line framing. */
function block(lines: string[]): string {
    return ['[SELF-HEALING]', '', ...lines].join('\n');
}

/** Convert a 0..1 confidence to an integer percentage. */
function toPercent(confidence: number): number {
    return Math.round(confidence * 100);
}
