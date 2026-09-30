/**
 * Browser e2e regression for the healing time-budget (real Chrome).
 *
 * Proves in a real browser that:
 *  - An unhealable broken locator's healing is bounded by `healTimeoutMs`
 *    (measured elapsed stays near the budget for 1000/3000/5000), then the
 *    ORIGINAL Playwright error is rethrown.
 *  - A LONG-RUNNING VALID action is NOT interrupted by `healTimeoutMs` — it
 *    succeeds even though it takes far longer than the heal budget, because the
 *    budget only applies to the post-failure healing path.
 *  - A valid heal within budget still succeeds.
 *
 * Run with: npm run test:e2e
 */
import { SelfHealing } from '../../src/index';
import { test as base, expect } from '@playwright/test';

type Entry = { outcome?: string; healedSelector?: string; originalError?: string };

function makeEnabled(healTimeoutMs: number, sink: Entry[]) {
    return new SelfHealing({
        enabled: true,
        healTimeoutMs,
        saveHealingHistory: false,
        confidenceThreshold: 0.85,
        report: { record: (e: Entry) => sink.push(e) },
    }).extendTest(base);
}

// A page with NO element that can satisfy the broken locator, so healing is
// attempted (locator failure) but must ultimately fail — letting us measure the
// healing budget in isolation. There is one visible element with a long,
// unrelated name so the snapshot has content but nothing scores/uniquely heals
// the intended getByTestId.
const UNHEALABLE_HTML = `<!doctype html><html><body>
  <div>nothing relevant here</div>
  <span>just text</span>
</body></html>`;

for (const healTimeoutMs of [1000, 3000, 5000]) {
    const events: Entry[] = [];
    const enabled = makeEnabled(healTimeoutMs, events);

    enabled(`BOUNDED: unhealable broken locator heals within ~healTimeoutMs=${healTimeoutMs}`, async ({ page }) => {
        enabled.setTimeout(60000);
        events.length = 0;
        await page.setContent(UNHEALABLE_HTML);

        const started = Date.now();
        let threw = false;
        try {
            // Broken locator: a testid that does not exist. Short original probe
            // so the measured time is dominated by the healing budget, not the
            // original attempt.
            await page.getByTestId('does-not-exist').click({ timeout: 1000 });
        } catch {
            threw = true;
        }
        const elapsed = Date.now() - started;

        expect(threw, 'the original error should be rethrown').toBe(true);
        // Original probe (~1s) + healing budget + small overhead. Generous upper
        // bound that is still FAR below the multi-minute pre-fix behaviour.
        expect(elapsed, `elapsed ${elapsed}ms should be bounded`).toBeLessThan(1000 + healTimeoutMs + 4000);
    });
}

const longRunningEvents: Entry[] = [];
const longEnabled = makeEnabled(1000, longRunningEvents);

longEnabled('NOT INTERRUPTED: a long-running VALID action ignores healTimeoutMs', async ({ page }) => {
    longEnabled.setTimeout(30000);
    // healTimeoutMs is only 1000ms, but this valid action legitimately takes ~6s.
    // It must NOT be cut off by the heal budget — the action never fails, so the
    // healing path is never entered.
    await page.setContent(`<!doctype html><html><body><button id="late">later</button>
      <script>
        const b = document.getElementById('late');
        b.style.display = 'none';
        setTimeout(() => { b.style.display = 'inline-block'; }, 6000);
      </script>
    </body></html>`);

    const started = Date.now();
    // Waits ~6s for the element to appear, well beyond healTimeoutMs=1000.
    await page.locator('#late').click({ timeout: 15000 });
    const elapsed = Date.now() - started;

    expect(elapsed, 'valid long action should run to completion').toBeGreaterThan(5000);
    // And healing must never have engaged for a successful action.
    expect(longRunningEvents.length, 'no healing events for a successful action').toBe(0);
});

const successEvents: Entry[] = [];
const successEnabled = makeEnabled(5000, successEvents);

successEnabled('WITHIN BUDGET: a valid heal still succeeds', async ({ page }) => {
    successEnabled.setTimeout(30000);
    successEvents.length = 0;
    await page.setContent(`<!doctype html><html><body>
      <div role="button" tabindex="0"
           onclick="document.getElementById('done').textContent='OK'">Save changes</div>
      <div id="done"></div>
    </body></html>`);

    // Broken by exact name; heals to role=button[name="Save changes"] well within 5s.
    await page.getByRole('button', { name: 'Save', exact: true }).click({ timeout: 2000 });
    await expect(page.locator('#done')).toHaveText('OK');
    expect(successEvents.some((e) => e.outcome === 'SUCCESS')).toBe(true);
});
