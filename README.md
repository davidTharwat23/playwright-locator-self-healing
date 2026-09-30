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
| `healTimeoutMs` | `SELF_HEALING_HEAL_TIMEOUT` | `5000` | Overall budget (ms) for the healing work (snapshot + uniqueness probes + retry) after an eligible failure. Does **not** shorten the original action. On expiry, the original error is rethrown. `0` = unbounded. See [Timeouts](#timeouts-and-the-heal-budget). |

```typescript
const selfHealing = new SelfHealing({
    enabled: process.env.SELF_HEALING === 'true',
    confidenceThreshold: 0.85,
    retryCount: 1,
});
```

## How it works

The package wraps Playwright's `page` in a transparent proxy. Every locator
action (`click`, `fill`, `check`, …) runs **normally first** — there is zero
overhead and zero behavioural change on the happy path. Healing only engages
**when an action fails**, and runs this pipeline:

```
page.getByTestId('login-button').click()
        │
        ▼
  run the REAL Playwright action ── succeeds ──▶ done (no healing, no overhead)
        │ fails
        ▼
  [1] Classify the failure
        ├─ not a locator failure (assertion, API 4xx/5xx, auth,
        │   disabled element, ambiguous match, anything unknown)
        │        └──────────────▶ rethrow the ORIGINAL error  (never healed)
        │
        └─ locator failure (element not found / not resolvable)
                 │
                 ▼
  [2] Snapshot the live DOM  → collect candidate elements + their signals
                 │              (testId, id, role, accessible name, text,
                 │               label, placeholder, type, tag)
                 ▼
  [3] Score each candidate vs. the ORIGINAL locator's intent
                 │              (weighted similarity; a button never
                 │               heals into a div — hard type gate)
                 ▼
  [4] Safety gates — a candidate is used ONLY if it:
        • clears the confidence threshold (default 0.85), AND
        • is not tied with another candidate (ambiguity gate), AND
        • resolves to EXACTLY ONE visible element (uniqueness gate)
                 │
        ┌────────┴─────────┐
     none pass          one passes
        │                  │
        ▼                  ▼
  rethrow ORIGINAL   [5] Retry the SAME action on the healed locator
  error (give up)          ├─ action succeeds ─▶ SUCCESS: test continues,
                           │                      heal logged + remembered
                           └─ action fails ────▶ rethrow the ORIGINAL error
```

Key guarantees at every branch: the **original locator and error are always
preserved**, a heal only counts when the retried action **actually works**, and
anything that isn't positively a locator problem is **never touched**. That is
what keeps self-healing from hiding real product or test failures.

### Worked example

Your test does:

```typescript
await page.getByTestId('login-button').click();
```

The app was refactored and the button's `data-testid` changed, so Playwright
can no longer find it and the click fails. The engine:

1. Confirms this is a **locator failure** (not an assertion/API/auth problem).
2. Snapshots the DOM and finds a button whose signals still strongly match the
   original intent — same role `button`, accessible name "Login".
3. Scores it ≥ 0.85 and confirms it is the **only** visible match.
4. Re-runs `click()` on it — which succeeds.

It logs and continues:

```
[SELF-HEALING]
Original locator: getByTestId(login-button)
Original action:  click()
Alternative locator: role=button[name="Login"]
Confidence: 92%
Result: SUCCESS
```

If that button were genuinely gone, or the failure were a real assertion/API
error, nothing would be healed and the test would fail exactly as before.

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

### What can and cannot heal

Scoring only credits signals the **original** locator actually expressed, and
`id`/`testId` are matched **exactly**. A consequence worth calling out:

- A locator built on **role + accessible name / text / label** heals well when
  the DOM shifts, because those signals still describe the intended element.
- A locator built **purely on a changed `#id` or `getByTestId('...')`** scores
  `0` and **cannot heal** — the one thing the author expressed (that exact id or
  test id) no longer exists, and inventing a different element would be a guess,
  not a heal. This is deliberate (conservative safety), but it means the
  headline "the test id was renamed" case only heals when the author also
  located by role/name, not when the test id was the *only* signal.

If you rely on test ids, prefer pairing them with a role/name so a rename
remains healable.

### Timeouts and the heal budget

There are **two independent timeout domains**. Keeping them separate is what
lets self-healing bound its own work without ever interfering with your tests.

**1. Playwright's action / test timeout (yours, untouched).**
The original locator action runs entirely under Playwright's own timeouts — the
per-action `timeout` you pass (e.g. `click({ timeout })`), the project
`actionTimeout`, and the enclosing test `timeout`. Self-healing does **not**
shorten, cap, or otherwise change this. A legitimately long-running valid action
runs to completion exactly as it would without the package.

**2. The self-healing budget: `healTimeoutMs` (default `5000`).**
This applies **only after** an eligible action failure — i.e. only on the
healing path. It is a single overall budget for the whole healing pipeline:

- the DOM snapshot,
- every uniqueness probe in the safety gate, and
- the retry of the action on the healed locator.

Whatever combination of those runs, the total healing work is bounded by
`healTimeoutMs`. When the budget expires, healing stops and the **original
Playwright error is rethrown promptly** (reported as `HEALING_FAILED`). Set
`healTimeoutMs: 0` to make the budget unbounded (not recommended in CI).

**How the two combine on a broken locator.**
Total time ≈ *(the original action's own timeout)* + *(≤ `healTimeoutMs` of
healing)*. The original wait is Playwright's, under your control; only the
healing portion is governed by `healTimeoutMs`.

**Tradeoff — no explicit action timeout.**
Healing can only begin **after** the original action has actually failed, and an
action only "fails" once its timeout elapses. So if you call an action with no
explicit `timeout`, a broken locator must first wait out Playwright's default
action timeout (30s unless you configured `actionTimeout`) before healing even
starts. This is intentional: the package cannot know an action will fail in
advance, and shortening the original attempt would risk interrupting a valid
slow action. If you want a broken locator to fail (and then heal) quickly, pass
an explicit short `timeout` on that call — that timeout is honoured as-is.

**Limitation — the budget bounds waiting, not the browser.**
Enforcing the budget stops the healing flow from *waiting* past `healTimeoutMs`
and hands control back immediately; it does **not** cancel an already-running
Playwright operation (Playwright exposes no cancellation for an in-flight
`count()`/action). A raced operation may briefly finish in the background, but
it is irrelevant to the test outcome — healing has already stopped and rethrown
the original error, and the stray operation cannot extend your test.

**Guidance.** Keep `healTimeoutMs` comfortably below your test `timeout` so the
healing budget always fits inside the test budget after the original action has
failed.

> **Deprecated: `probeTimeoutMs`.** An earlier internal mechanism shortened the
> original attempt to give healing a head start. It has been superseded by the
> independent `healTimeoutMs` budget and no longer shortens the original action
> — it is retained only for backward compatibility and has no effect on the
> original attempt's timeout. Use `healTimeoutMs` to bound healing.

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
