/**
 * Confidence scorer.
 *
 * Given the original locator's intent (a SignalProfile derived from how the
 * author built it) and a candidate element's signals, produce a confidence in
 * [0, 1] that the candidate is the element the author meant.
 *
 * The score is a weighted sum of matching signals, normalised by the weight of
 * the signals the ORIGINAL actually carried (so a locator that only specified a
 * testId is judged on the testId, not penalised for lacking a role). Two hard
 * penalties then apply:
 *   - Type/tag mismatch: a strong, semantic mismatch (e.g. original was a
 *     button-role, candidate is a plain div) heavily caps the score. This is
 *     the "don't heal a button into a div" rule.
 *
 * The uniqueness gate is NOT here — it needs the live page and lives in the
 * safety gate (safetyGate.ts). Scoring is pure and deterministic so it can be
 * unit-tested exhaustively.
 */

import type { SignalProfile } from '../core/types';

/** Per-signal weights. Higher = stronger evidence of identity. */
export const SIGNAL_WEIGHTS = {
    testId: 0.35,
    id: 0.2,
    role: 0.1,
    accessibleName: 0.1,
    label: 0.06,
    placeholder: 0.06,
    text: 0.04,
    type: 0.05,
    tag: 0.04,
} as const;

type WeightedSignal = keyof typeof SIGNAL_WEIGHTS;

const WEIGHTED_SIGNALS = Object.keys(SIGNAL_WEIGHTS) as WeightedSignal[];

export interface ScoreBreakdown {
    confidence: number;
    /** Signals that were present on the original and matched the candidate. */
    matched: WeightedSignal[];
    /** Signals present on the original but not matched by the candidate. */
    missed: WeightedSignal[];
    /** True when a semantic type/tag mismatch capped the score. */
    typeMismatchPenalised: boolean;
}

/**
 * Score a candidate against the original intent.
 *
 * Normalisation: we divide by the total weight of signals the ORIGINAL carried.
 * If the original carried no weighted signals at all, confidence is 0 (nothing
 * to match on — refuse to heal rather than guess).
 */
export function scoreCandidate(original: SignalProfile, candidate: SignalProfile): ScoreBreakdown {
    const matched: WeightedSignal[] = [];
    const missed: WeightedSignal[] = [];

    let originalWeight = 0;
    let matchedWeight = 0;

    for (const signal of WEIGHTED_SIGNALS) {
        const originalValue = original[signal];
        if (originalValue === undefined || originalValue === '') continue;

        const weight = SIGNAL_WEIGHTS[signal];
        originalWeight += weight;

        if (signalMatches(signal, originalValue, candidate[signal])) {
            matched.push(signal);
            matchedWeight += weight;
        } else {
            missed.push(signal);
        }
    }

    if (originalWeight === 0) {
        return { confidence: 0, matched, missed, typeMismatchPenalised: false };
    }

    let confidence = matchedWeight / originalWeight;

    // Hard type/tag gate: if the original expressed a type or tag and the
    // candidate contradicts it, cap confidence low so a cross-type heal can
    // never clear a sensible threshold.
    const typeMismatchPenalised = hasTypeMismatch(original, candidate);
    if (typeMismatchPenalised) {
        confidence = Math.min(confidence, 0.3);
    }

    return { confidence: round(confidence), matched, missed, typeMismatchPenalised };
}

/**
 * Compare one signal. Exact for identifiers (testId/id/type/tag/role);
 * normalised, case-insensitive, with partial credit for human-text signals
 * (accessibleName/label/placeholder/text).
 */
function signalMatches(signal: WeightedSignal, original: string, candidate: string | undefined): boolean {
    if (candidate === undefined) return false;

    const exactSignals: WeightedSignal[] = ['testId', 'id', 'type', 'tag', 'role'];
    if (exactSignals.includes(signal)) {
        return original === candidate;
    }

    // Text-like signals: normalise and allow containment either direction.
    const a = normalize(original);
    const b = normalize(candidate);
    if (a === b) return true;
    if (a.length >= 3 && b.length >= 3 && (a.includes(b) || b.includes(a))) return true;
    return false;
}

/**
 * A type mismatch exists when both sides express a `type` or `tag` and they
 * disagree. Missing values are not a mismatch (we only penalise contradiction,
 * not absence).
 */
function hasTypeMismatch(original: SignalProfile, candidate: SignalProfile): boolean {
    if (original.type && candidate.type && original.type !== candidate.type) return true;
    if (original.tag && candidate.tag && original.tag !== candidate.tag) return true;
    return false;
}

function normalize(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function round(value: number): number {
    return Math.round(value * 100) / 100;
}
