/**
 * ISSUE.md Bug 2 + Bug 3 regression (end-to-end, real browser).
 *
 * Bug 2: a valid, high-confidence, unique heal must apply after the original
 * attempt genuinely fails. The original attempt runs under the CALLER's own
 * timeout (untouched); healing then runs under its own independent budget
 * (`healTimeoutMs`) and applies the heal. (The earlier approach that shortened
 * the original attempt was removed because it interrupted legitimately
 * long-running valid actions.)
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

enabled('BUG2: valid heal applies (original attempt uses the caller timeout)', async ({ page }) => {
    // The original attempt runs under the CALLER's timeout, untouched (here a
    // deliberate short 2s to keep the test quick). After it genuinely fails,
    // healing runs under its own budget and applies the valid heal. This proves
    // the Bug 2 guarantee (heal applies) WITHOUT the old original-attempt cap
    // that would have interrupted a legitimately long action.
    events.length = 0;
    await page.setContent(HTML);

    await page.getByRole('button', { name: 'Save', exact: true }).click({ timeout: 2000 });

    const healed = events.find((e) => e.outcome === 'SUCCESS');
    expect(healed, 'a SUCCESS heal should be recorded').toBeTruthy();
    expect(healed?.healedSelector).toBe('role=button[name="Save changes"]');
    expect(healed?.confidence).toBe(1);
});

enabled('BUG3: SUCCESS heal is followed by a green expect on the result', async ({ page }) => {
    events.length = 0;
    await page.setContent(HTML);

    // The healed click actually fires the onclick handler...
    await page.getByRole('button', { name: 'Save', exact: true }).click({ timeout: 2000 });

    // ...and the very next assertion on a wrapped-page locator must pass
    // (this is the line that went red pre-fix due to Bug 1).
    await expect(page.locator('#done')).toHaveText('OK');

    expect(events.some((e) => e.outcome === 'SUCCESS')).toBe(true);
});
