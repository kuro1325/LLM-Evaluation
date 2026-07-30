import { DEFAULT_JUDGE_MODEL } from "./models";
import { callCandidate, callJudge } from "./openrouter";
import { buildJudgePrompt, buildTaskPrompt, JUDGE_SCHEMA } from "./prompts";
import { calculateScore, maxCandidateCost } from "./scoring";
import type {
  EvaluationResult,
  ModelMetadata,
  ModelRun,
  Scene,
  TaskType,
  Weights,
} from "./types";

export async function runLiveEvaluation({
  apiKey,
  scene,
  task,
  requirement,
  source,
  modelA,
  modelB,
  metadata,
  weights,
  onPhase,
  onRunComplete,
}: {
  apiKey: string;
  scene: Scene;
  task: TaskType;
  requirement: string;
  source: string;
  modelA: string;
  modelB: string;
  metadata: ModelMetadata[];
  weights: Weights;
  onPhase?: (phase: "running" | "judging") => void;
  onRunComplete?: (run: ModelRun) => void;
}): Promise<EvaluationResult> {
  const a = metadata.find((model) => model.id === modelA);
  const b = metadata.find((model) => model.id === modelB);
  const judgeModel = metadata.find((model) => model.id === DEFAULT_JUDGE_MODEL);
  if (!a || !b || !judgeModel) throw new Error("模型配置不存在");
  if (a.id === b.id) throw new Error("请选择两个不同的模型");
  if (!a.available || !b.available) throw new Error("所选模型当前不可用");

  onPhase?.("running");
  const prompt = buildTaskPrompt(scene, task, requirement, source);
  const runs = await Promise.all([
    callCandidate({
      apiKey,
      anonymousId: "A",
      model: a,
      prompt,
      supportedParameters: a.supportedParameters,
    }).then((run) => {
      onRunComplete?.(run);
      return run;
    }),
    callCandidate({
      apiKey,
      anonymousId: "B",
      model: b,
      prompt,
      supportedParameters: b.supportedParameters,
    }).then((run) => {
      onRunComplete?.(run);
      return run;
    }),
  ]);

  const successful = runs.filter((run) => run.status === "success");
  if (successful.length === 0) {
    const details = runs
      .map(
        (run) =>
          `模型 ${run.anonymousId}：${run.errorMessage ?? "未知调用错误"}`,
      )
      .join("；");
    return {
      id: crypto.randomUUID(),
      runs,
      judge: null,
      scores: {},
      incomplete: true,
      judgeError: `两个模型均调用失败。${details}`,
    };
  }

  onPhase?.("judging");
  let judge = null;
  let judgeError: string | undefined;
  try {
    judge = await callJudge({
      apiKey,
      model: judgeModel,
      prompt: buildJudgePrompt(scene, task, requirement, source, successful),
      schema: JUDGE_SCHEMA,
    });
  } catch (error) {
    judgeError = error instanceof Error ? error.message : "裁判评估失败";
  }

  const cap = maxCandidateCost(metadata);
  const scores: EvaluationResult["scores"] = {};
  if (judge) {
    for (const run of runs) {
      scores[run.anonymousId] = calculateScore(
        run,
        judge.items.find((item) => item.answerId === run.anonymousId),
        weights,
        cap,
      );
    }
  }

  return {
    id: crypto.randomUUID(),
    runs,
    judge,
    scores,
    incomplete: successful.length < 2,
    judgeError,
  };
}
