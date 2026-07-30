"use client";

import { useEffect, useMemo, useState } from "react";
import { runLiveEvaluation } from "../lib/evaluation";
import { MODEL_CATALOG, fallbackMetadata } from "../lib/models";
import { fetchModelMetadata, validateApiKey } from "../lib/openrouter";
import type {
  EvaluationResult,
  ModelMetadata,
  ModelRun,
  Scene,
  TaskType,
} from "../lib/types";

const modelOptions = [
  "DeepSeek V4 Pro",
  "DeepSeek V4 Flash",
  "Kimi K3",
  "GPT-5.6 Sol",
  "GPT-5.6 Terra",
  "GLM-5.2",
  "Qwen3.7 Max",
  "Grok 4.5",
  "Claude Sonnet 5",
  "Claude Opus 4.8",
];

const presetWeights = {
  均衡: [34, 33, 33],
  质量优先: [40, 30, 30],
  效率优先: [30, 40, 30],
  成本优先: [30, 30, 40],
} as const;

type Status = "idle" | "running" | "judging" | "done";
type PresetName = keyof typeof presetWeights | "自定义";
type CardStage =
  | "idle"
  | "generating"
  | "waiting"
  | "judging"
  | "success"
  | "failed";

const sampleSource =
  "7月25日，项目组召开智能客服版本评审会。会议确认V2.3版本将于8月10日灰度发布，首批覆盖华南区域20%的用户。产品负责人林悦需在8月2日前完成验收清单，研发负责人周航负责修复高优先级问题。当前主要风险是知识库中仍有约12%的历史答案未完成复核，若8月5日前未降至5%以内，灰度计划将顺延。";

const answers = {
  a: "项目组计划于8月10日灰度发布智能客服V2.3，首批覆盖华南区域20%的用户。林悦需在8月2日前完成验收清单，周航负责修复高优先级问题。当前风险为知识库约12%的历史答案尚未复核；若8月5日前未降至5%以内，灰度发布将顺延。",
  b: "智能客服V2.3计划8月10日灰度上线，覆盖华南20%用户。会前需完成验收清单和问题修复。知识库历史答案复核进度可能影响上线时间，团队应在8月5日前完成相关工作。",
};

export default function Home() {
  const [modelA, setModelA] = useState("DeepSeek V4 Pro");
  const [modelB, setModelB] = useState("Kimi K3");
  const [scene, setScene] = useState("办公");
  const [task, setTask] = useState("总结");
  const [preset, setPreset] = useState<PresetName>("质量优先");
  const [weights, setWeights] = useState<number[]>([40, 30, 30]);
  const [demoMode, setDemoMode] = useState("正常评测");
  const [metadata, setMetadata] = useState<ModelMetadata[]>(fallbackMetadata());
  const [liveResult, setLiveResult] = useState<EvaluationResult | null>(null);
  const [partialRuns, setPartialRuns] = useState<
    Partial<Record<"A" | "B", ModelRun>>
  >({});
  const [stageA, setStageA] = useState<CardStage>("idle");
  const [stageB, setStageB] = useState<CardStage>("idle");
  const [runError, setRunError] = useState("");
  const [keyInput, setKeyInput] = useState("");
  const [keyStatus, setKeyStatus] = useState<"empty" | "checking" | "valid" | "invalid">(
    "empty",
  );
  const [source, setSource] = useState(sampleSource);
  const [requirement, setRequirement] = useState(
    "请总结会议结论，保留时间、负责人、关键数据和风险。",
  );
  const [status, setStatus] = useState<Status>("idle");
  const [showKey, setShowKey] = useState(false);
  const [feedback, setFeedback] = useState<"认可" | "不认可" | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  useEffect(() => {
    const stored = window.sessionStorage.getItem("modelscope_openrouter_key") ?? "";
    if (stored) setKeyStatus("valid");
    fetchModelMetadata(stored || undefined).then(setMetadata);
  }, []);

  const liveA =
    liveResult?.runs.find((run) => run.anonymousId === "A") ?? partialRuns.A;
  const liveB =
    liveResult?.runs.find((run) => run.anonymousId === "B") ?? partialRuns.B;
  const realMode = demoMode === "真实评测";
  const raw = realMode && liveResult?.scores.A && liveResult?.scores.B
    ? {
        a: {
          quality: liveResult.scores.A.qualityRaw,
          efficiency: liveResult.scores.A.efficiencyRaw,
          cost: liveResult.scores.A.costRaw,
        },
        b: {
          quality: liveResult.scores.B.qualityRaw,
          efficiency: liveResult.scores.B.efficiencyRaw,
          cost: liveResult.scores.B.costRaw,
        },
      }
    : {
        a: { quality: 75, efficiency: 82, cost: 92 },
        b: { quality: 50, efficiency: 68, cost: 84 },
      };

  const totals = useMemo(() => {
    const score = (item: typeof raw.a) =>
      Math.round(
        item.quality * (weights[0] / 100) +
          item.efficiency * (weights[1] / 100) +
          item.cost * (weights[2] / 100),
      );
    return {
      a: score(raw.a),
      b:
        demoMode === "模型 B 调用失败" ||
        (realMode && liveB?.status !== "success")
          ? 0
          : score(raw.b),
    };
  }, [weights, demoMode, raw.a.quality, raw.a.efficiency, raw.a.cost, raw.b.quality, raw.b.efficiency, raw.b.cost, realMode, liveB?.status]);

  const selectPreset = (name: keyof typeof presetWeights) => {
    setPreset(name);
    setWeights([...presetWeights[name]]);
  };

  const changeWeight = (index: number, value: number) => {
    const next = [...weights];
    const difference = value - next[index];
    const others = [0, 1, 2].filter((i) => i !== index);
    next[index] = value;
    next[others[0]] = Math.max(0, next[others[0]] - Math.ceil(difference / 2));
    next[others[1]] = 100 - next[index] - next[others[0]];
    if (next[others[1]] < 0) {
      next[others[0]] += next[others[1]];
      next[others[1]] = 0;
    }
    setWeights(next);
    setPreset("自定义");
  };

  const runEvaluation = async () => {
    if (!source.trim() || !requirement.trim()) {
      return;
    }
    setFeedback(null);
    setRunError("");
    setLiveResult(null);
    setPartialRuns({});
    setStageA("generating");
    setStageB("generating");

    if (!realMode) {
      setStatus("running");
      window.setTimeout(() => setStageA("waiting"), 800);
      window.setTimeout(() => {
        if (demoMode === "模型 B 调用失败") setStageB("failed");
        else setStageB("waiting");
      }, 1500);
      window.setTimeout(() => {
        setStatus("judging");
        setStageA("judging");
        if (demoMode !== "模型 B 调用失败") setStageB("judging");
      }, 1700);
      window.setTimeout(() => {
        setStatus("done");
        setStageA("success");
        if (demoMode !== "模型 B 调用失败") setStageB("success");
      }, 2700);
      return;
    }

    const apiKey = window.sessionStorage.getItem("modelscope_openrouter_key") ?? "";
    if (!apiKey) {
      setStageA("idle");
      setStageB("idle");
      setShowKey(true);
      return;
    }
    const definitionA = MODEL_CATALOG.find((model) => model.name === modelA);
    const definitionB = MODEL_CATALOG.find((model) => model.name === modelB);
    if (!definitionA || !definitionB) return;

    try {
      const result = await runLiveEvaluation({
        apiKey,
        scene: scene as Scene,
        task: task as TaskType,
        requirement,
        source,
        modelA: definitionA.id,
        modelB: definitionB.id,
        metadata,
        weights: {
          quality: weights[0],
          efficiency: weights[1],
          cost: weights[2],
        },
        onPhase: (phase) => {
          setStatus(phase);
          if (phase === "judging") {
            setStageA((current) => (current === "waiting" ? "judging" : current));
            setStageB((current) => (current === "waiting" ? "judging" : current));
          }
        },
        onRunComplete: (run) => {
          setPartialRuns((current) => ({ ...current, [run.anonymousId]: run }));
          const nextStage: CardStage =
            run.status === "success" ? "waiting" : "failed";
          if (run.anonymousId === "A") setStageA(nextStage);
          else setStageB(nextStage);
        },
      });
      setLiveResult(result);
      setStatus("done");
      setStageA((current) =>
        current === "waiting" || current === "judging" ? "success" : current,
      );
      setStageB((current) =>
        current === "waiting" || current === "judging" ? "success" : current,
      );
      if (result.judgeError) setRunError(result.judgeError);
    } catch (error) {
      setStatus("idle");
      setStageA("idle");
      setStageB("idle");
      setRunError(error instanceof Error ? error.message : "评测启动失败");
    }
  };

  const done = status === "done";

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">M</span>
          <div>
            <strong>ModelScope</strong>
            <span>大模型评测工作台</span>
          </div>
        </div>
        <div className="top-actions">
          <span className="prototype-tag">双模型 · 实时评测</span>
          <button className="key-button" onClick={() => setShowKey(true)}>
            <span className={keyStatus === "valid" ? "status-dot active" : "status-dot prototype"} />
            {keyStatus === "valid" ? "API Key 已验证" : "配置 API Key"}
          </button>
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <div className="side-title">
            <span>评测配置</span>
            <button className="text-button" onClick={() => selectPreset("均衡")}>
              重置
            </button>
          </div>

          <section className="setting-group">
            <label>业务场景</label>
            <div className="segmented two">
              {["办公", "法律"].map((item) => (
                <button
                  key={item}
                  className={scene === item ? "selected" : ""}
                  onClick={() => setScene(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          </section>

          <section className="setting-group">
            <label htmlFor="task">任务类型</label>
            <select id="task" value={task} onChange={(e) => setTask(e.target.value)}>
              <option>总结</option>
              <option>提取</option>
              <option>分类</option>
              <option>生成</option>
            </select>
          </section>

          <section className="setting-group prototype-only">
            <label htmlFor="demo-mode">运行模式</label>
            <select
              id="demo-mode"
              value={demoMode}
              onChange={(e) => {
                setDemoMode(e.target.value);
                setStatus("idle");
                setStageA("idle");
                setStageB("idle");
              }}
            >
              <option>正常评测</option>
              <option>真实评测</option>
              <option>模型 B 调用失败</option>
            </select>
            <small>真实评测会消耗 OpenRouter 额度</small>
          </section>

          <section className="setting-group">
            <div className="field-label">
              <label>评分偏好</label>
              <span>{preset === "自定义" ? "自定义 · " : ""}总计 100%</span>
            </div>
            <div className="preset-grid">
              {Object.keys(presetWeights).map((name) => (
                <button
                  key={name}
                  className={preset === name ? "selected" : ""}
                  onClick={() => selectPreset(name as keyof typeof presetWeights)}
                >
                  {name}
                </button>
              ))}
            </div>
            {["质量", "效率", "成本"].map((name, index) => (
              <div className="weight-row" key={name}>
                <div>
                  <span>{name}</span>
                  <strong>{weights[index]}%</strong>
                </div>
                <input
                  aria-label={`${name}权重`}
                  type="range"
                  min="10"
                  max="80"
                  value={weights[index]}
                  onChange={(e) => changeWeight(index, Number(e.target.value))}
                />
              </div>
            ))}
          </section>

          <div className="privacy-note">
            <span>✓</span>
            <p>
              Key 仅保留在当前会话
              <small>关闭页面后自动清除</small>
            </p>
          </div>
        </aside>

        <section className="content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">新建评测</p>
              <h1>比较模型在真实任务中的表现</h1>
              <p>相同输入、相同限制，更直观地衡量质量、效率与成本。</p>
            </div>
            <div className="run-state">
              <span className={`state-dot ${status}`} />
              {status === "idle" && "等待开始"}
              {status === "running" && "模型生成中"}
              {status === "judging" && "裁判评估中"}
              {status === "done" && "评测已完成"}
            </div>
          </div>

          <div className="input-card">
            <div className="input-head">
              <label htmlFor="source">原始内容</label>
              <span className={source.length > 1000 ? "over-limit" : ""}>
                {source.length} / 1000
              </span>
            </div>
            <textarea
              id="source"
              value={source}
              maxLength={1000}
              onChange={(e) => setSource(e.target.value)}
              placeholder="粘贴需要评测的文本内容…"
            />
            <div className="requirement-row">
              <div>
                <label htmlFor="requirement">任务要求</label>
                <input
                  id="requirement"
                  value={requirement}
                  onChange={(e) => setRequirement(e.target.value)}
                  placeholder="告诉模型需要完成什么"
                />
              </div>
              <button
                className="primary-button"
                disabled={status === "running" || status === "judging"}
                onClick={runEvaluation}
              >
                {status === "running" || status === "judging" ? (
                  <>
                    <span className="spinner" /> 正在评测
                  </>
                ) : (
                  <>开始评测 <span>→</span></>
                )}
              </button>
            </div>
          </div>

          <div className="comparison-head">
            <div>
              <h2>模型回答</h2>
              <span>裁判将以匿名方式评估回答 A / B</span>
            </div>
          </div>

          <div className="answer-grid">
            <AnswerCard
              model={modelA}
              options={modelOptions}
              onModelChange={setModelA}
              tone="violet"
              stage={stageA}
              answer={realMode ? liveA?.content ?? "" : answers.a}
              time={realMode ? formatDuration(liveA?.durationMs) : "18.4 秒"}
              tokens={realMode ? String(liveA?.totalTokens ?? 0) : "386"}
              cost={realMode ? formatCost(liveA?.costUsd) : "$0.0042"}
              failed={realMode && done && liveA?.status !== "success"}
              errorCode={realMode ? liveA?.errorCode : undefined}
              errorMessage={realMode ? liveA?.errorMessage : undefined}
              failureHint={
                realMode && done && liveB?.status !== "success"
                  ? "两个模型均未成功，本轮不会调用裁判"
                  : "另一模型将继续完成质量评估"
              }
            />
            <AnswerCard
              model={modelB}
              options={modelOptions}
              onModelChange={setModelB}
              tone="teal"
              stage={stageB}
              answer={realMode ? liveB?.content ?? "" : answers.b}
              time={realMode ? formatDuration(liveB?.durationMs) : "27.1 秒"}
              tokens={realMode ? String(liveB?.totalTokens ?? 0) : "294"}
              cost={realMode ? formatCost(liveB?.costUsd) : "$0.0089"}
              failed={
                demoMode === "模型 B 调用失败" ||
                (realMode && done && liveB?.status !== "success")
              }
              errorCode={realMode ? liveB?.errorCode : undefined}
              errorMessage={
                realMode
                  ? liveB?.errorMessage
                  : demoMode === "模型 B 调用失败"
                    ? "原型模拟：上游模型服务不可用"
                    : undefined
              }
              failureHint={
                realMode && done && liveA?.status !== "success"
                  ? "两个模型均未成功，本轮不会调用裁判"
                  : "另一模型将继续完成质量评估"
              }
            />
          </div>

          {runError && <div className="run-error">{runError}。已保留成功返回的回答和客观数据。</div>}

          {done && (!realMode || liveResult?.judge) && (
            <section className="report-card">
              <div className="report-header">
                <div>
                  <span className="report-kicker">业务适配报告</span>
                  <h2>
                    本轮推荐 <strong>{totals.a >= totals.b ? modelA : modelB}</strong>
                  </h2>
                  <p>
                    {demoMode === "模型 B 调用失败" || liveResult?.incomplete
                      ? "模型 B 本轮调用失败，结果标记为对比不完整。"
                      : `当前采用“${preset}”权重，推荐结果严格按照总分计算。`}
                  </p>
                </div>
                <div className="score-compare">
                  <ScorePill label={modelA} score={totals.a} active={totals.a >= totals.b} />
                  <span>vs</span>
                  <ScorePill label={modelB} score={totals.b} active={totals.b > totals.a} />
                </div>
              </div>

              <div className="report-body">
                <div className="score-table">
                  <ScoreRow
                    name="质量"
                    weight={weights[0]}
                    a={raw.a.quality}
                    b={demoMode === "模型 B 调用失败" ? 0 : raw.b.quality}
                  />
                  <ScoreRow
                    name="效率"
                    weight={weights[1]}
                    a={raw.a.efficiency}
                    b={demoMode === "模型 B 调用失败" ? 0 : raw.b.efficiency}
                  />
                  <ScoreRow
                    name="成本"
                    weight={weights[2]}
                    a={raw.a.cost}
                    b={demoMode === "模型 B 调用失败" ? 0 : raw.b.cost}
                  />
                </div>
                <div className="judge-note">
                  <div className="judge-title">
                    <span className="judge-icon">AI</span>
                    <div>
                      <strong>裁判点评</strong>
                      <small>基于原文证据进行双盲评估</small>
                    </div>
                    <span className="confidence">高置信度</span>
                  </div>
                  <p>
                    {demoMode === "模型 B 调用失败"
                      ? "仅一个回答调用成功。裁判完成了独立质量评估，但本轮结果不能代表两个模型的稳定能力差异。"
                      : realMode
                        ? liveResult?.judge?.comparisonSummary
                        : "回答 A 完整保留了发布日期、覆盖范围、责任人及风险阈值，信息准确；回答 B 遗漏了两位责任人姓名，并将“降至 5% 以内”概括为“完成相关工作”。"}
                  </p>
                  <div className="evidence">
                    <span>扣分证据</span>
                    {realMode
                      ? liveResult?.judge?.items
                          .flatMap((item) => item.evidence)
                          .slice(0, 2)
                          .join("；") || "裁判未返回直接证据"
                      : "“林悦需在8月2日前完成验收清单”“周航负责修复高优先级问题”"}
                  </div>
                </div>
              </div>

              <div className="review-bar">
                <div>
                  <span className={feedback ? "review-check reviewed" : "review-check"}>
                    {feedback === "认可" ? "✓" : feedback === "不认可" ? "!" : "?"}
                  </span>
                  <p>
                    <strong>
                      {feedback ? `已提交“${feedback}”反馈` : "这个评分符合你的判断吗？"}
                    </strong>
                    <small>
                      {feedback
                        ? "反馈将用于定位裁判偏差和后续规则迭代"
                        : "你的选择不会改变本轮 AI 原始评分"}
                    </small>
                  </p>
                </div>
                <div className="review-actions">
                  <button className="reject-button" onClick={() => setFeedbackOpen(true)}>
                    不认可
                  </button>
                  <button className="confirm-button" onClick={() => setFeedback("认可")}>
                    认可评分
                  </button>
                </div>
              </div>
            </section>
          )}
        </section>
      </div>

      {showKey && (
        <div className="modal-backdrop" onMouseDown={() => setShowKey(false)}>
          <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-icon">⌁</div>
            <h2>配置 OpenRouter API Key</h2>
            <p>Key 将被验证并仅保存在当前浏览器会话，关闭标签页后清除。</p>
            <label htmlFor="api-key">API Key</label>
            <input
              id="api-key"
              type="password"
              value={keyInput}
              onChange={(e) => {
                setKeyInput(e.target.value);
                setKeyStatus("empty");
              }}
              placeholder="sk-or-v1-••••••••"
            />
            <div className={keyStatus === "invalid" ? "modal-note invalid" : "modal-note"}>
              {keyStatus === "invalid"
                ? "Key 验证失败，请检查后重试。"
                : "不会写入数据库、日志或长期本地存储。"}
            </div>
            <div className="modal-actions">
              <button className="outline-button" onClick={() => setShowKey(false)}>
                取消
              </button>
              <button
                className="confirm-button"
                disabled={keyStatus === "checking" || !keyInput.trim()}
                onClick={async () => {
                  setKeyStatus("checking");
                  try {
                    await validateApiKey(keyInput.trim());
                    window.sessionStorage.setItem(
                      "modelscope_openrouter_key",
                      keyInput.trim(),
                    );
                    setKeyStatus("valid");
                    setShowKey(false);
                    fetchModelMetadata(keyInput.trim()).then(setMetadata);
                  } catch {
                    setKeyStatus("invalid");
                  }
                }}
              >
                {keyStatus === "checking" ? "验证中…" : "验证并保存"}
              </button>
            </div>
          </div>
        </div>
      )}

      {feedbackOpen && (
        <div className="modal-backdrop" onMouseDown={() => setFeedbackOpen(false)}>
          <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-icon warning">!</div>
            <h2>为什么不认可本次评分？</h2>
            <p>这条反馈将用于对比人工判断，帮助后续定位裁判规则的问题。</p>
            <div className="feedback-grid">
              <label>
                <span>问题对象</span>
                <select defaultValue="质量评分">
                  <option>质量评分</option>
                  <option>效率评分</option>
                  <option>成本评分</option>
                  <option>最终推荐</option>
                  <option>裁判点评</option>
                </select>
              </label>
              <label>
                <span>主要原因</span>
                <select defaultValue="评分过高或过低">
                  <option>评分过高或过低</option>
                  <option>遗漏关键问题</option>
                  <option>引用证据不准确</option>
                  <option>推荐与权重不一致</option>
                  <option>其他</option>
                </select>
              </label>
            </div>
            <label htmlFor="feedback-note">补充说明（选填）</label>
            <textarea id="feedback-note" placeholder="说说你认为不合理的地方…" />
            <div className="modal-actions">
              <button className="outline-button" onClick={() => setFeedbackOpen(false)}>
                取消
              </button>
              <button
                className="confirm-button"
                onClick={() => {
                  setFeedback("不认可");
                  setFeedbackOpen(false);
                }}
              >
                提交反馈
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function AnswerCard({
  model,
  options,
  onModelChange,
  tone,
  stage,
  answer,
  time,
  tokens,
  cost,
  failed = false,
  errorCode,
  errorMessage,
  failureHint = "另一模型将继续完成质量评估",
}: {
  model: string;
  options: string[];
  onModelChange: (model: string) => void;
  tone: "violet" | "teal";
  stage: CardStage;
  answer: string;
  time: string;
  tokens: string;
  cost: string;
  failed?: boolean;
  errorCode?: string;
  errorMessage?: string;
  failureHint?: string;
}) {
  const hasResult = ["waiting", "judging", "success"].includes(stage);
  const failedState = stage === "failed" || failed;
  const statusText: Record<CardStage, string> = {
    idle: "待运行",
    generating: "生成中…",
    waiting: "已生成 · 等待另一模型",
    judging: "已生成 · 裁判评估中",
    success: "生成成功",
    failed: errorCode === "TIMEOUT" ? "请求超时" : "调用失败",
  };
  return (
    <article className={`answer-card ${tone}`}>
      <div className="answer-title">
        <div>
          <span className={`model-badge ${tone}`}>{tone === "violet" ? "A" : "B"}</span>
          <select
            className="card-model-select"
            value={model}
            aria-label={`${tone === "violet" ? "模型 A" : "模型 B"}选择`}
            onChange={(e) => onModelChange(e.target.value)}
          >
            {options.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </div>
        <span
          className={
            failedState
              ? "failure-tag"
              : stage === "waiting"
                ? "ready-tag"
                : stage === "judging"
                  ? "judging-tag"
                  : stage === "success"
                    ? "success-tag"
                    : "waiting-tag"
          }
        >
          {failedState
            ? errorCode === "TIMEOUT"
              ? "请求超时"
              : "调用失败"
            : statusText[stage]}
        </span>
      </div>
      <div className="answer-content">
        {stage === "generating" ? (
          <div className="loading-lines">
            <div className="generating-copy">
              <span className="spinner dark" /> 模型正在生成回答，请稍候…
            </div>
            <i />
            <i />
            <i />
            <i />
          </div>
        ) : failedState ? (
          <div className="error-answer">
            <span>!</span>
            <p>{errorMessage ?? "模型调用失败，未返回具体原因"}</p>
            <small>{failureHint} · 本模型本轮记 0 分</small>
          </div>
        ) : hasResult ? (
          <>
            {stage !== "success" && (
              <div className={`state-banner ${stage}`}>
                <span>✓</span>
                {stage === "waiting"
                  ? `已生成成功，用时 ${time}，正在等待另一模型`
                  : "两个模型均已生成，裁判正在进行质量评估"}
              </div>
            )}
            <p>{answer}</p>
          </>
        ) : (
          <div className="empty-answer">
            <span>✦</span>
            <p>评测开始后，回答将在这里同步生成</p>
          </div>
        )}
      </div>
      <div className="metrics">
        <div>
          <span>完成耗时</span>
          <strong>{hasResult && !failedState ? time : "—"}</strong>
        </div>
        <div>
          <span>Token</span>
          <strong>{hasResult && !failedState ? tokens : "—"}</strong>
        </div>
        <div>
          <span>预估费用</span>
          <strong>{hasResult && !failedState ? cost : "—"}</strong>
        </div>
      </div>
    </article>
  );
}

function ScorePill({
  label,
  score,
  active,
}: {
  label: string;
  score: number;
  active: boolean;
}) {
  return (
    <div className={active ? "score-pill active" : "score-pill"}>
      <small>{label}</small>
      <strong>{score}</strong>
      <span>分</span>
    </div>
  );
}

function ScoreRow({
  name,
  weight,
  a,
  b,
}: {
  name: string;
  weight: number;
  a: number;
  b: number;
}) {
  return (
    <div className="score-row">
      <div className="score-label">
        <strong>{name}</strong>
        <span>权重 {weight}%</span>
      </div>
      <div className="score-track">
        <div>
          <span>A</span>
          <i style={{ width: `${a}%` }} />
          <strong>{a}</strong>
        </div>
        <div>
          <span>B</span>
          <i style={{ width: `${b}%` }} />
          <strong>{b}</strong>
        </div>
      </div>
    </div>
  );
}

function formatDuration(durationMs?: number) {
  if (durationMs === undefined) return "—";
  return `${(durationMs / 1000).toFixed(1)} 秒`;
}

function formatCost(costUsd?: number) {
  if (costUsd === undefined) return "—";
  return `$${costUsd.toFixed(6)}`;
}
