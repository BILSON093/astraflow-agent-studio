import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type {
  MemoryKind,
  ModelPolicy,
  PlanStepStatus,
  ProviderConfig,
  RiskLevel,
  RuntimeLog,
  TaskStatus,
} from "./domain/types";

export type Language = "zh" | "en";

const dictionaries = {
  zh: {
    addMcp: "生成 MCP 配置",
    addProvider: "添加供应商",
    addSkill: "生成 Skill 配置",
    agentCanvas: "Agent 可视化画布",
    approvalRun: "审批并模拟执行",
    budgetHard: "硬预算",
    budgetSoft: "软预算",
    codingPlan: "代码任务计划",
    commandCount: "命令",
    contextDropped: "被裁剪内容",
    contextIncluded: "已进入模型上下文",
    contextInspector: "上下文检查器",
    contextNoReport: "暂无上下文报告",
    createPlan: "生成执行计划",
    dashboard: "工作台",
    desktopRuntime: "桌面版",
    enabled: "启用",
    events: "条事件",
    health: "健康状态",
    key: "密钥",
    languageSwitch: "English",
    localFirstPolicy: "本地优先策略",
    memorySearchPlaceholder: "搜索记忆来源或内容",
    memorySystem: "记忆系统",
    model: "模型",
    modelAccess: "模型接入",
    modelPolicy: "模型策略",
    noContextReport: "暂无上下文报告",
    noPlan: "还没有执行计划",
    noTask: "暂无任务",
    noTaskCanvas: "创建任务后展示 Agent 执行图",
    pageSubtitle:
      "跨平台本地优先 Agent，可视化任务规划、长期记忆、MCP/Skill 扩展、模型路由和 Token 成本治理。",
    permissions: "权限",
    planFirstExecution: "先规划后执行",
    planFirstRuntime: "先规划后执行 Runtime",
    policy: "路由策略",
    provider: "供应商",
    providerHub: "模型接入中心",
    providerRoutingEnabled: "模型路由已启用",
    queue: "任务队列",
    runtimeLog: "运行日志",
    security: "安全审批",
    securityTitle: "沙箱与审批",
    status: "状态",
    taskDescriptionPlaceholder: "描述你希望 Agent 完成的任务",
    taskEntry: "任务入口",
    taskPlan: "执行计划",
    taskPlanTitle: "执行计划 / 代码任务计划",
    test: "测试",
    todayCost: "今日成本",
    token: "Token",
    tokenMonitor: "Token 监控",
    transport: "传输方式",
    version: "版本",
    webRuntime: "网页预览",
    weekCost: "本周成本",
    weekToken: "本周 Token",
    workspacePlaceholder: "工作区路径，可选",
  },
  en: {
    addMcp: "Generate MCP Config",
    addProvider: "Add Provider",
    addSkill: "Generate Skill Config",
    agentCanvas: "Agent Canvas",
    approvalRun: "Approve & Run Simulation",
    budgetHard: "Hard Budget",
    budgetSoft: "Soft Budget",
    codingPlan: "Coding Plan",
    commandCount: "Commands",
    contextDropped: "Dropped Context",
    contextIncluded: "Included Context",
    contextInspector: "Context Inspector",
    contextNoReport: "No context report yet",
    createPlan: "Create Execution Plan",
    dashboard: "Dashboard",
    desktopRuntime: "Tauri Desktop",
    enabled: "Enabled",
    events: "events",
    health: "Health",
    key: "Key",
    languageSwitch: "中文",
    localFirstPolicy: "Local-first policy",
    memorySearchPlaceholder: "Search memory source or content",
    memorySystem: "Memory System",
    model: "Model",
    modelAccess: "Model Access",
    modelPolicy: "Model Policy",
    noContextReport: "No context report yet",
    noPlan: "No execution plan yet",
    noTask: "No task yet",
    noTaskCanvas: "Create a task to show the Agent graph",
    pageSubtitle:
      "A cross-platform, local-first Agent studio with visual planning, long-term memory, MCP/Skill extensions, model routing, and Token cost governance.",
    permissions: "Permissions",
    planFirstExecution: "Plan-first execution",
    planFirstRuntime: "Plan-first Runtime",
    policy: "Policy",
    provider: "Provider",
    providerHub: "Provider Hub",
    providerRoutingEnabled: "Provider routing enabled",
    queue: "Task Queue",
    runtimeLog: "Runtime Log",
    security: "Security Approval",
    securityTitle: "Sandbox & Approval",
    status: "Status",
    taskDescriptionPlaceholder: "Describe what you want the Agent to do",
    taskEntry: "Task Entry",
    taskPlan: "Task Plan",
    taskPlanTitle: "Task Plan / Coding Plan",
    test: "Test",
    todayCost: "Today Cost",
    token: "Token",
    tokenMonitor: "Token Monitor",
    transport: "Transport",
    version: "Version",
    webRuntime: "Vite Preview",
    weekCost: "Week Cost",
    weekToken: "Week Tokens",
    workspacePlaceholder: "Workspace path, optional",
  },
} as const;

export type TranslationKey = keyof typeof dictionaries.zh;

const taskStatusLabels: Record<Language, Record<TaskStatus, string>> = {
  zh: {
    planned: "已规划",
    running: "运行中",
    paused: "已暂停",
    blocked: "受阻",
    done: "已完成",
    failed: "失败",
  },
  en: {
    planned: "planned",
    running: "running",
    paused: "paused",
    blocked: "blocked",
    done: "done",
    failed: "failed",
  },
};

const planStepStatusLabels: Record<Language, Record<PlanStepStatus, string>> = {
  zh: {
    waiting: "等待中",
    running: "运行中",
    needs_approval: "待审批",
    done: "已完成",
    failed: "失败",
  },
  en: {
    waiting: "waiting",
    running: "running",
    needs_approval: "needs approval",
    done: "done",
    failed: "failed",
  },
};

const riskLabels: Record<Language, Record<RiskLevel, string>> = {
  zh: {
    low: "低风险",
    medium: "中风险",
    high: "高风险",
  },
  en: {
    low: "low",
    medium: "medium",
    high: "high",
  },
};

const modelPolicyLabels: Record<Language, Record<ModelPolicy, string>> = {
  zh: {
    low_cost: "低成本",
    balanced: "均衡路由",
    strong_reasoning: "强推理",
    long_context: "长上下文",
    code_first: "代码优先",
    privacy_first: "隐私优先",
  },
  en: {
    low_cost: "low cost",
    balanced: "balanced",
    strong_reasoning: "strong reasoning",
    long_context: "long context",
    code_first: "code first",
    privacy_first: "privacy first",
  },
};

const providerStatusLabels: Record<Language, Record<ProviderConfig["status"], string>> = {
  zh: {
    untested: "未测试",
    connected: "已连接",
    failed: "失败",
  },
  en: {
    untested: "untested",
    connected: "connected",
    failed: "failed",
  },
};

const healthLabels: Record<Language, Record<NonNullable<ProviderHealth>, string>> = {
  zh: {
    healthy: "健康",
    degraded: "降级",
    offline: "离线",
  },
  en: {
    healthy: "healthy",
    degraded: "degraded",
    offline: "offline",
  },
};

type ProviderHealth = "healthy" | "degraded" | "offline";

const memoryKindLabels: Record<Language, Record<MemoryKind, string>> = {
  zh: {
    profile: "用户偏好",
    project: "项目记忆",
    episodic: "任务经历",
    procedural: "流程经验",
  },
  en: {
    profile: "profile",
    project: "project",
    episodic: "episodic",
    procedural: "procedural",
  },
};

const logLevelLabels: Record<Language, Record<RuntimeLog["level"], string>> = {
  zh: {
    info: "信息",
    warning: "警告",
    error: "错误",
    security: "安全",
  },
  en: {
    info: "info",
    warning: "warning",
    error: "error",
    security: "security",
  },
};

type I18nValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  toggleLanguage: () => void;
  t: (key: TranslationKey) => string;
  formatHealth: (health?: ProviderHealth) => string;
  formatLogLevel: (level: RuntimeLog["level"]) => string;
  formatMemoryKind: (kind: MemoryKind) => string;
  formatModelPolicy: (policy: ModelPolicy) => string;
  formatProviderStatus: (status: ProviderConfig["status"]) => string;
  formatRisk: (risk: RiskLevel) => string;
  formatStepStatus: (status: PlanStepStatus) => string;
  formatTaskStatus: (status: TaskStatus) => string;
};

const I18nContext = createContext<I18nValue | undefined>(undefined);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>("zh");

  const value = useMemo<I18nValue>(
    () => ({
      language,
      setLanguage,
      toggleLanguage: () => setLanguage((current) => (current === "zh" ? "en" : "zh")),
      t: (key) => dictionaries[language][key],
      formatHealth: (health) => (health ? healthLabels[language][health] : "-"),
      formatLogLevel: (level) => logLevelLabels[language][level],
      formatMemoryKind: (kind) => memoryKindLabels[language][kind],
      formatModelPolicy: (policy) => modelPolicyLabels[language][policy],
      formatProviderStatus: (status) => providerStatusLabels[language][status],
      formatRisk: (risk) => riskLabels[language][risk],
      formatStepStatus: (status) => planStepStatusLabels[language][status],
      formatTaskStatus: (status) => taskStatusLabels[language][status],
    }),
    [language],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useI18n() {
  const context = useContext(I18nContext);

  if (!context) {
    throw new Error("useI18n must be used inside I18nProvider");
  }

  return context;
}
