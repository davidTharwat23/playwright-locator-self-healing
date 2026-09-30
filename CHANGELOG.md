# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.2.0]: https://github.com/davidTharwat23/playwright-locator-self-healing/releases/tag/v0.2.0
[0.1.0]: https://github.com/davidTharwat23/playwright-locator-self-healing/releases/tag/v0.1.0
