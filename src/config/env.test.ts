import { describe, it, expect } from 'vitest';
import { configFromEnv } from './env';

describe('configFromEnv', () => {
    it('returns an empty object when no relevant vars are set', () => {
        expect(configFromEnv({})).toEqual({});
    });

    it('parses SELF_HEALING truthy values', () => {
        expect(configFromEnv({ SELF_HEALING: 'true' }).enabled).toBe(true);
        expect(configFromEnv({ SELF_HEALING: '1' }).enabled).toBe(true);
        expect(configFromEnv({ SELF_HEALING: 'YES' }).enabled).toBe(true);
        expect(configFromEnv({ SELF_HEALING: 'on' }).enabled).toBe(true);
    });

    it('parses SELF_HEALING falsy values', () => {
        expect(configFromEnv({ SELF_HEALING: 'false' }).enabled).toBe(false);
        expect(configFromEnv({ SELF_HEALING: '0' }).enabled).toBe(false);
        expect(configFromEnv({ SELF_HEALING: 'off' }).enabled).toBe(false);
    });

    it('treats an unrecognised SELF_HEALING value as not set', () => {
        expect(configFromEnv({ SELF_HEALING: 'maybe' }).enabled).toBeUndefined();
        expect(configFromEnv({ SELF_HEALING: '' }).enabled).toBeUndefined();
    });

    it('parses numeric confidence and retry vars', () => {
        const config = configFromEnv({
            SELF_HEALING_CONFIDENCE: '0.9',
            SELF_HEALING_RETRY_COUNT: '2',
        });
        expect(config.confidenceThreshold).toBe(0.9);
        expect(config.retryCount).toBe(2);
    });

    it('ignores invalid numeric vars', () => {
        const config = configFromEnv({ SELF_HEALING_CONFIDENCE: 'abc', SELF_HEALING_RETRY_COUNT: '' });
        expect(config.confidenceThreshold).toBeUndefined();
        expect(config.retryCount).toBeUndefined();
    });

    it('parses logging, save-history, and history-dir', () => {
        const config = configFromEnv({
            SELF_HEALING_LOGGING: 'false',
            SELF_HEALING_SAVE_HISTORY: 'true',
            SELF_HEALING_HISTORY_DIR: '  custom/.heal  ',
        });
        expect(config.logging).toBe(false);
        expect(config.saveHealingHistory).toBe(true);
        expect(config.historyDir).toBe('custom/.heal');
    });

    it('ignores a blank history dir', () => {
        expect(configFromEnv({ SELF_HEALING_HISTORY_DIR: '   ' }).historyDir).toBeUndefined();
    });
});
