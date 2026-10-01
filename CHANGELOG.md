# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.1] - 2026-09-30

### Fixed

- **Native elements can now heal via `getByRole`.** The DOM snapshot previously
  recorded an element's role from the explicit `role` attribute only. Native
  interactive elements (`<button>`, `<select>`, `<a href>`, `<input>`,
  `<textarea>`) carry no explicit `role`, so a `getByRole(...)` locator — the
  most common Playwright pattern — scored at most 0.5 against them and could
  never clear the confidence threshold to heal. The snapshot now derives the
  **implicit ARIA role** for these native elements (e.g. `<button>` → `button`,
  `<select>` → `combobox`, `<a href>` → `link`, `<input type=checkbox>` →
  `checkbox`, `<textarea>` → `textbox`). An explicit `role` attribute still
  wins, and ambiguous cases (`<select multiple>`, `<input type=date>`, `<a>`
  without `href`) yield no role rather than guessing. No change to the
  confidence threshold, signal weights, scorer, or timeout model.

## [0.3.0] - 2026-09-30

### Fixed

- **Self-healing can no longer hang.** The healing pipeline previously had no
  overall time bound: the DOM snapshot, the safety-gate uniqueness probes, and
  the retry of the action on the healed locator each waited on a live (possibly
  busy) page with no deadline. On slow pages this could make a single
  failed-locator flow run for many minutes — longer than the whole test timeout.

### Changed

- **`healTimeoutMs` is now an independent, overall healing budget.** It bounds
  the *entire* healing pipeline after an eligible failure — snapshot, every
  uniqueness probe, and the retry — as one combined budget. When it expires,
  healing stops and the **original Playwright error is rethrown promptly**
  (reported as `HEALING_FAILED`). `healTimeoutMs: 0` makes it unbounded.
- **The original Playwright action is no longer shortened by self-healing.** The
  first attempt runs entirely under the caller's own timeout (`click({ timeout })`,
  project `actionTimeout`, test `timeout`). Healing engages only *after* that
  attempt genuinely fails, and then only the healing work is bounded by
  `healTimeoutMs`.
- As a direct result, **legitimately long-running valid actions and tests are
  never interrupted by `healTimeoutMs`** — the healing budget applies only to
  the post-failure healing path, never to a successful (if slow) action.

### Deprecated

- **`probeTimeoutMs`** (internal) no longer shortens the original attempt. It is
  retained for backward compatibility but has no effect on the original action's
  timeout; use `healTimeoutMs` to bound healing.

### Notes

- Because healing can only start once an action has actually failed, a broken
  locator called with **no explicit `timeout`** must first wait out Playwright's
  own action timeout before healing begins. Pass an explicit short `timeout` on
  calls where you want a broken locator to fail (and heal) quickly.
- The healing budget bounds how long the healing flow *waits*; it does not
  cancel an already-running Playwright operation (Playwright exposes no
  cancellation). A raced operation may briefly finish in the background but
  cannot extend the test or change its outcome.
- Regression tests added: unit coverage for the healing budget primitive and for
  the whole-pipeline bound (snapshot / probe / retry hangs are cut off at the
  budget), and browser end-to-end specs asserting bounded elapsed time at
  `healTimeoutMs` = 1000/3000/5000 and that a long-running valid action is not
  interrupted.

## [0.2.0] - 2026-09-30

### Fixed

- **`expect(locator)` no longer breaks under `SELF_HEALING=true`.** Guarded
  locators were returned as a `Proxy`, which can fail Playwright's `expect`
  receiver brand check and break every locator assertion on a wrapped page —
  independent of healing. Guarded locators now preserve the real Locator's
  identity and brand (built via `Object.create` on the real locator), so
  `expect(page.locator(...))`, `instanceof`, and internal Playwright checks all
  behave exactly as on a plain locator.
- **Valid, high-confidence heals now apply under default timeouts.** Previously
  the failing original action could consume the whole action/test timeout, so
  the heal lost the race to the test timeout and never ran. The original attempt
  is now bounded by an internal probe timeout, leaving budget for the DOM
  snapshot and retry. The retry still uses the caller's original timeout.
- A reported `SUCCESS` heal is no longer followed by a red test caused by the
  `expect` issue above.

### Added

- **`healTimeoutMs` configuration option** (env `SELF_HEALING_HEAL_TIMEOUT`,
  default `5000`). Dedicated time budget that bounds the original action attempt
  when healing is enabled. A caller-supplied timeout smaller than this is never
  widened; set to `0` to disable the bounded probe (legacy behaviour).
- Regression tests: unit coverage for locator identity/brand and the bounded
  probe timeout; browser end-to-end specs (`npm run test:e2e`) proving
  `expect()` works on wrapped-page locators and that a valid heal applies under
  default timeouts.

### Documentation

- Documented the heal time budget and its interaction with Playwright's
  `actionTimeout` / test `timeout`.
- Clarified that locators built purely on a changed `id`/`testId` cannot
  self-heal (exact-match signals); pair test ids with role/name to stay
  healable.

### Notes

- The no-op-when-disabled guarantee and the conservative safety model are
  unchanged. `selectOption` and `dispatchEvent` are intentionally excluded from
  probe-timeout injection because their argument shapes are ambiguous; they
  still heal, just without the tightened first-attempt bound.

## [0.1.0] - 2026-09-29

### Added

- Initial release: conservative, safety-first self-healing for Playwright
  locators — classify, snapshot, generate candidates, score, safety gate, and
  retry the real action. Heals genuine locator failures only; never heals
  assertions, HTTP/auth failures, disabled elements, or ambiguous matches.

[0.3.0]: https://github.com/davidTharwat23/playwright-locator-self-healing/releases/tag/v0.3.0
[0.2.0]: https://github.com/davidTharwat23/playwright-locator-self-healing/releases/tag/v0.2.0
[0.1.0]: https://github.com/davidTharwat23/playwright-locator-self-healing/releases/tag/v0.1.0
