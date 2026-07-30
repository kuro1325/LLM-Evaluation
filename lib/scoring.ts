import type {
  JudgeItem,
  ModelMetadata,
  ModelRun,
  ScoreBreakdown,
  Weights,
} from "./types";

const clamp = (value: number, min = 0, max = 100) =>
  Math.min(max, Math.max(min, value));

export function efficiencyScore(run: ModelRun): number {
  if (run.status !== "success") return 0;
  const seconds = run.durationMs / 1000;
  if (seconds <= 10) return 100;
  if (seconds >= 60) return 0;
  return clamp((100 * (60 - seconds)) / 50);
}

export function maxCandidateCost(
  models: ModelMetadata[],
  maxInputTokens = 2000,
  maxOutputTokens = 2000,
): number {
  const costs = models
    .filter((model) => model.available)
    .map(
      (model) =>
        model.promptPrice * maxInputTokens +
        model.completionPrice * maxOutputTokens,
    );
  return Math.max(...costs, 0.000001);
}

export function costScore(run: ModelRun, capUsd: number): number {
  if (run.status !== "success") return 0;
  return clamp(100 * (1 - run.costUsd / Math.max(capUsd, 0.000001)));
}

export function calculateScore(
  run: ModelRun,
  judge: JudgeItem | undefined,
  weights: Weights,
  capUsd: number,
): ScoreBreakdown {
  if (run.status !== "success" || !judge) {
    return {
      qualityRaw: 0,
      efficiencyRaw: 0,
      costRaw: 0,
      qualityWeighted: 0,
      efficiencyWeighted: 0,
      costWeighted: 0,
      total: 0,
    };
  }

  const qualityRaw = (judge.qualityLevel / 4) * 100;
  const efficiencyRaw = efficiencyScore(run);
  const costRaw = costScore(run, capUsd);
  const qualityWeighted = qualityRaw * (weights.quality / 100);
  const efficiencyWeighted = efficiencyRaw * (weights.efficiency / 100);
  const costWeighted = costRaw * (weights.cost / 100);

  return {
    qualityRaw,
    efficiencyRaw,
    costRaw,
    qualityWeighted,
    efficiencyWeighted,
    costWeighted,
    total: qualityWeighted + efficiencyWeighted + costWeighted,
  };
}

