/**
 * ISSUE.md Bug 1 regression (end-to-end, real browser).
 *
 * `expect(page.locator(...))` and `expect(page.getByRole(...))` must work under
 * SELF_HEALING=true, exactly as with plain Playwright. Before the fix, the
 * wrapped-page locator was a Proxy that could fail Playwright's `expect`
 * receiver brand check, breaking EVERY locator assertion. The fix returns a
 * prototype-delegating child (not a Proxy), preserving identity and brand.
 *
 * Run with: npm run test:e2e
 */
import { SelfHealing } from '../../src/index';
import { test as base, expect } from '@playwright/test';

const enabled = new SelfHealing({ enabled: true }).extendTest(base);
const disabled = new SelfHealing({ enabled: false }).extendTest(base);

const HTML = `<!doctype html><html><body>
  <div id="x">hello</div>
  <button>Save changes</button>
  <ul><li class="row">a</li><li class="row">b</li></ul>
</body></html>`;

enabled('ENABLED: expect on a wrapped-page page.locator', async ({ page }) => {
    await page.setContent(HTML);
    await expect(page.locator('#x')).toHaveText('hello');
});

enabled('ENABLED: expect on a wrapped-page getByRole', async ({ page }) => {
    await page.setContent(HTML);
    await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible();
});

enabled('ENABLED: expect on a chained wrapped-page locator', async ({ page }) => {
    await page.setContent(HTML);
    await expect(page.locator('ul').locator('.row').first()).toHaveText('a');
});

disabled('DISABLED: control — expect on a normal locator passes', async ({ page }) => {
    await page.setContent(HTML);
    await expect(page.locator('#x')).toHaveText('hello');
});
