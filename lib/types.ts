export type Scene = "办公" | "法律";
export type TaskType = "总结" | "提取" | "分类" | "生成";

export type Weights = {
  quality: number;
  efficiency: number;
  cost: number;
};

export type ModelDefinition = {
  id: string;
  name: string;
  fallbackPromptPrice: number;
  fallbackCompletionPrice: number;
};

export type ModelMetadata = {
  id: string;
  name: string;
  promptPrice: number;
  completionPrice: number;
  supportedParameters: string[];
  available: boolean;
};

export type ModelRun = {
  anonymousId: "A" | "B";
  modelId: string;
  modelName: string;
  status: "success" | "failed" | "timeout";
  content: string;
  durationMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  errorCode?: string;
  errorMessage?: string;
};

export type JudgeItem = {
  answerId: "A" | "B";
  qualityLevel: 0 | 1 | 2 | 3 | 4;
  comment: string;
  deductions: string[];
  evidence: string[];
  confidence: "low" | "medium" | "high";
  needsHumanReview: boolean;
};

export type JudgeResult = {
  items: JudgeItem[];
  comparisonSummary: string;
};

export type ScoreBreakdown = {
  qualityRaw: number;
  efficiencyRaw: number;
  costRaw: number;
  qualityWeighted: number;
  efficiencyWeighted: number;
  costWeighted: number;
  total: number;
};

export type EvaluationResult = {
  id: string;
  runs: ModelRun[];
  judge: JudgeResult | null;
  scores: Partial<Record<"A" | "B", ScoreBreakdown>>;
  incomplete: boolean;
  judgeError?: string;
};

