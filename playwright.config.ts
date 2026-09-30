import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the package's browser-based regression tests.
 *
 * These specs live in `tests/e2e` and are kept separate from the vitest unit
 * suite (`npm test`, which matches `**\/*.test.ts`). They serve inline HTML and
 * exercise the real integration in a browser — proving the ISSUE.md fixes
 * end-to-end. Run them with `npm run test:e2e`.
 *
 * They are intentionally NOT part of `npm test`/CI because they require a
 * browser download; CI relies on the browserless vitest coverage instead.
 */
export default defineConfig({
    testDir: './tests/e2e',
    testMatch: '**/*.spec.ts',
    fullyParallel: true,
    reporter: 'list',
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
