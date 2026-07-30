import { MODEL_CATALOG, fallbackMetadata } from "./models";
import type { JudgeResult, ModelMetadata, ModelRun } from "./types";

const BASE_URL = "https://openrouter.ai/api/v1";

type RawModel = {
  id: string;
  name: string;
  pricing?: { prompt?: string; completion?: string };
  supported_parameters?: string[];
};

type CompletionResponse = {
  model?: string;
  choices?: Array<{ message?: { content?: string } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cost?: number;
  };
  error?: { code?: string | number; message?: string };
};

function describeApiError(status: number, message?: string) {
  const detail = message?.trim();
  const prefix: Record<number, string> = {
    400: "请求参数不被模型支持",
    401: "API Key 无效或已过期",
    402: "OpenRouter 余额不足",
    403: "当前 Key 没有调用权限",
    404: "模型不存在或已下架",
    408: "OpenRouter 请求超时",
    429: "请求过于频繁，触发限流",
    502: "上游模型服务暂时异常",
    503: "模型服务当前不可用",
  };
  const summary = prefix[status] ?? `OpenRouter 请求失败（HTTP ${status}）`;
  return detail && !summary.includes(detail) ? `${summary}：${detail}` : summary;
}

async function readCompletionResponse(response: Response): Promise<CompletionResponse> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as CompletionResponse;
  } catch {
    throw new Error(
      response.ok
        ? "OpenRouter 返回了无法识别的响应格式"
        : describeApiError(response.status, text.slice(0, 160)),
    );
  }
}

const headers = (apiKey: string) => ({
  Authorization: `Bearer ${apiKey}`,
  "Content-Type": "application/json",
  "X-OpenRouter-Title": "ModelScope",
});

export async function validateApiKey(apiKey: string): Promise<void> {
  const response = await fetch(`${BASE_URL}/key`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) {
    throw new Error(response.status === 401 ? "API Key 无效或已过期" : "暂时无法验证 API Key");
  }
}

export async function fetchModelMetadata(
  apiKey?: string,
): Promise<ModelMetadata[]> {
  try {
    const response = await fetch(`${BASE_URL}/models`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
    });
    if (!response.ok) throw new Error("model catalog unavailable");
    const payload = (await response.json()) as { data?: RawModel[] };
    const remote = new Map((payload.data ?? []).map((model) => [model.id, model]));
    return MODEL_CATALOG.map((definition) => {
      const model = remote.get(definition.id);
      return {
        id: definition.id,
        name: definition.name,
        promptPrice: Number(model?.pricing?.prompt ?? definition.fallbackPromptPrice),
        completionPrice: Number(
          model?.pricing?.completion ?? definition.fallbackCompletionPrice,
        ),
        supportedParameters: model?.supported_parameters ?? ["max_tokens"],
        available: Boolean(model),
      };
    });
  } catch {
    return fallbackMetadata();
  }
}

export async function callCandidate({
  apiKey,
  anonymousId,
  model,
  prompt,
  supportedParameters,
}: {
  apiKey: string;
  anonymousId: "A" | "B";
  model: ModelMetadata;
  prompt: string;
  supportedParameters: string[];
}): Promise<ModelRun> {
  const startedAt = performance.now();
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 60_000);

  try {
    const body: Record<string, unknown> = {
      model: model.id,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 2000,
      stream: false,
    };
    if (supportedParameters.includes("temperature")) body.temperature = 1;

    const response = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: headers(apiKey),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = await readCompletionResponse(response);
    if (!response.ok || payload.error) {
      throw new Error(describeApiError(response.status, payload.error?.message));
    }
    const content = payload.choices?.[0]?.message?.content?.trim() ?? "";
    if (!content) throw new Error("模型没有返回有效内容");
    const promptTokens = payload.usage?.prompt_tokens ?? 0;
    const completionTokens = payload.usage?.completion_tokens ?? 0;
    const calculatedCost =
      promptTokens * model.promptPrice + completionTokens * model.completionPrice;

    return {
      anonymousId,
      modelId: model.id,
      modelName: model.name,
      status: "success",
      content,
      durationMs: performance.now() - startedAt,
      promptTokens,
      completionTokens,
      totalTokens: payload.usage?.total_tokens ?? promptTokens + completionTokens,
      costUsd: Number(payload.usage?.cost ?? calculatedCost),
    };
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "AbortError";
    return {
      anonymousId,
      modelId: model.id,
      modelName: model.name,
      status: timedOut ? "timeout" : "failed",
      content: "",
      durationMs: performance.now() - startedAt,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      errorCode: timedOut ? "TIMEOUT" : "REQUEST_FAILED",
      errorMessage: timedOut
        ? "模型在 60 秒内未完成"
        : error instanceof Error
          ? error.message
          : "模型调用失败",
    };
  } finally {
    window.clearTimeout(timeout);
  }
}

function parseJudgeResult(content: string): JudgeResult {
  const normalized = content
    .replace(/^```json\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  const data = JSON.parse(normalized) as JudgeResult;
  if (!Array.isArray(data.items) || typeof data.comparisonSummary !== "string") {
    throw new Error("裁判返回结构不完整");
  }
  for (const item of data.items) {
    if (
      !["A", "B"].includes(item.answerId) ||
      !Number.isInteger(item.qualityLevel) ||
      item.qualityLevel < 0 ||
      item.qualityLevel > 4 ||
      !Array.isArray(item.deductions) ||
      !Array.isArray(item.evidence)
    ) {
      throw new Error("裁判返回字段不合法");
    }
  }
  return data;
}

export async function callJudge({
  apiKey,
  model,
  prompt,
  schema,
}: {
  apiKey: string;
  model: ModelMetadata;
  prompt: string;
  schema: object;
}): Promise<JudgeResult> {
  const body: Record<string, unknown> = {
    model: model.id,
    messages: [{ role: "user", content: prompt }],
    max_tokens: 2000,
    stream: false,
  };
  if (model.supportedParameters.includes("response_format")) {
    body.response_format = {
      type: "json_schema",
      json_schema: {
        name: "model_evaluation",
        strict: true,
        schema,
      },
    };
  }
  if (model.supportedParameters.includes("temperature")) body.temperature = 0;

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: headers(apiKey),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = await readCompletionResponse(response);
    if (!response.ok || payload.error) {
      throw new Error(describeApiError(response.status, payload.error?.message));
    }
    return parseJudgeResult(payload.choices?.[0]?.message?.content ?? "");
  } finally {
    window.clearTimeout(timeout);
  }
}
