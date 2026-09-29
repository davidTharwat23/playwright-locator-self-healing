import { describe, it, expect } from 'vitest';
import { SelfHealing } from './selfHealing';

describe('SelfHealing construction and precedence', () => {
    it('is disabled by default with no options and no env', () => {
        const sh = new SelfHealing({ env: {} });
        expect(sh.isEnabled).toBe(false);
    });

    it('reads the feature flag from the injected env', () => {
        const sh = new SelfHealing({ env: { SELF_HEALING: 'true' } });
        expect(sh.isEnabled).toBe(true);
    });

    it('lets explicit options win over env', () => {
        const sh = new SelfHealing({ enabled: false, env: { SELF_HEALING: 'true' } });
        expect(sh.isEnabled).toBe(false);
    });

    it('lets explicit enabled=true win over env off', () => {
        const sh = new SelfHealing({ enabled: true, env: { SELF_HEALING: 'false' } });
        expect(sh.isEnabled).toBe(true);
    });

    it('merges numeric env with explicit options', () => {
        const sh = new SelfHealing({
            enabled: true,
            env: { SELF_HEALING_CONFIDENCE: '0.7', SELF_HEALING_RETRY_COUNT: '3' },
        });
        expect(sh.config.confidenceThreshold).toBe(0.7);
        expect(sh.config.retryCount).toBe(3);
    });

    it('exposes a resolved, clamped config', () => {
        const sh = new SelfHealing({ confidenceThreshold: 5, env: {} });
        expect(sh.config.confidenceThreshold).toBe(1);
    });
});
