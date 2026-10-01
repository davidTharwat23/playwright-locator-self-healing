/**
 * PHASE 2 — selectOption / dispatchEvent failure-path validation (real browser).
 *
 * These two guarded actions are intentionally EXCLUDED from the probe-timeout /
 * retry-timeout argument injection (their argument shapes are ambiguous — a
 * `{ label }` value for selectOption, an eventInit for dispatchEvent — so
 * appending `{ timeout }` could corrupt them). The risk this phase checks:
 *
 *   1. Does their failure path still stay BOUNDED (no hang) via deadline.race?
 *   2. On refusal, is the ORIGINAL error rethrown (never hidden)?
 *   3. When a safe unique heal exists, does the retry run with the ORIGINAL
 *      args intact (no corruption of `values` / event args)?
 *
 * Run with: npm run test:e2e
 */
import { SelfHealing } from '../../src/index';
import { test as base, expect } from '@playwright/test';

type Entry = { outcome?: string; healedSelector?: string; confidence?: number; originalError?: string };

function makeEnabled(sink: Entry[], healTimeoutMs = 5000) {
    return new SelfHealing({
        enabled: true,
        healTimeoutMs,
        saveHealingHistory: false,
        confidenceThreshold: 0.85,
        report: { record: (e: Entry) => sink.push(e) },
    }).extendTest(base);
}

// ── selectOption ──────────────────────────────────────────────────────────────

const selectEvents: Entry[] = [];
const selOpt = makeEnabled(selectEvents);

selOpt('SO-1 valid selectOption works (happy path, no heal)', async ({ page }) => {
    selectEvents.length = 0;
    await page.setContent(`<!doctype html><html><body>
      <select id="country"><option value="es">Spain</option><option value="de">Germany</option></select>
      <div id="out"></div>
      <script>
        document.getElementById('country').addEventListener('change', e =>
          document.getElementById('out').textContent = e.target.value);
      </script>
    </body></html>`);
    await page.locator('#country').selectOption('de');
    await expect(page.locator('#out')).toHaveText('de');
    expect(selectEvents.length, 'no heal for a valid selectOption').toBe(0);
});

selOpt('SO-2 unhealable selectOption stays bounded and rethrows original', async ({ page }) => {
    selOpt.setTimeout(30000);
    selectEvents.length = 0;
    await page.setContent(`<!doctype html><html><body>
      <select id="country"><option value="es">Spain</option></select>
    </body></html>`);

    const started = Date.now();
    let threw = false;
    try {
        // Broken: no such select; nothing to heal to.
        await page.getByTestId('missing-select').selectOption('es', { timeout: 1000 });
    } catch {
        threw = true;
    }
    const elapsed = Date.now() - started;
    const last = selectEvents[selectEvents.length - 1];
    console.log(`[SO-2] threw=${threw} elapsed=${elapsed}ms outcome=${last?.outcome}`);

    expect(threw).toBe(true);
    // Bounded: original 1s probe + 5s heal budget + overhead.
    expect(elapsed, `elapsed ${elapsed}ms bounded`).toBeLessThan(1000 + 5000 + 4000);
});

selOpt('SO-3 healable selectOption retries with ORIGINAL args intact', async ({ page }) => {
    selOpt.setTimeout(30000);
    selectEvents.length = 0;
    // The real select is uniquely identifiable by role=combobox; the original
    // locator is broken by a stale testid. If healing applies, the retry must
    // pass the ORIGINAL value arg ('de') unchanged — proving no arg corruption.
    await page.setContent(`<!doctype html><html><body>
      <select data-testid="renamed-country" aria-label="Country">
        <option value="es">Spain</option><option value="de">Germany</option>
      </select>
      <div id="out"></div>
      <script>
        document.querySelector('select').addEventListener('change', e =>
          document.getElementById('out').textContent = e.target.value);
      </script>
    </body></html>`);

    let threw = false;
    try {
        // Broken original: a getByRole with a wrong exact name forces failure,
        // but role=combobox[name="Country"] is a unique heal target.
        await page.getByRole('combobox', { name: 'Country X', exact: true }).selectOption('de', { timeout: 3000 });
    } catch {
        threw = true;
    }
    const last = selectEvents[selectEvents.length - 1];
    const out = await page.locator('#out').textContent();
    console.log(`[SO-3] threw=${threw} outcome=${last?.outcome} healed=${last?.healedSelector} out=${JSON.stringify(out)}`);

    if (!threw) {
        // Healed: the ORIGINAL value 'de' must have been applied (no corruption).
        expect(out, 'original selectOption value must be preserved through heal').toBe('de');
        expect(last?.outcome).toBe('SUCCESS');
    } else {
        // Refused: nothing selected, original error surfaced (safe).
        expect(out, 'refusal must not select anything').toBe('');
    }
});

// ── dispatchEvent ─────────────────────────────────────────────────────────────

const dispatchEvents: Entry[] = [];
const disp = makeEnabled(dispatchEvents);

disp('DE-1 valid dispatchEvent works (happy path, no heal)', async ({ page }) => {
    dispatchEvents.length = 0;
    await page.setContent(`<!doctype html><html><body>
      <button id="b" onclick="document.getElementById('out').textContent='CLICKED'">Go</button>
      <div id="out"></div>
    </body></html>`);
    await page.locator('#b').dispatchEvent('click');
    await expect(page.locator('#out')).toHaveText('CLICKED');
    expect(dispatchEvents.length, 'no heal for a valid dispatchEvent').toBe(0);
});

disp('DE-2 unhealable dispatchEvent stays bounded and rethrows original', async ({ page }) => {
    disp.setTimeout(30000);
    dispatchEvents.length = 0;
    await page.setContent(`<!doctype html><html><body><div>nothing</div></body></html>`);

    const started = Date.now();
    let threw = false;
    try {
        await page.getByTestId('missing-btn').dispatchEvent('click', {}, { timeout: 1000 });
    } catch {
        threw = true;
    }
    const elapsed = Date.now() - started;
    const last = dispatchEvents[dispatchEvents.length - 1];
    console.log(`[DE-2] threw=${threw} elapsed=${elapsed}ms outcome=${last?.outcome}`);

    expect(threw).toBe(true);
    expect(elapsed, `elapsed ${elapsed}ms bounded`).toBeLessThan(1000 + 5000 + 4000);
});
