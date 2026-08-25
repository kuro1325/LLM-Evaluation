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
  教学质量优先: [70, 20, 10],
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

type TestCase = {
  id: string;
  name: string;
  scene: Scene;
  task: TaskType;
  source: string;
  requirement: string;
  benchmark: string;
};

const taskOptions: Record<Scene, TaskType[]> = {
  办公: ["总结", "提取", "分类", "生成", "公文编校"],
  法律: ["总结", "提取", "分类", "生成"],
  英语教育: ["知识问答", "作业批改", "分级讲解", "作文辅导"],
};

const educationQualityRubric = [
  "知识正确性 40%",
  "小学生适配性 25%",
  "教学有效性 20%",
  "指令遵循 10%",
  "安全与鼓励性 5%",
] as const;

const testCases: TestCase[] = [
  {
    id: "notice-proofread",
    name: "样本 01 · 通知编校",
    scene: "办公",
    task: "公文编校",
    source:
      "关于开展 2026年第三季度业务检查的通知\n\n各部门：\n为进一步提升办文的质量，现定于2026年8月18日开展第三季度业务检查。请各部门在8月16号前提交自查材料及问题清单。检查结果将作为年度考核的重要参考，请各部门高度重视，按时完成。",
    requirement:
      "请按“原文片段—修改建议—原因”输出。只处理错别字、病句和格式问题，不得改变时间、部门、检查要求等事实；不确定的内容标记“需人工复核”。",
    benchmark:
      "标题中“开展”后存在多余空格；“办文的质量”可精简；“8月16号前”需规范为“8月16日前”；不得改动2026年8月18日检查、8月16日提交、自查材料、年度考核等事实；不得自行补充政策依据或新的工作要求。",
  },
  {
    id: "meeting-proofread",
    name: "样本 02 · 会议纪要校对",
    scene: "办公",
    task: "公文编校",
    source:
      "会议明确：信息中心于9月5日前完成门户改版的上线准备；各业务处室请于9月1日前反馈测试问题。因接口改造尚未结束，正式上线时间暂不确定。",
    requirement:
      "请检查文字、标点和表述规范，输出修改建议。不得把“暂不确定”改写为确定日期；涉及上线日期的结论均标记需人工复核。",
    benchmark:
      "保留9月5日、9月1日、接口改造未完成和正式上线时间暂不确定四项事实；不得臆测上线日期；上线日期类结论应提示人工复核。",
  },
  {
    id: "report-proofread",
    name: "样本 03 · 简报校阅",
    scene: "办公",
    task: "公文编校",
    source:
      "本月共受理群众诉求 128 件，已办结120件，办结率为93.8%。其中，涉及物业管理类问题最多，共计42件。",
    requirement:
      "检查格式、数字表达和语病；不重算、不改写统计结果。若发现数字关系异常，只提示人工核验。",
    benchmark:
      "128件、120件、93.8%、42件均为原始事实；不得重算或擅自更正；若认为数字存在疑点，只能提示人工核验。",
  },
  {
    id: "office-summary",
    name: "样本 04 · 项目会议总结",
    scene: "办公",
    task: "总结",
    source: "项目组确认门户改版将在9月10日进入灰度。产品负责人负责验收清单，研发团队修复高优问题。当前风险是接口联调尚未完成，若9月5日前不能闭环，灰度计划将顺延。",
    requirement: "请总结会议结论，保留时间、负责人、风险和行动项。",
    benchmark: "应保留9月10日灰度、接口联调风险、9月5日闭环阈值；不得补充未出现的负责人姓名或上线结论。",
  },
  {
    id: "office-extract",
    name: "样本 05 · 会议字段提取",
    scene: "办公",
    task: "提取",
    source: "请于8月16日前提交自查材料。信息中心负责汇总，行政处负责会务保障。本次检查时间为8月18日。",
    requirement: "提取检查时间、提交截止时间、责任部门和交付物；未提及的字段写“未提及”。",
    benchmark: "应准确提取8月18日、8月16日前、信息中心、行政处、自查材料；不得臆测负责人。",
  },
  {
    id: "office-classify",
    name: "样本 06 · 智能工单分类",
    scene: "办公",
    task: "分类",
    source: "员工无法登录门户，提示账号已锁定，需要尽快恢复访问。",
    requirement: "仅在“账号权限、系统故障、流程咨询”中选择一个标签，并说明判断依据。",
    benchmark: "标签应为账号权限；依据是账号锁定与无法登录；不得输出多个标签。",
  },
  {
    id: "office-generate",
    name: "样本 07 · 通知草稿生成",
    scene: "办公",
    task: "生成",
    source: "背景：9月12日下午2点召开安全培训会，地点为A座301，参会人为各部门安全员，需提前10分钟签到。",
    requirement: "生成一则简洁会议通知，保留全部事实，不自行补充联系人、会议主题或参会范围。",
    benchmark: "应包含日期时间、地点、参会人、提前10分钟签到；不得新增联系人或主题。",
  },
  {
    id: "legal-summary",
    name: "样本 08 · 合同条款总结",
    scene: "法律",
    task: "总结",
    source: "乙方应于交付后30日内完成验收问题整改。因甲方原因导致延期的，交付期限相应顺延。任何一方违反保密义务，应赔偿守约方因此遭受的实际损失。",
    requirement: "总结整改、延期和保密责任，不提供法律意见或新增法律结论。",
    benchmark: "应准确概括30日整改、甲方原因顺延、实际损失赔偿；不得断言具体违约金额。",
  },
  {
    id: "legal-extract",
    name: "样本 09 · 合同字段提取",
    scene: "法律",
    task: "提取",
    source: "服务期限自2026年1月1日至2026年12月31日。合同总价为人民币20万元，付款方式为验收合格后30日内支付。",
    requirement: "提取服务期限、合同金额、付款条件和付款期限；不得解释条款含义。",
    benchmark: "应提取起止日期、20万元、验收合格后、30日内；不得加入税率或付款批次。",
  },
  {
    id: "legal-classify",
    name: "样本 10 · 条款风险分类",
    scene: "法律",
    task: "分类",
    source: "若乙方未按期交付，甲方有权单方解除合同且不承担任何责任。",
    requirement: "仅在“交付风险、付款风险、保密风险”中选择一个标签，并说明原文依据；不输出法律结论。",
    benchmark: "标签应为交付风险；依据是未按期交付和单方解除；不评价条款是否有效。",
  },
  {
    id: "legal-generate",
    name: "样本 11 · 风险提示生成",
    scene: "法律",
    task: "生成",
    source: "条款：项目验收标准由甲方在验收时另行确定。",
    requirement: "生成一条中性风险提示，仅指出验收标准未事先明确，建议人工复核；不下法律结论。",
    benchmark: "应提到验收标准未明确与人工复核；不得断言条款无效或直接给出法律意见。",
  },
  {
    id: "english-qa",
    name: "样本 12 · 语法知识问答",
    scene: "英语教育",
    task: "知识问答",
    source: "老师，为什么 He likes apples 里面的 like 要加 s 呀？",
    requirement: "用小学生能听懂的中文讲清原因，给2个简单例句，不引入超出小学阶段的语法术语。",
    benchmark: "应说明一般现在时中，主语是he/she/it等第三人称单数时，动词通常加-s。需给2个适合小学生的正确例句。",
  },
  {
    id: "english-homework",
    name: "样本 13 · 句子作业批改",
    scene: "英语教育",
    task: "作业批改",
    source: "老师，帮我看看这句话对不对：Yesterday I go to school.",
    requirement: "找出错误，给出修改后的完整句子，并用小学生能听懂的简短中文说明原因。",
    benchmark: "Yesterday表示过去，go应改为went。完整句子应为Yesterday I went to school.不应引入与该句无关的复杂时态。",
  },
  {
    id: "english-level-explain",
    name: "样本 14 · 分级知识讲解",
    scene: "英语教育",
    task: "分级讲解",
    source: "老师，a 和 an 到底怎么用？我总是分不清。",
    requirement: "用不超过120字的中文讲解，配2个简单英文例子和1道练习题，不使用复杂语法术语。",
    benchmark: "应使用适合小学生的方式说明：a通常用在辅音音素开头的单词前，an通常用在元音音素开头的单词前。例子和练习须正确，不应仅以首字母判断。",
  },
  {
    id: "english-writing-coach",
    name: "样本 15 · 英语作文辅导",
    scene: "英语教育",
    task: "作文辅导",
    source: "老师，请帮我看看这段作文怎么改：My favorite hobby is play basketball. I play it every weekend. It make me happy and I can make many friend.",
    requirement: "先肯定一个优点，再指出最关键的3处问题，给出对应修改建议；保留原意，不直接代写全文。",
    benchmark: "应肯定主题明确或有生活细节；is play应改为is playing；It make应改为It makes；many friend应改为many friends。不应用一篇新作文替换学生原文。",
  },
];

const defaultCase = testCases[0];

const answers = {
  a: "1. 原文片段：关于开展 2026年第三季度业务检查的通知\n修改建议：关于开展2026年第三季度业务检查的通知\n原因：标题中存在多余空格。\n\n2. 原文片段：进一步提升办文的质量\n修改建议：进一步提升办文质量\n原因：表达冗余，可精简。\n\n3. 原文片段：在8月16号前提交\n修改建议：于8月16日前提交\n原因：公文表述规范化。\n\n未修改2026年8月18日检查、提交材料及年度考核等事实信息。",
  b: "建议将通知改为：各部门须在8月15日前完成自查并上报材料，检查工作可提前启动。\n\n另建议补充“本次检查结果将作为绩效考评的唯一依据”，以提高执行力度。",
};

const demoResults: Record<string, { a: string; b: string; note: string; evidence: string }> = {
  "notice-proofread": {
    ...answers,
    note: "回答 A 只处理格式和表述问题，且保留了检查日期、提交日期和考核要求；回答 B 擅自将提交期限改为8月15日，并新增“唯一依据”等原文没有的要求，存在事实篡改风险。",
    evidence: "“2026年8月18日开展第三季度业务检查”“在8月16号前提交自查材料”",
  },
  "meeting-proofread": {
    a: "1. 原文片段：信息中心于9月5日前完成门户改版的上线准备\n修改建议：信息中心于9月5日前完成门户改版上线准备\n原因：删除结构助词，使表述更凝练。\n\n2. 原文片段：正式上线时间暂不确定\n修改建议：不修改，标记“需人工复核”。\n原因：该表述涉及上线时间结论，不能补充或推定具体日期。",
    b: "建议将正式上线时间确定为9月5日，并要求各处室在9月1日完成全部验收工作，以保证按期交付。",
    note: "回答 A 保留了“正式上线时间暂不确定”并提示人工复核；回答 B 擅自确定上线日期，越过了原文与业务边界。",
    evidence: "“正式上线时间暂不确定”“各业务处室请于9月1日前反馈测试问题”",
  },
  "report-proofread": {
    a: "1. 原文片段：群众诉求 128 件\n修改建议：群众诉求128件\n原因：数字与量词之间无需空格。\n\n2. 原文片段：办结率为93.8%\n修改建议：不修改，标记“需人工核验”。\n原因：统计口径与计算过程未提供，不重算、不擅自更正。",
    b: "128件中办结120件，办结率应调整为94%，建议同步更正简报并增加物业问题整改要求。",
    note: "回答 A 不重算统计结果，仅提示人工核验；回答 B 擅自更正办结率并新增整改要求，不能直接用于正式简报。",
    evidence: "“本月共受理群众诉求 128 件，已办结120件，办结率为93.8%”",
  },
  "english-qa": {
    a: "因为句子里的 he 表示“他”，只有一个人。当我们说他经常做什么时，动词通常要加 -s，所以 like 变成 likes。\n例如：She reads books. Tom plays football.",
    b: "因为 apples 是复数，所以 like 需要加 s。例如：I likes apples. They plays games.",
    note: "回答 A 正确将动词加-s与第三人称单数主语he联系起来，表达适合小学生；回答 B 错误归因于复数宾语apples，且例句错误。",
    evidence: "人工检查点：一般现在时中，he/she/it等第三人称单数作主语时，动词通常加-s。",
  },
  "english-homework": {
    a: "这句话有一处需要修改：Yesterday I went to school.\n\nYesterday是“昨天”，说的是过去的事，所以go要变成过去式went。",
    b: "建议改为：Yesterday I have gone to school.\n\n使用have gone可以让句子表达得更高级。",
    note: "回答 A 准确修正了go的过去式，并用小学生能理解的Yesterday解释原因；回答 B 误用现在完成时，且引入了不必要的复杂概念。",
    evidence: "Yesterday表示过去，go的过去式应为went。",
  },
  "english-level-explain": {
    a: "看后面单词开头的发音：如果开头听起来是 a、e、i、o、u 这类元音，通常用 an；其他情况通常用 a。\n例如：an apple，a book。\n练习：___ orange。",
    b: "只要单词的第一个字母是a、e、i、o、u，就一定用an，其他一律用a。",
    note: "回答 A 用简单语言交代了核心是“开头的发音”，并提供例子与练习；回答 B 错误地只看首字母，容易在hour等单词上出错。",
    evidence: "a/an的选择取决于后续单词开头的音素，不是只看首字母。",
  },
  "english-writing-coach": {
    a: "优点：你写清了爱好和每周的练习习惯。\n\n建议修改：\n1. is play → is playing，be动词后要用playing。\n2. It make → It makes，It后的动词要加-s。\n3. many friend → many friends，many后面用名词复数。",
    b: "My favorite hobby is playing basketball because it is an exciting and meaningful sport. I practice with my best friends every weekend and dream of becoming a professional player one day.",
    note: "回答 A 保留了学生原意，按要求肯定优点并定位3处关键问题；回答 B 直接代写，而且新增了原文没有的理想。",
    evidence: "人工检查点要求保留原意并修改is play、It make、many friend三处错误。",
  },
};

const fallbackDemoByTask: Record<TaskType, { a: string; b: string; note: string; evidence: string }> = {
  总结: {
    a: "关键信息已按时间、行动项与风险整理，未补充原文之外的结论。",
    b: "已完成内容概括，并建议团队尽快推进后续工作。",
    note: "回答 A 保留了原文关键事实；回答 B 结论泛化，且补充了原文没有的建议，完整性和事实边界较弱。",
    evidence: "人工检查点要求保留时间、行动项与风险，不得新增结论。",
  },
  提取: {
    a: "检查时间：已按原文提取\n责任部门：已按原文提取\n交付物：已按原文提取\n未提及字段：未提及",
    b: "已提取关键字段，并根据常见业务流程补充了负责人和优先级。",
    note: "回答 A 遵守“只提取原文信息”的规则；回答 B 擅自补充字段内容，存在结构化数据污染风险。",
    evidence: "人工检查点要求未提及字段明确写“未提及”，不得猜测。",
  },
  分类: {
    a: "标签：账号权限\n依据：原文明确提及账号锁定和无法登录。",
    b: "标签：账号权限、系统故障\n建议：请联系技术支持尽快处理。",
    note: "回答 A 选择单一标签且引用原文依据；回答 B 输出多个标签并增加处置建议，不符合限定标签规则。",
    evidence: "人工检查点要求仅选择一个标签，并说明原文依据。",
  },
  生成: {
    a: "已按原文事实生成结构清晰的通知/提示，未补充联系人或额外条件。",
    b: "已生成通知，并补充了常见的联系人、会议主题和办理要求。",
    note: "回答 A 遵守事实与格式约束；回答 B 擅自补全业务信息，无法直接用于正式场景。",
    evidence: "人工检查点明确禁止新增原文没有的联系人、主题或业务条件。",
  },
  公文编校: demoResults["notice-proofread"],
  知识问答: demoResults["english-qa"],
  作业批改: demoResults["english-homework"],
  分级讲解: demoResults["english-level-explain"],
  作文辅导: demoResults["english-writing-coach"],
};

export default function Home() {
  const [modelA, setModelA] = useState("DeepSeek V4 Pro");
  const [modelB, setModelB] = useState("Kimi K3");
  const [scene, setScene] = useState<Scene>("办公");
  const [task, setTask] = useState<TaskType>("公文编校");
  const [preset, setPreset] = useState<PresetName>("质量优先");
  const [weights, setWeights] = useState<number[]>([40, 30, 30]);
  const [demoMode, setDemoMode] = useState("测试评测");
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
  const [selectedCase, setSelectedCase] = useState(defaultCase.id);
  const [source, setSource] = useState(defaultCase.source);
  const [requirement, setRequirement] = useState(defaultCase.requirement);
  const [benchmark, setBenchmark] = useState(defaultCase.benchmark);
  const [status, setStatus] = useState<Status>("idle");
  const [showKey, setShowKey] = useState(false);
  const [feedback, setFeedback] = useState<"认可" | "不认可" | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [regressionCases, setRegressionCases] = useState<string[]>([]);
  const matchingCases = testCases.filter((item) => item.scene === scene && item.task === task);
  const demoCopy = demoResults[selectedCase] ?? fallbackDemoByTask[task];
  const presetNames = scene === "英语教育"
    ? (["均衡", "教学质量优先", "效率优先", "成本优先"] as const)
    : (["均衡", "质量优先", "效率优先", "成本优先"] as const);
  const scoreLabels = scene === "英语教育"
    ? ["教学质量", "响应效率", "调用成本"]
    : ["质量", "效率", "成本"];

  useEffect(() => {
    const stored = window.sessionStorage.getItem("modelscope_openrouter_key") ?? "";
    if (stored) setKeyStatus("valid");
    fetchModelMetadata(stored || undefined).then(setMetadata);
    const savedRegression = window.localStorage.getItem("llm_evaluation_regression_cases");
    if (savedRegression) setRegressionCases(JSON.parse(savedRegression));
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
        a: { quality: 92, efficiency: 76, cost: 78 },
        b: { quality: 38, efficiency: 84, cost: 92 },
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
      b: realMode && liveB?.status !== "success" ? 0 : score(raw.b),
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

  const applyTestCase = (id: string) => {
    if (id === "custom") {
      setSelectedCase("custom");
      setBenchmark("");
      return;
    }
    const next = testCases.find((item) => item.id === id);
    if (!next) return;
    setSelectedCase(id);
    setSource(next.source);
    setRequirement(next.requirement);
    setBenchmark(next.benchmark);
    setStatus("idle");
    setStageA("idle");
    setStageB("idle");
    setLiveResult(null);
    setPartialRuns({});
  };

  const changeScene = (nextScene: Scene) => {
    const nextTask = taskOptions[nextScene].includes(task) ? task : taskOptions[nextScene][0];
    const nextCase = testCases.find((item) => item.scene === nextScene && item.task === nextTask);
    setScene(nextScene);
    setTask(nextTask);
    selectPreset(nextScene === "英语教育" ? "教学质量优先" : "质量优先");
    if (nextCase) applyTestCase(nextCase.id);
  };

  const changeTask = (nextTask: TaskType) => {
    const nextCase = testCases.find((item) => item.scene === scene && item.task === nextTask);
    setTask(nextTask);
    if (nextCase) applyTestCase(nextCase.id);
  };

  const addToRegression = () => {
    if (selectedCase === "custom" || regressionCases.includes(selectedCase)) return;
    const next = [...regressionCases, selectedCase];
    setRegressionCases(next);
    window.localStorage.setItem("llm_evaluation_regression_cases", JSON.stringify(next));
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
      window.setTimeout(() => setStageB("waiting"), 1500);
      window.setTimeout(() => {
        setStatus("judging");
        setStageA("judging");
        setStageB("judging");
      }, 1700);
      window.setTimeout(() => {
        setStatus("done");
        setStageA("success");
        setStageB("success");
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
        benchmark,
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
            <strong>LLM Evaluation</strong>
            <span>业务选模工作台</span>
          </div>
        </div>
        <div className="top-actions">
          <span className="prototype-tag">双模型 · 业务适配评测</span>
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
            <div className="segmented three">
              {(["办公", "法律", "英语教育"] as Scene[]).map((item) => (
                <button
                  key={item}
                  className={scene === item ? "selected" : ""}
                  onClick={() => changeScene(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          </section>

          <section className="setting-group">
            <label htmlFor="task">任务类型</label>
            <select id="task" value={task} onChange={(e) => changeTask(e.target.value as TaskType)}>
              {taskOptions[scene].map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
            {scene === "英语教育" && (
              <div className="fixed-scope education-rubric">
                <strong>教育质量评分依据</strong>
                <span>{educationQualityRubric.join(" · ")}</span>
              </div>
            )}
          </section>

          <section className="setting-group">
            <label htmlFor="test-case">测试样本</label>
            <select id="test-case" value={selectedCase} onChange={(e) => applyTestCase(e.target.value)}>
              {matchingCases.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
              <option value="custom">自定义文本</option>
            </select>
            <small className="field-help">内置样本包含人工检查点；自定义文本可用于临时验证。</small>
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
              <option>测试评测</option>
              <option>真实评测</option>
            </select>
            <small>测试评测使用预置演示数据；真实评测会消耗 OpenRouter 额度</small>
          </section>

          <section className="setting-group">
            <div className="field-label">
              <label>评分偏好</label>
              <span>{preset === "自定义" ? "自定义 · " : ""}总计 100%</span>
            </div>
            <div className="preset-grid">
              {presetNames.map((name) => (
                <button
                  key={name}
                  className={preset === name ? "selected" : ""}
                  onClick={() => selectPreset(name as keyof typeof presetWeights)}
                >
                  {name}
                </button>
              ))}
            </div>
            {scoreLabels.map((name, index) => (
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
                当前回归集：{regressionCases.length} 条
                <small>人工反馈可加入回归集，供下一轮 Prompt / 模型复测</small>
              </p>
          </div>
        </aside>

        <section className="content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">{scene}场景 · {task}任务</p>
              <h1>比较模型在真实业务任务中的表现</h1>
              <p>同一输入、同一规则、同一人工检查点，比较质量、效率、成本与风险。</p>
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
              <label htmlFor="source">测试原文</label>
              <span className={source.length > 1000 ? "over-limit" : ""}>
                {source.length} / 1000
              </span>
            </div>
            <textarea
              id="source"
              value={source}
              maxLength={1000}
              onChange={(e) => {
                setSource(e.target.value);
                setSelectedCase("custom");
                setBenchmark("");
              }}
              placeholder="粘贴需要评测的文本内容…"
            />
            <div className="requirement-row">
              <div>
                <label htmlFor="requirement">任务要求</label>
                <input
                  id="requirement"
                  value={requirement}
                  onChange={(e) => {
                    setRequirement(e.target.value);
                    setSelectedCase("custom");
                    setBenchmark("");
                  }}
                  placeholder="明确模型需要完成什么、禁止补充什么"
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
              <h2>匿名模型对比</h2>
              <span>模型只看到同一原文与规则；裁判额外核验人工检查点</span>
            </div>
          </div>

          <div className="answer-grid">
            <AnswerCard
              model={modelA}
              options={modelOptions}
              onModelChange={setModelA}
              tone="violet"
              stage={stageA}
              answer={realMode ? liveA?.content ?? "" : demoCopy.a}
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
              answer={realMode ? liveB?.content ?? "" : demoCopy.b}
              time={realMode ? formatDuration(liveB?.durationMs) : "27.1 秒"}
              tokens={realMode ? String(liveB?.totalTokens ?? 0) : "294"}
              cost={realMode ? formatCost(liveB?.costUsd) : "$0.0089"}
              failed={realMode && done && liveB?.status !== "success"}
              errorCode={realMode ? liveB?.errorCode : undefined}
              errorMessage={realMode ? liveB?.errorMessage : undefined}
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
                    {liveResult?.incomplete
                      ? "本轮存在模型调用失败，结果标记为对比不完整。"
                      : `当前采用“${preset}”权重；推荐结果同时参考任务规则、人工检查点与风险边界。`}
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
                    name={scoreLabels[0]}
                    weight={weights[0]}
                    a={raw.a.quality}
                    b={realMode && liveB?.status !== "success" ? 0 : raw.b.quality}
                  />
                  <ScoreRow
                    name={scoreLabels[1]}
                    weight={weights[1]}
                    a={raw.a.efficiency}
                    b={realMode && liveB?.status !== "success" ? 0 : raw.b.efficiency}
                  />
                  <ScoreRow
                    name={scoreLabels[2]}
                    weight={weights[2]}
                    a={raw.a.cost}
                    b={realMode && liveB?.status !== "success" ? 0 : raw.b.cost}
                  />
                </div>
                <div className="judge-note">
                  <div className="judge-title">
                    <span className="judge-icon">AI</span>
                    <div>
                      <strong>裁判点评</strong>
                      <small>基于原文、任务规则与人工检查点进行双盲评估</small>
                    </div>
                    <span className="confidence">高置信度</span>
                  </div>
                  <p>
                    {realMode
                      ? liveResult?.judge?.comparisonSummary
                      : demoCopy.note}
                  </p>
                  <div className="evidence">
                    <span>扣分证据</span>
                    {realMode
                      ? liveResult?.judge?.items
                          .flatMap((item) => item.evidence)
                          .slice(0, 2)
                          .join("；") || "裁判未返回直接证据"
                      : demoCopy.evidence}
                  </div>
                </div>
              </div>

              <div className="guardrail-grid">
                <div>
                  <span>可迭代输入</span>
                  <p>每次评测都保留任务规则、人工检查点、裁判证据和人工反馈；这些不是展示数据，而是下一轮优化的依据。</p>
                </div>
                <div>
                  <span>回归资产</span>
                  <p>将 Bad Case 加入回归集；后续修改 Prompt、切换模型或调整权重后，可用同一批样本复测是否退化。</p>
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
                  <button
                    className="outline-button"
                    disabled={selectedCase === "custom" || regressionCases.includes(selectedCase)}
                    onClick={addToRegression}
                  >
                    {regressionCases.includes(selectedCase) ? "已加入回归集" : "加入回归集"}
                  </button>
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
