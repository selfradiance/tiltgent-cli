import type { EvalProfile } from '../engine/eval-pipeline.js';

const DIMENSION_KEYS = [
  'order_emergence',
  'humanist_systems',
  'stability_dynamism',
  'local_coordinated',
  'tradition_reinvention',
] as const;

const REQUIRED_TEXT_FIELDS = [
  'archetype_name',
  'contradiction_line',
  'how_you_decide',
  'what_wins_you_over',
  'what_you_resist',
  'pattern_receipt',
  'agent_prompt_snippet',
] as const;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function hasDimensionScores(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;

  const dims = value as Record<string, unknown>;
  return DIMENSION_KEYS.every((key) => isFiniteNumber(dims[key]));
}

function hasParseLayerDistribution(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;

  const distribution = value as Record<string, unknown>;
  return (
    isFiniteNumber(distribution.layer1) &&
    isFiniteNumber(distribution.layer2) &&
    isFiniteNumber(distribution.layer3)
  );
}

export function validateEvalProfile(data: unknown): data is EvalProfile {
  if (typeof data !== 'object' || data === null) return false;
  const profile = data as Record<string, unknown>;

  if (!REQUIRED_TEXT_FIELDS.every((key) => typeof profile[key] === 'string' && profile[key].trim().length > 0)) {
    return false;
  }

  if (profile.session_mode !== 'locked' && profile.session_mode !== 'split' && profile.session_mode !== 'open') {
    return false;
  }

  if (!hasDimensionScores(profile.dimensions)) return false;
  if (!hasDimensionScores(profile.raw_dimensions)) return false;
  if (!hasDimensionScores(profile.baseline_dimensions)) return false;

  if (typeof profile.stability !== 'object' || profile.stability === null) return false;
  const stability = profile.stability as Record<string, unknown>;
  if (
    !isFiniteNumber(stability.runs_completed) ||
    !isFiniteNumber(stability.pick_agreement_rate) ||
    !Array.isArray(stability.unstable_rounds) ||
    !stability.unstable_rounds.every(isFiniteNumber) ||
    !hasDimensionScores(stability.per_axis_variance)
  ) {
    return false;
  }

  if (typeof profile.reliability !== 'object' || profile.reliability === null) return false;
  const reliability = profile.reliability as Record<string, unknown>;
  if (
    !isFiniteNumber(reliability.rounds_attempted) ||
    !isFiniteNumber(reliability.rounds_succeeded) ||
    !isFiniteNumber(reliability.rounds_failed) ||
    !isFiniteNumber(reliability.total_retries) ||
    !hasParseLayerDistribution(reliability.parse_layer_distribution)
  ) {
    return false;
  }

  if (typeof profile.metadata !== 'object' || profile.metadata === null) return false;
  const metadata = profile.metadata as Record<string, unknown>;
  if (
    typeof metadata.topic !== 'string' ||
    typeof metadata.model !== 'string' ||
    !isFiniteNumber(metadata.temperature) ||
    !isFiniteNumber(metadata.runs) ||
    !isFiniteNumber(metadata.rounds) ||
    typeof metadata.timestamp !== 'string'
  ) {
    return false;
  }

  return true;
}
