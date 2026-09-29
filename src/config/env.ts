/**
 * Environment-variable parsing for self-healing configuration.
 *
 * Supported variables (all optional):
 *   SELF_HEALING=true|false               -> enabled
 *   SELF_HEALING_CONFIDENCE=0.85          -> confidenceThreshold
 *   SELF_HEALING_RETRY_COUNT=1            -> retryCount
 *   SELF_HEALING_LOGGING=true|false       -> logging
 *   SELF_HEALING_SAVE_HISTORY=true|false  -> saveHealingHistory
 *   SELF_HEALING_HISTORY_DIR=.healing     -> historyDir
 *
 * This lets the feature flag work identically locally and in CI with no
 * interactive dependency. Explicit config passed in code takes precedence
 * over these (see `SelfHealing` construction).
 */

import type { SelfHealingConfig } from './config';

/**
 * The shape of an environment source. Structurally compatible with
 * `process.env` but does not rely on the `NodeJS` global namespace, so this
 * file type-checks even where `@types/node` globals are not in scope.
 */
export type EnvSource = Record<string, string | undefined>;

/**
 * Read config overrides from environment variables. Returns only the keys that
 * were actually present, so it can be layered under explicit config.
 *
 * @param env The environment source. Defaults to `process.env`; injectable for tests.
 */
export function configFromEnv(env: EnvSource = process.env): Partial<SelfHealingConfig> {
    const partial: Partial<SelfHealingConfig> = {};

    const enabled = parseBool(env.SELF_HEALING);
    if (enabled !== undefined) partial.enabled = enabled;

    const confidence = parseNum(env.SELF_HEALING_CONFIDENCE);
    if (confidence !== undefined) partial.confidenceThreshold = confidence;

    const retry = parseNum(env.SELF_HEALING_RETRY_COUNT);
    if (retry !== undefined) partial.retryCount = retry;

    const logging = parseBool(env.SELF_HEALING_LOGGING);
    if (logging !== undefined) partial.logging = logging;

    const saveHistory = parseBool(env.SELF_HEALING_SAVE_HISTORY);
    if (saveHistory !== undefined) partial.saveHealingHistory = saveHistory;

    const historyDir = env.SELF_HEALING_HISTORY_DIR;
    if (historyDir !== undefined && historyDir.trim() !== '') partial.historyDir = historyDir.trim();

    return partial;
}

/** Parse a boolean env var. Accepts true/1/yes/on (case-insensitive). */
function parseBool(value: string | undefined): boolean | undefined {
    if (value === undefined) return undefined;
    const normalized = value.trim().toLowerCase();
    if (normalized === '') return undefined;
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
    // Unrecognised value: treat as "not set" rather than guessing.
    return undefined;
}

/** Parse a numeric env var, returning undefined for missing/invalid input. */
function parseNum(value: string | undefined): number | undefined {
    if (value === undefined || value.trim() === '') return undefined;
    const parsed = Number(value);
    return Number.isNaN(parsed) ? undefined : parsed;
}
