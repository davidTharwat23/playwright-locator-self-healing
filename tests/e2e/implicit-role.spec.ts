/**
 * F-2 REGRESSION (end-to-end, real browser) — implicit ARIA role capture.
 *
 * Before the fix, `domSnapshot.ts` captured `role` from the explicit `role`
 * attribute only, so native interactive elements (<button>, <select>, <a href>,
 * <input>, <textarea>) reported role=undefined. A `getByRole(...)` intent
 * therefore scored at most 0.5 (accessible-name only) and could NOT heal — the
 * single most common Playwright locator pattern.
 *
 * The fix derives the IMPLICIT ARIA role for native elements in the DOM
 * snapshot (explicit `role` still wins; ambiguous cases yield no role). These
 * tests lock that in: direct snapshot assertions + end-to-end heal proofs.
 *
 * Run with: npm run test:e2e
 */
import { SelfHealing, captureDomSnapshot } from '../../src/index';
import { test as base, expect } from '@playwright/test';

type Entry = { outcome?: string; healedSelector?: string; confidence?: number };

function roleOfTag(snapshot: Awaited<ReturnType<typeof captureDomSnapshot>>, tag: string): string | undefined {
    return snapshot.find((e) => e.tag === tag)?.role;
}

// ── Direct snapshot assertions (the data-capture regression) ──────────────────

base('IR-1 native elements get implicit ARIA roles in the snapshot', async ({ page }) => {
    await page.setContent(`<!doctype html><html><body>
      <button aria-label="B">b</button>
      <a href="/x" aria-label="L">l</a>
      <select aria-label="S"><option>o</option></select>
      <textarea aria-label="T"></textarea>
      <input type="checkbox" aria-label="C">
      <input type="radio" aria-label="R">
      <input type="text" aria-label="X">
    </body></html>`);
    const snap = await captureDomSnapshot(page);

    expect(roleOfTag(snap, 'button'), '<button> -> button').toBe('button');
    expect(roleOfTag(snap, 'a'), '<a href> -> link').toBe('link');
    expect(roleOfTag(snap, 'select'), '<select> -> combobox').toBe('combobox');
    expect(roleOfTag(snap, 'textarea'), '<textarea> -> textbox').toBe('textbox');
    const inputs = snap.filter((e) => e.tag === 'input');
    expect(inputs.find((i) => i.type === 'checkbox')?.role, 'checkbox').toBe('checkbox');
    expect(inputs.find((i) => i.type === 'radio')?.role, 'radio').toBe('radio');
    expect(inputs.find((i) => i.type === 'text')?.role, 'text input -> textbox').toBe('textbox');
});

base('IR-2 explicit role attribute always wins over the implicit role', async ({ page }) => {
    await page.setContent(`<!doctype html><html><body>
      <button role="tab" aria-label="Explicit">x</button>
    </body></html>`);
    const snap = await captureDomSnapshot(page);
    expect(roleOfTag(snap, 'button'), 'explicit role=tab must win over implicit button').toBe('tab');
});

base('IR-3 ambiguous native elements yield NO role (conservative)', async ({ page }) => {
    await page.setContent(`<!doctype html><html><body>
      <select multiple aria-label="M"><option>o</option></select>
      <input type="date" aria-label="D">
      <a aria-label="NoHref">n</a>
    </body></html>`);
    const snap = await captureDomSnapshot(page);
    expect(roleOfTag(snap, 'select'), '<select multiple> is a listbox, not combobox -> no implicit role').toBeUndefined();
    expect(snap.find((e) => e.tag === 'input' && e.type === 'date')?.role, 'date input -> no implicit role').toBeUndefined();
    expect(roleOfTag(snap, 'a'), '<a> without href -> no implicit link role').toBeUndefined();
});

// ── End-to-end heal proofs (the behavioural regression) ───────────────────────

const btnEvents: Entry[] = [];
const btnHealing = new SelfHealing({
    enabled: true,
    saveHealingHistory: false,
    confidenceThreshold: 0.85,
    report: { record: (e: Entry) => btnEvents.push(e) },
}).extendTest(base);

btnHealing('IR-4 native <button> getByRole heals (was impossible pre-fix)', async ({ page }) => {
    btnEvents.length = 0;
    await page.setContent(`<!doctype html><html><body>
      <button onclick="document.getElementById('done').textContent='OK'">Save changes</button>
      <div id="done"></div>
    </body></html>`);
    // Broken by exact name; the native <button> now exposes role=button so a
    // role+name heal clears the 0.85 threshold.
    await page.getByRole('button', { name: 'Save', exact: true }).click({ timeout: 3000 });
    await expect(page.locator('#done')).toHaveText('OK');
    expect(btnEvents.some((e) => e.outcome === 'SUCCESS'), 'native button should heal').toBe(true);
});

const selEvents: Entry[] = [];
const selHealing = new SelfHealing({
    enabled: true,
    saveHealingHistory: false,
    confidenceThreshold: 0.85,
    report: { record: (e: Entry) => selEvents.push(e) },
}).extendTest(base);

selHealing('IR-5 native <select> selectOption heals (SO-3 regression)', async ({ page }) => {
    selEvents.length = 0;
    await page.setContent(`<!doctype html><html><body>
      <select aria-label="Country"><option value="es">Spain</option><option value="de">Germany</option></select>
      <div id="out"></div>
      <script>
        document.querySelector('select').addEventListener('change', e =>
          document.getElementById('out').textContent = e.target.value);
      </script>
    </body></html>`);
    // Broken by a wrong exact name; native <select> now exposes role=combobox.
    await page.getByRole('combobox', { name: 'Country X', exact: true }).selectOption('de', { timeout: 3000 });
    await expect(page.locator('#out'), 'original value de must apply through the heal').toHaveText('de');
    expect(selEvents.some((e) => e.outcome === 'SUCCESS'), 'native select should heal').toBe(true);
});
