import { describe, it, expect } from 'vitest';
import { HealingLogger, LogSink } from './logger';
import { FailureClassification } from '../core/types';

function createCaptureSink(): { sink: LogSink; info: string[]; warn: string[] } {
    const info: string[] = [];
    const warn: string[] = [];
    return {
        info,
        warn,
        sink: {
            info: (m) => info.push(m),
            warn: (m) => warn.push(m),
        },
    };
}

describe('HealingLogger', () => {
    it('emits nothing when disabled', () => {
        const cap = createCaptureSink();
        const logger = new HealingLogger({ enabled: false, sink: cap.sink });
        logger.success({ originalSelector: 'a', action: 'click', healedSelector: 'b', confidence: 0.9 });
        logger.healingFailed({ originalSelector: 'a', action: 'click' });
        logger.notLocatorFailure({ classification: FailureClassification.E2E_FLOW_FAILURE });
        expect(cap.info).toHaveLength(0);
        expect(cap.warn).toHaveLength(0);
    });

    it('formats a success block with percentage confidence', () => {
        const cap = createCaptureSink();
        const logger = new HealingLogger({ enabled: true, sink: cap.sink });
        logger.success({
            originalSelector: '[data-testid="login-button"]',
            action: 'click',
            healedSelector: 'role=button[name="Login"]',
            confidence: 0.92,
        });
        const out = cap.info[0];
        expect(out).toContain('[SELF-HEALING]');
        expect(out).toContain('[data-testid="login-button"]');
        expect(out).toContain('click()');
        expect(out).toContain('role=button[name="Login"]');
        expect(out).toContain('92%');
        expect(out).toContain('SUCCESS');
    });

    it('formats a healing-failed block as a warning', () => {
        const cap = createCaptureSink();
        const logger = new HealingLogger({ enabled: true, sink: cap.sink });
        logger.healingFailed({ originalSelector: '[data-testid="login-button"]', action: 'click' });
        expect(cap.warn).toHaveLength(1);
        expect(cap.warn[0]).toContain('No reliable alternative locator was found.');
        expect(cap.warn[0]).toContain('HEALING_FAILED');
    });

    it('formats a not-locator-failure block', () => {
        const cap = createCaptureSink();
        const logger = new HealingLogger({ enabled: true, sink: cap.sink });
        logger.notLocatorFailure({ classification: FailureClassification.E2E_FLOW_FAILURE });
        expect(cap.info[0]).toContain('E2E_FLOW_FAILURE');
        expect(cap.info[0]).toContain('does not appear to be locator-related');
    });
});
