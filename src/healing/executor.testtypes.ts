/**
 * Small re-export shim used only by executor.test.ts to keep its imports tidy.
 * Not part of the public API.
 */
export { HealingOutcome } from '../core/types';
export type { HealingReportEntry } from '../core/types';
export type { SnapshotElement as SnapshotElementForTest } from '../locator/domSnapshot';
