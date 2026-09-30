/**
 * ISSUE.md Bug 2 + Bug 3 regression (end-to-end, real browser).
 *
 * Bug 2: a valid, high-confidence, unique heal must apply under DEFAULT
 * action/test timeouts, not only with a short explicit `click({ timeout })`.
 * The fix bounds the original failing attempt with an internal probe timeout
 * (config.healTimeoutMs) so the heal + retry get a budget before the test
 * timeout fires.
 *
 * Bug 3: after Bug 1 is fixed, a SUCCESS heal is followed by a green test —
 * the healed click fires AND the subsequent `expect(locator)` on the result
 * passes (no Proxy brand failure on the next line).
 *
 * Run with: npm run test:e2e
 */
import { SelfHealing } from '../../src/index';
import { test as base, expect } from '@playwright/test';

type Entry = {
    outcome?: string;
    healedSelector?: string;
    confidence?: number;
    originalError?: string;
};

const events: Entry[] = [];
const enabled = new SelfHealing({
    enabled: true,
    // Keep history/report side effects out of the way; capture events inline.
    saveHealingHistory: false,
    report: { record: (e: Entry) => events.push(e) },
}).extendTest(base);

// Scenario D: the accessible name changed from "Save" to "Save changes"; the
// original locator uses exact:true so it no longer matches, but role=button
// with the new name is a unique, high-confidence heal.
const HTML = `<!doctype html><html><body>
  <div role="button" tabindex="0"
       onclick="document.getElementById('done').textContent='OK'">Save changes</div>
  <div id="done"></div>
</body></html>`;

enabled('BUG2: valid heal applies under DEFAULT timeouts', async ({ page }) => {
    // Default test timeout, no explicit click timeout — the pre-fix failure mode.
    events.length = 0;
    await page.setContent(HTML);

    await page.getByRole('button', { name: 'Save', exact: true }).click();

    const healed = events.find((e) => e.outcome === 'SUCCESS');
    expect(healed, 'a SUCCESS heal should be recorded under default timeouts').toBeTruthy();
    expect(healed?.healedSelector).toBe('role=button[name="Save changes"]');
    expect(healed?.confidence).toBe(1);
});

enabled('BUG3: SUCCESS heal is followed by a green expect on the result', async ({ page }) => {
    events.length = 0;
    await page.setContent(HTML);

    // The healed click actually fires the onclick handler...
    await page.getByRole('button', { name: 'Save', exact: true }).click();

    // ...and the very next assertion on a wrapped-page locator must pass
    // (this is the line that went red pre-fix due to Bug 1).
    await expect(page.locator('#done')).toHaveText('OK');

    expect(events.some((e) => e.outcome === 'SUCCESS')).toBe(true);
});
