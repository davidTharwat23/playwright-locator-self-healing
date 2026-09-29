# playwright-locator-self-healing

Conservative, safety-first self-healing for Playwright locators.

When a Playwright action fails because a locator no longer matches an element,
this package inspects the live DOM, finds a high-confidence, unique alternative,
and retries the action on it. When the failure is anything else — an assertion,
an API/backend error, a business-state problem — it does **nothing** and lets the
original error surface.

> The goal: **heal broken locators, not broken tests.**

---

## Features

- **Automatic locator healing** — on a failed locator action, finds a high-confidence, unique alternative in the live DOM and retries the original action on it.
- **Failure classification first** — distinguishes a genuine *locator failure* from an *E2E/business-flow failure* (assertion, API/backend error, auth failure, disabled element, ambiguous match). Only locator failures are ever healed.
- **Conservative safety gates** — a candidate is used only if it clears a confidence threshold, is unambiguous, and resolves to **exactly one visible element**. Never binds to a look-alike.
- **Never hides real failures** — the original locator and error are always preserved and re-thrown when healing is unsafe or fails.
- **True feature flag** — `SELF_HEALING=false` (or unset) is a byte-for-byte no-op: identical to plain Playwright, zero added latency on the happy path.
- **One-import integration** — swap `@playwright/test` for this package, or layer it onto your existing extended `test`.
- **Weighted signal scoring** — ranks candidates on test id, id, role, accessible name, text, label, placeholder, type, and tag, with a hard type/tag gate (a button never heals into a div).
- **Healing history (hints)** — remembers successful heals to speed up future breaks; a remembered selector still must pass every safety gate, so stale hints can't mis-heal.
- **Structured CI report** — aggregates every heal attempt into `.healing/healing-report.json` via a Playwright reporter; readable in any CI (GitLab, GitHub Actions, Jenkins).
- **Clear logging** — every attempt prints a readable `[SELF-HEALING]` block (SUCCESS / HEALING_FAILED / E2E_FLOW_FAILURE).
- **Zero runtime dependencies** — `@playwright/test` is a peer dependency; nothing else is pulled in.

---

## Install

```bash
npm install --save-dev playwright-locator-self-healing
```

Requires `@playwright/test` (peer dependency) >= 1.40.

## Enable with a feature flag

```bash
SELF_HEALING=true npx playwright test
```

When `SELF_HEALING` is not truthy (or unset), the package is a **true no-op**:
tests behave exactly as they did before installing it.

## Use it (one import swap)

```typescript
// before
// import { test, expect } from '@playwright/test';

// after
import { test, expect } from 'playwright-locator-self-healing';

test('login', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('login-button').click(); // healed automatically if broken
});
```

The exported `test` is Playwright's `test` with a self-healing `page` fixture
layered on. Every locator the page produces guards its actions; on the happy
path there is zero behavioural change and no added latency.

### Already extending `test`?

Wrap your existing extended test:

```typescript
import { test as base } from './my-fixtures';
import { SelfHealing } from 'playwright-locator-self-healing';

const selfHealing = new SelfHealing({ enabled: process.env.SELF_HEALING === 'true' });
export const test = selfHealing.extendTest(base);
```

## Usage scenarios

**A broken locator gets healed (and the test continues):**

```typescript
import { test } from 'playwright-locator-self-healing';

test('submit works even after the testid was renamed', async ({ page }) => {
    await page.goto('/checkout');
    // The app renamed data-testid="pay" but the button still has role=button,
    // name "Pay now". The engine finds the unique match and retries the click.
    await page.getByTestId('pay').click();
});
```

**A real failure is NOT healed (the original error surfaces):**

```typescript
import { test, expect } from 'playwright-locator-self-healing';

test('assertion failures are never masked', async ({ page }) => {
    await page.goto('/dashboard');
    // The locator resolves fine; the assertion is wrong. This is a business
    // failure, so self-healing does nothing and the assertion error is thrown.
    await expect(page.getByTestId('balance')).toHaveText('WRONG VALUE');
});
```

**Turn it off and it behaves exactly like plain Playwright:**

```bash
npx playwright test          # SELF_HEALING unset -> true no-op
SELF_HEALING=true npx playwright test   # healing active
```

## Configuration

Explicit options win over environment variables, which win over defaults.

| Option | Env var | Default | Meaning |
| --- | --- | --- | --- |
| `enabled` | `SELF_HEALING` | `false` | Master switch. |
| `confidenceThreshold` | `SELF_HEALING_CONFIDENCE` | `0.85` | Minimum confidence (0–1) to use a candidate. |
| `retryCount` | `SELF_HEALING_RETRY_COUNT` | `1` | Retries of the action on a healed locator. |
| `logging` | `SELF_HEALING_LOGGING` | `true` | Emit `[SELF-HEALING]` log blocks. |
| `saveHealingHistory` | `SELF_HEALING_SAVE_HISTORY` | `true` | Persist successful heals as hints. |
| `historyDir` | `SELF_HEALING_HISTORY_DIR` | `.healing` | Directory for history + report files. |

```typescript
const selfHealing = new SelfHealing({
    enabled: process.env.SELF_HEALING === 'true',
    confidenceThreshold: 0.85,
    retryCount: 1,
});
```

## How it decides (safety model)

On a failed action the engine runs a strict pipeline:

1. **Classify** the failure. Only errors that positively match a Playwright
   "element not found / not resolvable" signature are eligible. Assertions,
   HTTP 4xx/5xx, auth failures, disabled/intercepted elements, and strict-mode
   (ambiguous) violations are classified `E2E_FLOW_FAILURE` and never healed.
   Anything unrecognised also defaults to `E2E_FLOW_FAILURE`.
2. **Snapshot** the live DOM and derive candidate elements + their signals
   (test id, id, role, accessible name, text, label, placeholder, type, tag).
3. **Score** each candidate against the original locator's intent using a
   weighted similarity. A `type`/`tag` contradiction (e.g. button → div) is
   heavily penalised.
4. **Gate**. A candidate is used only if it clears the confidence threshold, is
   not tied with a different candidate (ambiguity), and resolves to **exactly
   one visible element** (uniqueness).
5. **Retry** the original action on the healed locator. A heal only counts if
   the action actually succeeds. Otherwise the **original error is rethrown**.

Every attempt is logged and recorded. Healing never hides a real failure: the
original locator and error are always preserved.

## Logging

```
[SELF-HEALING]

Original locator:
getByTestId(login-button)

Original action:
click()

Original locator failed.

Alternative locator:
role=button[name="Login"]

Confidence:
92%

Result:
SUCCESS

The test continued using the healed locator.
```

## Structured report (CI)

Register the reporter to aggregate heal events into `.healing/healing-report.json`:

```typescript
// playwright.config.ts
export default defineConfig({
    reporter: [
        ['list'],
        ['playwright-locator-self-healing/reporter', { outputDir: '.healing' }],
    ],
});
```

Events are written per worker at heal time and merged by the reporter at the end
of the run — correct across Playwright's multi-process model. The report shape:

```json
{
    "generatedAt": "2026-09-29T12:00:00.000Z",
    "summary": { "total": 3, "success": 2, "healingFailed": 1, "notAttempted": 0 },
    "events": [ /* HealingReportEntry[] */ ]
}
```

## Healing history

Successful heals are stored in `.healing/locator-mappings.json` as **hints**: a
remembered selector is tried first on a future break, but it still must pass the
full safety gate, so a stale mapping cannot silently mis-heal. The store sits
behind a `HealingHistoryStore` interface, so the backend can be swapped without
touching the engine. The `.healing/` directory should be gitignored.

## CI

Works headless with no interactive dependency (GitLab CI, GitHub Actions,
Jenkins):

```bash
SELF_HEALING=true SELF_HEALING_CONFIDENCE=0.85 npx playwright test
```

## Scope (v1)

- Playwright only. The core (classifier, scorer, DOM analysis, history) is
  framework-neutral to allow other integrations later.
- Guards the common terminal actions (`click`, `fill`, `type`, `press`,
  `check`, `selectOption`, `hover`, `waitFor`, …).
- Signal-based matching only — no visual/ML matching.
- Does not heal inside cross-origin iframes.

## License

MIT
