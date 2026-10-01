/**
 * PHASE 1 (focused) — Does the parent-descriptor-on-chains limitation cause a
 * MISSED heal (safe) or a MIS-heal (unsafe)?
 *
 * Observation from DC-5: when the FINAL segment of a deep chain fails, the
 * engine logs the ORIGINAL locator as the FIRST factory in the chain
 * (`locator(#outer)`), not the failing chain tip. src/playwright/locatorProxy.ts
 * keeps the parent's descriptor on derived locators by design ("future
 * enhancement"). This spec determines the SAFETY impact.
 *
 * Decisive scenario: a deep chain whose TIP is broken but has exactly ONE
 * unique, high-confidence heal target. If the engine heals it -> intent
 * propagation works well enough. If it refuses -> missed heal (safe, limited).
 * If it heals to the WRONG element -> real defect (unsafe).
 *
 * Run with: npm run test:e2e
 */
import { SelfHealing } from '../../src/index';
import { test as base, expect } from '@playwright/test';

type Entry = { outcome?: string; healedSelector?: string; confidence?: number; originalError?: string };

const events: Entry[] = [];
const enabled = new SelfHealing({
    enabled: true,
    saveHealingHistory: false,
    confidenceThreshold: 0.85,
    report: { record: (e: Entry) => events.push(e) },
}).extendTest(base);

// One unique, clearly-identifiable button that writes to #done when clicked.
// The chain targets it via a broken exact-name tip. A role+name heal to this
// exact element is the ONLY safe option.
const HTML = `<!doctype html><html><body>
  <section id="wrapper">
    <div class="card">
      <button onclick="document.getElementById('done').textContent='HEALED'">Submit order</button>
    </div>
  </section>
  <div id="done"></div>
</body></html>`;

enabled('DCI-1 deep chain, broken tip, unique heal target available', async ({ page }) => {
    events.length = 0;
    await page.setContent(HTML);

    let threw = false;
    let threwMessage = '';
    try {
        // Valid down to .card; the final getByRole is broken by exact name
        // ("Submit" != "Submit order"). The real button is unique.
        await page
            .locator('#wrapper')
            .locator('.card')
            .getByRole('button', { name: 'Submit', exact: true })
            .click({ timeout: 3000 });
    } catch (e) {
        threw = true;
        threwMessage = (e as Error).message ?? '';
    }

    const last = events[events.length - 1];
    const doneText = await page.locator('#done').textContent();
    console.log(
        `[DCI-1] threw=${threw} outcome=${last?.outcome} healed=${last?.healedSelector} ` +
            `conf=${last?.confidence} doneText=${JSON.stringify(doneText)}`,
    );

    // SAFETY ASSERTIONS (the point of this test):
    if (!threw) {
        // If it healed+clicked, it MUST have clicked the RIGHT element.
        expect(doneText, 'a heal must click the intended unique button').toBe('HEALED');
        expect(last?.outcome).toBe('SUCCESS');
    } else {
        // If it refused, that is a MISSED heal (safe): the original error must
        // surface and NOTHING must have been clicked (no mis-heal side effect).
        expect(doneText, 'a refusal must not have clicked anything').toBe('');
        expect(threwMessage.toLowerCase()).toContain('timeout');
    }
});
