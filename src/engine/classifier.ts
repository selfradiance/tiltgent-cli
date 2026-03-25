import { getArchetypeById } from "./archetypes";

export type SessionMode = "locked" | "split" | "open";
export type Confidence = "strong" | "slight";

export interface RoundResult {
  winnerArchetypeId: number;
  loserArchetypeId: number;
  confidence: Confidence;
  subQuestion: string;
}

export interface SessionMetrics {
  mode: SessionMode;
  strongPickCount: number;
  winnerCentroid: [number, number, number, number, number];
  loserCentroid: [number, number, number, number, number];
  axisSpread: [number, number, number, number, number];
  axesWithMeaningfulSpread: number;
  pickConsistency: number;
  loserCoherence: number;
}

function weightedCentroid(
  archetypeIds: number[],
  weights: number[]
): [number, number, number, number, number] {
  const centroid: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  let totalWeight = 0;

  for (let i = 0; i < archetypeIds.length; i++) {
    const arch = getArchetypeById(archetypeIds[i]);
    if (!arch) continue;
    const w = weights[i];
    totalWeight += w;
    for (let axis = 0; axis < 5; axis++) {
      centroid[axis] += arch.vector[axis] * w;
    }
  }

  if (totalWeight > 0) {
    for (let axis = 0; axis < 5; axis++) {
      centroid[axis] /= totalWeight;
    }
  }

  return centroid;
}

// How consistently do the winner vectors point in the same direction?
// Returns 0-1 where 1 = all winners clearly on same side of every axis, 0 = scattered
function computePickConsistency(winnerIds: number[]): number {
  if (winnerIds.length <= 1) return 1;

  const vectors = winnerIds
    .map((id) => getArchetypeById(id)?.vector)
    .filter((v): v is [number, number, number, number, number] => v !== undefined);

  if (vectors.length <= 1) return 1;

  // For each axis, measure how strongly winners cluster on one side
  let totalScore = 0;
  for (let axis = 0; axis < 5; axis++) {
    const values = vectors.map((v) => v[axis]);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;

    // If the mean is near zero, winners are scattered on this axis
    const meanStrength = Math.abs(mean);

    // Also check agreement: what fraction of values share the sign of the mean?
    const agreeing = values.filter((v) =>
      mean >= 0 ? v >= -0.1 : v <= 0.1
    ).length;
    const agreementRatio = agreeing / values.length;

    // Axis consistency = strength of lean × agreement
    // Only counts as consistent if the mean is meaningfully non-zero AND most agree
    const axisScore = meanStrength > 0.15 ? agreementRatio * Math.min(meanStrength / 0.5, 1) : 0;
    totalScore += axisScore;
  }

  return totalScore / 5;
}

// How tightly do the loser vectors cluster?
// Returns 0-1 where 1 = very tight cluster, 0 = scattered
function computeLoserCoherence(loserIds: number[]): number {
  if (loserIds.length <= 1) return 1;

  const vectors = loserIds
    .map((id) => getArchetypeById(id)?.vector)
    .filter((v): v is [number, number, number, number, number] => v !== undefined);

  if (vectors.length <= 1) return 1;

  // Compute average pairwise similarity (same-side agreement per axis)
  let totalAgreement = 0;
  let pairCount = 0;

  for (let i = 0; i < vectors.length; i++) {
    for (let j = i + 1; j < vectors.length; j++) {
      let axisAgreement = 0;
      for (let axis = 0; axis < 5; axis++) {
        // Same sign = agreement, both near zero = agreement
        if (
          (vectors[i][axis] >= 0 && vectors[j][axis] >= 0) ||
          (vectors[i][axis] <= 0 && vectors[j][axis] <= 0)
        ) {
          axisAgreement++;
        }
      }
      totalAgreement += axisAgreement / 5;
      pairCount++;
    }
  }

  return pairCount > 0 ? totalAgreement / pairCount : 0;
}

export function classifySession(rounds: RoundResult[]): SessionMetrics {
  const strongPickCount = rounds.filter((r) => r.confidence === "strong").length;

  const winnerIds = rounds.map((r) => r.winnerArchetypeId);
  const loserIds = rounds.map((r) => r.loserArchetypeId);
  const weights = rounds.map((r) => (r.confidence === "strong" ? 2 : 1));

  const winnerCentroid = weightedCentroid(winnerIds, weights);
  const loserCentroid = weightedCentroid(loserIds, weights);

  const axisSpread: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  for (let axis = 0; axis < 5; axis++) {
    axisSpread[axis] = Math.abs(winnerCentroid[axis] - loserCentroid[axis]);
  }

  const axesWithMeaningfulSpread = axisSpread.filter((s) => s > 0.3).length;
  const pickConsistency = computePickConsistency(winnerIds);
  const loserCoherence = computeLoserCoherence(loserIds);

  // Classification
  let mode: SessionMode;

  if (
    strongPickCount >= 2 &&
    axesWithMeaningfulSpread >= 2 &&
    pickConsistency >= 0.4
  ) {
    mode = "locked";
  } else if (
    strongPickCount <= 1 &&
    axesWithMeaningfulSpread <= 1 &&
    pickConsistency < 0.4
  ) {
    mode = "open";
  } else {
    mode = "split";
  }

  return {
    mode,
    strongPickCount,
    winnerCentroid,
    loserCentroid,
    axisSpread,
    axesWithMeaningfulSpread,
    pickConsistency,
    loserCoherence,
  };
}
