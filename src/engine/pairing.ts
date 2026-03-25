import { ARCHETYPES, Archetype, euclideanDistance } from "./archetypes";

export interface ArchetypePair {
  a: Archetype;
  b: Archetype;
  distance: number;
}

// Band thresholds for pairing distance
// 5-round mode (human game): Band 1 (rounds 1-2), Band 2 (rounds 3-5)
// 10-round mode (eval): Band 1 (rounds 1-3), Band 2 (rounds 4-10)
const BAND_1_MIN_DISTANCE = 2.0;
const BAND_2_MIN_DISTANCE = 1.0; // Relaxed from 1.2 to accommodate 10-round sessions
const BAND_2_MAX_DISTANCE = 2.4; // Widened from 2.2 to accommodate 10-round sessions
const BAND_2_MIDPOINT = (BAND_2_MIN_DISTANCE + BAND_2_MAX_DISTANCE) / 2;

function getBand(round: number, totalRounds: number): 1 | 2 {
  if (totalRounds <= 5) {
    // Human game: rounds 1-2 are Band 1
    return round <= 2 ? 1 : 2;
  }
  // Eval mode: rounds 1-3 are Band 1
  return round <= 3 ? 1 : 2;
}

function getCandidatePairs(
  available: Archetype[],
  band: 1 | 2
): ArchetypePair[] {
  const pairs: ArchetypePair[] = [];

  for (let i = 0; i < available.length; i++) {
    for (let j = i + 1; j < available.length; j++) {
      const dist = euclideanDistance(available[i], available[j]);
      pairs.push({ a: available[i], b: available[j], distance: dist });
    }
  }

  switch (band) {
    case 1:
      // High-contrast: wide distance only
      return pairs.filter((p) => p.distance >= BAND_1_MIN_DISTANCE);
    case 2:
      // Medium distance: core signal
      return pairs.filter(
        (p) => p.distance >= BAND_2_MIN_DISTANCE && p.distance <= BAND_2_MAX_DISTANCE
      );
  }
}

/**
 * Select a pair of archetypes for a given round.
 *
 * @param round - Current round number (1-indexed)
 * @param usedIds - Set of archetype IDs already used in this session
 * @param totalRounds - Total number of rounds in this session (5-7)
 * @returns A pair of archetypes, or null if no valid pair is available
 */
export function selectPair(
  round: number,
  usedIds: Set<number>,
  totalRounds: number = 5,
  rng: () => number = Math.random
): ArchetypePair | null {
  const available = ARCHETYPES.filter((a) => !usedIds.has(a.id));

  if (available.length < 2) return null;

  const band = getBand(round, totalRounds);
  let candidates = getCandidatePairs(available, band);

  // If no candidates in the target band, relax constraints progressively
  if (candidates.length === 0) {
    // Try all pairs from available archetypes, sorted by distance
    const allPairs: ArchetypePair[] = [];
    for (let i = 0; i < available.length; i++) {
      for (let j = i + 1; j < available.length; j++) {
        const dist = euclideanDistance(available[i], available[j]);
        allPairs.push({ a: available[i], b: available[j], distance: dist });
      }
    }

    // Sort by how well they match the band's intent
    switch (band) {
      case 1:
        // Want widest distance possible
        allPairs.sort((x, y) => y.distance - x.distance);
        break;
      case 2:
        // Want medium distance — sort by distance from the band midpoint
        allPairs.sort(
          (x, y) =>
            Math.abs(x.distance - BAND_2_MIDPOINT) - Math.abs(y.distance - BAND_2_MIDPOINT)
        );
        break;
    }

    candidates = allPairs.slice(0, Math.min(5, allPairs.length));
  }

  if (candidates.length === 0) return null;

  // Sort candidates by band preference, then pick randomly from top tier
  switch (band) {
    case 1:
      candidates.sort((x, y) => y.distance - x.distance);
      break;
    case 2:
      // Prefer middle of the band
      candidates.sort(
        (x, y) =>
          Math.abs(x.distance - BAND_2_MIDPOINT) - Math.abs(y.distance - BAND_2_MIDPOINT)
      );
      break;
  }

  // Pick randomly from top 3 candidates to add variety
  const topN = Math.min(3, candidates.length);
  const pick = candidates[Math.floor(rng() * topN)];

  return pick;
}

/**
 * Generate all pairings for a full session.
 *
 * @param totalRounds - Number of rounds (default 5 for v1)
 * @returns Array of pairs, one per round
 */
export function generateSessionPairings(
  totalRounds: number = 5,
  rng: () => number = Math.random
): ArchetypePair[] {
  const usedIds = new Set<number>();
  const pairings: ArchetypePair[] = [];

  for (let round = 1; round <= totalRounds; round++) {
    const pair = selectPair(round, usedIds, totalRounds, rng);
    if (!pair) break;

    usedIds.add(pair.a.id);
    usedIds.add(pair.b.id);
    pairings.push(pair);
  }

  return pairings;
}
