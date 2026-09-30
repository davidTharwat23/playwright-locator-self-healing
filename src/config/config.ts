/**
 * The self-healing configuration model and its defaults.
 *
 * Configuration is externalised: callers can pass an explicit config object,
 * rely on environment variables (see `env.ts`), or mix both (explicit values
 * win over env). Nothing here is project-specific.
 */

export interface SelfHealingConfig {
    /**
     * Master switch. When false, the integration layer returns the raw
     * Playwright objects untouched — a true no-op. Defaults to false so the
     * package is inert until explicitly enabled.
     */
    enabled: boolean;
    /**
     * Minimum confidence in [0, 1] a candidate must reach before it is used.
     * Conservative default keeps healing from binding to loosely-similar
     * elements. Defaults to 0.85.
     */
    confidenceThreshold: number;
    /**
     * How many times to retry the action against a healed locator before
     * giving up. Defaults to 1.
     */
    retryCount: number;
    /** Whether to emit the [SELF-HEALING] log blocks. Defaults to true. */
    logging: boolean;
    /** Whether successful heals are written to the history store. Defaults to true. */
    saveHealingHistory: boolean;
    /**
     * Directory for the history file. Relative paths resolve against the
     * process working directory. Defaults to '.healing'.
     */
    historyDir: string;
    /**
     * Dedicated time budget, in milliseconds, for the healing work AND for the
     * bounded probe of the ORIGINAL action when healing is enabled.
     *
     * Why this exists (see ISSUE.md Bug 2): healing only runs after the original
     * action throws. If the original action is allowed to consume the whole
     * action/test timeout budget, the enclosing test timeout fires before the
     * heal can snapshot the DOM and retry — so a valid, high-confidence heal
     * never applies under default timeouts. To prevent that race, when healing
     * is enabled the guard runs the original action with an internal probe
     * timeout of at most this value (unless the caller passed a smaller explicit
     * timeout), leaving the rest of the budget for the heal + retry.
     *
     * Defaults to 5000ms. Set to 0 to disable the bounded probe and preserve the
     * caller's original timeout untouched (legacy behaviour).
     */
    healTimeoutMs: number;
}

/** The built-in defaults. `enabled` is false: the package is inert by default. */
export const DEFAULT_CONFIG: SelfHealingConfig = {
    enabled: false,
    confidenceThreshold: 0.85,
    retryCount: 1,
    logging: true,
    saveHealingHistory: true,
    historyDir: '.healing',
    healTimeoutMs: 5000,
};

/**
 * Merge a partial, user-supplied config over the defaults. Only defined keys
 * from `partial` override; `undefined` values fall back to the default so a
 * caller can pass `{ enabled: flag }` without wiping other defaults.
 */
export function resolveConfig(partial: Partial<SelfHealingConfig> = {}): SelfHealingConfig {
    const merged: SelfHealingConfig = { ...DEFAULT_CONFIG };
    (Object.keys(partial) as Array<keyof SelfHealingConfig>).forEach((key) => {
        const value = partial[key];
        if (value !== undefined) {
            // Each key's type is preserved by the keyof mapping.
            (merged as Record<keyof SelfHealingConfig, unknown>)[key] = value;
        }
    });
    return clampConfig(merged);
}

/** Keep numeric config within sane bounds so bad input cannot break healing. */
function clampConfig(config: SelfHealingConfig): SelfHealingConfig {
    return {
        ...config,
        confidenceThreshold: clamp(config.confidenceThreshold, 0, 1),
        retryCount: Math.max(0, Math.floor(config.retryCount)),
        healTimeoutMs: clampHealTimeout(config.healTimeoutMs),
    };
}

function clamp(value: number, min: number, max: number): number {
    if (Number.isNaN(value)) return min;
    return Math.min(max, Math.max(min, value));
}

/**
 * Keep the heal timeout non-negative and integral. A NaN or negative value
 * falls back to the default so bad input cannot break the bounded probe. 0 is
 * a valid value meaning "no bounded probe" (see healTimeoutMs docs).
 */
function clampHealTimeout(value: number): number {
    if (Number.isNaN(value)) return DEFAULT_CONFIG.healTimeoutMs;
    return Math.max(0, Math.floor(value));
}
