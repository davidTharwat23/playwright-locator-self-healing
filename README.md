# playwright-locator-self-healing

Conservative, safety-first self-healing for Playwright locators.

When a Playwright action fails because a locator no longer matches an element,
this package inspects the live DOM, finds a high-confidence, unique alternative,
and retries the action on it. When the failure is anything else — an assertion,
an API/backend error, a business-state problem — it does **nothing** and lets the
original error surface.

> The goal: **heal broken locators, not broken tests.**

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
