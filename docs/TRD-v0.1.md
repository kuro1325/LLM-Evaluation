# 大模型评测平台 TRD v0.1

## 1. 文档信息

- 对应产品文档：PRD v0.2
- 当前形态：本地网页应用
- 目标：先完成真实可用的单轮双模型评测；后续可封装为桌面端
- 技术状态：方案初稿，可进入开发

## 2. 技术目标

1. 使用用户自己的 OpenRouter API Key，同时并行调用两个参评模型。
2. 统一参评模型的输入、最大输出 Token 和超时限制。
3. 使用独立裁判模型，对匿名回答 A/B 进行结构化质量判断。
4. 由代码计算效率、成本、权重分和最终业务适配分。
5. API Key 仅保存在当前浏览器会话，不进入日志或持久化数据库。
6. 保留网页与桌面端共用的核心业务模块，避免未来重写。

## 3. 技术架构

### 3.1 当前方案

- 页面层：React + TypeScript
- 应用框架：Next/Vinext
- 样式：原生 CSS
- 模型服务：OpenRouter Chat Completions API
- Key 保存：浏览器 `sessionStorage`
- 评测状态：页面内存，仅保留当前一轮
- 反馈：第一阶段仅完成前端采集结构；持久化接口后续接入

### 3.2 调用方式

候选模型和裁判模型均由浏览器直接请求 OpenRouter：

- Key 不经过自建服务器。
- Key 只存在于当前浏览器会话和请求头中。
- 不在应用日志中打印请求头、原文或回答。
- 正式部署必须使用 HTTPS；本地开发允许 `localhost`。

未来若需要统一企业 Key、权限或反馈数据库，再增加受控后端。

## 4. 模块划分

### 4.1 页面模块

- `EvaluationWorkspace`：评测工作台和流程状态
- `ConfigPanel`：场景、任务、权重和演示模式
- `ModelCard`：模型选择、回答、状态和客观指标
- `ScoreReport`：分项分数、总分、点评和推荐
- `FeedbackDialog`：认可/不认可反馈
- `ApiKeyDialog`：Key 填写、验证和会话保存

### 4.2 业务模块

- `modelCatalog`：MVP 固定模型及裁判模型配置
- `openRouterClient`：Key 验证、模型元数据、模型调用
- `taskPrompt`：统一生成参评模型任务指令
- `judgePrompt`：裁判规则和结构化输出要求
- `scoreEngine`：质量、效率、成本和总分计算
- `evaluationRunner`：并行调用、超时、匿名裁判和状态编排
- `feedbackService`：反馈数据组装及未来上报接口

## 5. OpenRouter 接口

### 5.1 Key 验证

- 请求：`GET https://openrouter.ai/api/v1/key`
- 成功：显示 Key 已验证，并可展示剩余额度（如接口返回）
- 失败：不保存 Key，提示无效、过期或网络错误

### 5.2 模型元数据

- 请求：`GET https://openrouter.ai/api/v1/models`
- 使用字段：
  - `id`
  - `name`
  - `pricing.prompt`
  - `pricing.completion`
  - `supported_parameters`
  - `top_provider.max_completion_tokens`
- 固定候选列表只显示 PRD 中的十个模型。
- 若固定模型不存在或下架，界面禁用该模型并说明原因。

### 5.3 模型调用

- 请求：`POST https://openrouter.ai/api/v1/chat/completions`
- 方法：非流式请求
- 公共参数：
  - `model`
  - `messages`
  - `max_tokens: 2000`
- `temperature` 只在模型元数据明确支持时发送。
- 参评模型 A/B 使用完全相同的任务 Prompt 和运行限制。
- 使用 `AbortController` 在 60 秒时终止请求。

### 5.4 用量

OpenRouter 当前会在响应中自动返回 `usage`，不再需要额外传递 `usage.include`。

记录字段：

- `prompt_tokens`
- `completion_tokens`
- `total_tokens`
- `cost`
- `cost_details`（存在时）

若响应未返回成本，则根据本轮模型价格快照和 Token 重新计算。

## 6. 模型配置

| 展示名称 | OpenRouter ID |
| --- | --- |
| DeepSeek V4 Flash | `deepseek/deepseek-v4-flash` |
| DeepSeek V4 Pro | `deepseek/deepseek-v4-pro` |
| GPT-5.6 Sol | `openai/gpt-5.6-sol` |
| GPT-5.6 Terra | `openai/gpt-5.6-terra` |
| GLM-5.2 | `z-ai/glm-5.2` |
| Qwen3.7 Max | `qwen/qwen3.7-max` |
| Kimi K3 | `moonshotai/kimi-k3` |
| Grok 4.5 | `x-ai/grok-4.5` |
| Claude Sonnet 5 | `anthropic/claude-sonnet-5` |
| Claude Opus 4.8 | `anthropic/claude-opus-4.8` |

默认裁判：`deepseek/deepseek-v4-flash`

模型 ID、价格和参数支持情况以每次打开页面时获取的 OpenRouter 元数据为准。

## 7. 评测数据结构

### 7.1 单模型运行结果

```ts
type ModelRun = {
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
```

### 7.2 裁判结果

```ts
type JudgeItem = {
  answerId: "A" | "B";
  qualityLevel: 0 | 1 | 2 | 3 | 4;
  comment: string;
  deductions: string[];
  evidence: string[];
  confidence: "low" | "medium" | "high";
  needsHumanReview: boolean;
};

type JudgeResult = {
  items: JudgeItem[];
  comparisonSummary: string;
};
```

裁判只接收匿名 A/B，不接收模型名称、价格和速度。

### 7.3 最终报告

```ts
type ScoreBreakdown = {
  qualityRaw: number;
  efficiencyRaw: number;
  costRaw: number;
  qualityWeighted: number;
  efficiencyWeighted: number;
  costWeighted: number;
  total: number;
};
```

## 8. Prompt 分工

### 8.1 参评模型 Prompt

输入：

- 场景
- 任务类型
- 用户任务要求
- 用户原文

要求：

- 两个模型收到完全相同的文本。
- 不加入模型专属优化。
- 不透露另一个参评模型。
- 输出上限一致。

### 8.2 裁判 Prompt

输入：

- 场景与任务
- 用户原文
- 用户要求
- 匿名回答 A/B
- 对应任务质量检查规则

职责：

- 判断准确性、完整性、指令遵循和可用性。
- 输出 0—4 质量档位、理由、扣分项和原文证据。
- 不计算耗时、成本、权重或最终总分。

优先使用 JSON Schema；若裁判模型不支持结构化输出，则回退到 JSON 文本并进行严格校验。解析失败时不生成总分。

## 9. 代码计分

### 9.1 质量

`质量原始分 = 质量档位 / 4 × 100`

### 9.2 效率

- `耗时 <= 10 秒`：100 分
- `10 < 耗时 < 60 秒`：`100 × (60 - 耗时) / 50`
- `耗时 >= 60 秒`：0 分

### 9.3 成本

成本上限每次根据“MVP 候选模型中，在最大输入 Token 与最大输出 2000 Token 下理论费用最高者”动态计算。

`成本原始分 = max(0, 100 × (1 - 实际费用 / 成本上限))`

以 2026-07-30 OpenRouter 价格快照估算，当前候选模型的理论最高单轮费用约为 0.07 美元；实际运行时不写死该数值。

### 9.4 总分

`总分 = 质量原始分 × 质量权重 + 效率原始分 × 效率权重 + 成本原始分 × 成本权重`

权重以 0—1 小数参与计算，页面四舍五入展示整数分；内部保留小数。

## 10. 异常处理

- Key 无效：禁止开始评测。
- 单模型失败：该模型本轮总分 0；另一模型继续裁判，标记“对比不完整”。
- 两模型均失败：不调用裁判，不输出推荐。
- 超时：60 秒终止，对应模型记 0 分。
- 裁判失败：保留模型回答及客观指标，不生成总分。
- 裁判 JSON 无效：校验失败，不猜测或补造字段。
- 模型不支持 Temperature：不发送该参数。
- 模型下架：禁用选项，不自动替换成其他模型。
- 两边选择同一模型：禁止开始评测。

## 11. Key 与数据安全

- Key 使用 `sessionStorage`，键名固定且不写入其他存储。
- 页面刷新仍可使用；关闭标签页后由浏览器清除。
- 页面不回显完整 Key，只显示掩码。
- 任何错误信息均不得包含 Authorization 请求头。
- 默认不保存原文、回答和历史评测。
- 反馈持久化前必须再次确认是否保存原文和回答；当前仅设计元数据反馈结构。

## 12. 反馈结构

```ts
type EvaluationFeedback = {
  evaluationId: string;
  verdict: "accepted" | "rejected";
  target?: "quality" | "efficiency" | "cost" | "recommendation" | "comment";
  reason?: string;
  note?: string;
  modelA: string;
  modelB: string;
  weights: {
    quality: number;
    efficiency: number;
    cost: number;
  };
  scoreA?: number;
  scoreB?: number;
  rubricVersion: string;
  createdAt: string;
};
```

第一阶段只在当前页面显示“已提交”；接入后台后再持久化。

## 13. 桌面端兼容

模型调用、Prompt、评分和类型定义不得依赖页面组件。未来可使用 Tauri 或 Electron 包装当前网页，并复用全部核心模块。

## 14. 测试范围

- 计分公式边界：10 秒、60 秒、0 成本、成本上限。
- 权重总和与切换。
- 两模型成功、单边失败、双边失败。
- Key 无效、网络错误、超时。
- 裁判合法 JSON、字段缺失、非法档位。
- 同模型拦截、输入超限。
- Key 不进入本地持久化和错误日志。

## 15. 技术验收

1. 使用真实 Key 可完成两个模型并行调用。
2. 回答和用量来自 OpenRouter 真实响应。
3. 裁判只接收匿名回答并返回可校验结构。
4. 最终分数由代码按公式生成。
5. 权重切换无需重新调用模型和裁判。
6. 所有核心异常均能明确展示。
7. 关闭页面后 Key 不再保留。
