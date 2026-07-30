import type { ModelDefinition, ModelMetadata } from "./types";

export const DEFAULT_JUDGE_MODEL = "deepseek/deepseek-v4-flash";

export const MODEL_CATALOG: ModelDefinition[] = [
  {
    id: "deepseek/deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    fallbackPromptPrice: 0.00000014,
    fallbackCompletionPrice: 0.00000028,
  },
  {
    id: "deepseek/deepseek-v4-pro",
    name: "DeepSeek V4 Pro",
    fallbackPromptPrice: 0.000000435,
    fallbackCompletionPrice: 0.00000087,
  },
  {
    id: "openai/gpt-5.6-sol",
    name: "GPT-5.6 Sol",
    fallbackPromptPrice: 0.000005,
    fallbackCompletionPrice: 0.00003,
  },
  {
    id: "openai/gpt-5.6-terra",
    name: "GPT-5.6 Terra",
    fallbackPromptPrice: 0.00000125,
    fallbackCompletionPrice: 0.0000075,
  },
  {
    id: "z-ai/glm-5.2",
    name: "GLM-5.2",
    fallbackPromptPrice: 0.0000006993,
    fallbackCompletionPrice: 0.0000021978,
  },
  {
    id: "qwen/qwen3.7-max",
    name: "Qwen3.7 Max",
    fallbackPromptPrice: 0.000001475,
    fallbackCompletionPrice: 0.000004425,
  },
  {
    id: "moonshotai/kimi-k3",
    name: "Kimi K3",
    fallbackPromptPrice: 0.000003,
    fallbackCompletionPrice: 0.000015,
  },
  {
    id: "x-ai/grok-4.5",
    name: "Grok 4.5",
    fallbackPromptPrice: 0.000002,
    fallbackCompletionPrice: 0.000006,
  },
  {
    id: "anthropic/claude-sonnet-5",
    name: "Claude Sonnet 5",
    fallbackPromptPrice: 0.000002,
    fallbackCompletionPrice: 0.00001,
  },
  {
    id: "anthropic/claude-opus-4.8",
    name: "Claude Opus 4.8",
    fallbackPromptPrice: 0.000005,
    fallbackCompletionPrice: 0.000025,
  },
];

export function fallbackMetadata(): ModelMetadata[] {
  return MODEL_CATALOG.map((model) => ({
    id: model.id,
    name: model.name,
    promptPrice: model.fallbackPromptPrice,
    completionPrice: model.fallbackCompletionPrice,
    supportedParameters: ["max_tokens"],
    available: true,
  }));
}

