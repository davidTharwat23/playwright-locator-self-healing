/**
 * Safety gate: decide whether ANY candidate is safe enough to heal onto.
 *
 * A candidate passes only if ALL hold:
 *   1. Confidence >= configured threshold.
 *   2. It is the single best candidate by a clear margin — if two different
 *      candidates tie at the top, we refuse (ambiguous intent).
 *   3. Its selector resolves to exactly ONE VISIBLE element on the live page
 *      (the uniqueness gate). This is the fix for the prior implementation's
 *      "attached is enough" flaw: attachment/visibility is verified for exactly
 *      one node, so we never bind to a hidden or ambiguous element.
 *
 * If nothing passes, the gate returns null and the caller reports HEALING_FAILED
 * and rethrows the original error. The gate never throws.
 */

import type { SignalProfile } from '../core/types';
import { scoreCandidate } from './confidence';

export interface ScorableCandidate {
    selector: string;
    signals: SignalProfile;
}

export interface ScoredCandidate extends ScorableCandidate {
    confidence: number;
}

/**
 * Verifies how many VISIBLE elements a selector matches on the live page.
 * Injected so the gate is unit-testable without a browser. Must resolve to a
 * count (0, 1, or more) and never throw; on error it should resolve to 0.
 */
export type VisibleMatchCounter = (selector: string) => Promise<number>;

export interface SafetyGateOptions {
    confidenceThreshold: number;
    /**
     * Minimum gap between the best and second-best DISTINCT-selector candidate
     * for the best to be considered unambiguous. Defaults to 0 (any strict
     * lead is enough); set higher to be stricter.
     */
    ambiguityMargin?: number;
}

export interface SafetyGateResult {
    selector: string;
    confidence: number;
    signals: SignalProfile;
}

/** Score raw candidates against the original intent and sort best-first. */
export function scoreAll(
    original: SignalProfile,
    candidates: ScorableCandidate[],
): ScoredCandidate[] {
    return candidates
        .map((candidate) => ({
            ...candidate,
            confidence: scoreCandidate(original, candidate.signals).confidence,
        }))
        .sort((a, b) => b.confidence - a.confidence);
}

/**
 * Run the full gate. Returns the single safe candidate, or null if none qualify.
 *
 * @param original       Signals derived from the failed locator (author intent).
 * @param candidates     Raw candidates from the DOM (selector + signals).
 * @param countVisible   Live-page uniqueness probe (injected).
 * @param options        Threshold + ambiguity settings.
 */
export async function selectSafeCandidate(
    original: SignalProfile,
    candidates: ScorableCandidate[],
    countVisible: VisibleMatchCounter,
    options: SafetyGateOptions,
): Promise<SafetyGateResult | null> {
    const scored = scoreAll(original, candidates);
    if (scored.length === 0) return null;

    const margin = options.ambiguityMargin ?? 0;

    // Walk candidates best-first. The first one that clears the threshold, is
    // unambiguous against the NEXT distinct-selector candidate, and resolves to
    // exactly one visible element, wins.
    for (let i = 0; i < scored.length; i += 1) {
        const candidate = scored[i];

        if (candidate.confidence < options.confidenceThreshold) {
            // Sorted desc: nothing after this can clear the threshold either.
            return null;
        }

        // Ambiguity check against the next candidate with a DIFFERENT selector.
        const nextDistinct = scored.slice(i + 1).find((c) => c.selector !== candidate.selector);
        if (nextDistinct && candidate.confidence - nextDistinct.confidence <= margin) {
            // Two different selectors are essentially tied at the top — refuse
            // to guess between them.
            return null;
        }

        // Uniqueness gate: exactly one visible element must match.
        const count = await safeCount(countVisible, candidate.selector);
        if (count === 1) {
            return { selector: candidate.selector, confidence: candidate.confidence, signals: candidate.signals };
        }
        // count === 0 (gone) or > 1 (ambiguous): skip this candidate and try the
        // next. We do NOT relax the threshold to keep the guarantee strict.
    }

    return null;
}

/** Count wrapper that never throws — a probe error is treated as "no match". */
async function safeCount(countVisible: VisibleMatchCounter, selector: string): Promise<number> {
    try {
        return await countVisible(selector);
    } catch {
        return 0;
    }
}
