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
}

/** The built-in defaults. `enabled` is false: the package is inert by default. */
export const DEFAULT_CONFIG: SelfHealingConfig = {
    enabled: false,
    confidenceThreshold: 0.85,
    retryCount: 1,
    logging: true,
    saveHealingHistory: true,
    historyDir: '.healing',
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
    };
}

function clamp(value: number, min: number, max: number): number {
    if (Number.isNaN(value)) return min;
    return Math.min(max, Math.max(min, value));
}
