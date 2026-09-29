import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG, resolveConfig } from './config';

describe('resolveConfig', () => {
    it('returns the defaults when nothing is passed', () => {
        expect(resolveConfig()).toEqual(DEFAULT_CONFIG);
    });

    it('is disabled by default (inert package)', () => {
        expect(resolveConfig().enabled).toBe(false);
    });

    it('overrides only the provided keys', () => {
        const config = resolveConfig({ enabled: true, retryCount: 3 });
        expect(config.enabled).toBe(true);
        expect(config.retryCount).toBe(3);
        // Untouched keys keep defaults.
        expect(config.confidenceThreshold).toBe(DEFAULT_CONFIG.confidenceThreshold);
        expect(config.logging).toBe(DEFAULT_CONFIG.logging);
    });

    it('ignores undefined values in the partial', () => {
        const config = resolveConfig({ enabled: undefined, confidenceThreshold: undefined });
        expect(config).toEqual(DEFAULT_CONFIG);
    });

    it('clamps confidenceThreshold into [0, 1]', () => {
        expect(resolveConfig({ confidenceThreshold: 1.7 }).confidenceThreshold).toBe(1);
        expect(resolveConfig({ confidenceThreshold: -0.5 }).confidenceThreshold).toBe(0);
    });

    it('falls back to 0 for a NaN confidenceThreshold', () => {
        expect(resolveConfig({ confidenceThreshold: Number.NaN }).confidenceThreshold).toBe(0);
    });

    it('floors and floors-out negative retryCount', () => {
        expect(resolveConfig({ retryCount: 2.9 }).retryCount).toBe(2);
        expect(resolveConfig({ retryCount: -3 }).retryCount).toBe(0);
    });

    it('does not mutate DEFAULT_CONFIG', () => {
        resolveConfig({ enabled: true, retryCount: 9 });
        expect(DEFAULT_CONFIG.enabled).toBe(false);
        expect(DEFAULT_CONFIG.retryCount).toBe(1);
    });
});
