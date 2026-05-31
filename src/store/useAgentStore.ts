import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { v4 as uuidv4 } from "uuid";
import type {
  AgentTask,
  ContextReport,
  ExecutionPlan,
  McpServerManifest,
  MemoryKind,
  MemoryRecord,
  ModelPolicy,
  ProviderConfig,
  PlanStepStatus,
  RuntimeLog,
  SkillManifest,
  TaskAttachment,
  TaskExecutionMode,
  UsageEntry,
} from "../domain/types";
import {
  builtInMcpServers,
  builtInSkills,
  defaultProviders,
  permissions,
  seedMemories,
} from "../runtime/catalog";
import { compileContext } from "../runtime/contextEngine";
import { createExecutionPlan, inferRiskLevel } from "../runtime/planner";
import { testProviderConnection, type ProviderTestResult } from "../runtime/providerClient";
import { calculateCacheCost, calculateCost } from "../runtime/usage";
import {
  persistMemory,
  registerMcp,
  removePersistedMemory,
  setMcpEnabled,
} from "../desktop/runtimeClient";

type CreateTaskInput = {
  input: string;
  workspace?: string;
  attachments?: TaskAttachment[];
  modelPolicy: ModelPolicy;
  softBudgetUsd?: number;
  hardBudgetUsd?: number;
  executionMode?: TaskExecutionMode;
};

type MemoryDraft = Pick<MemoryRecord, "kind" | "content" | "source" | "confidence" | "enabled">;

type AgentState = {
  tasks: AgentTask[];
  plans: Record<string, ExecutionPlan>;
  memories: MemoryRecord[];
  skills: SkillManifest[];
  mcpServers: McpServerManifest[];
  providers: ProviderConfig[];
  usageEntries: UsageEntry[];
  logs: RuntimeLog[];
  contextReports: Record<string, ContextReport>;
  activeTaskId?: string;
  createTask: (input: CreateTaskInput) => AgentTask;
  approvePlan: (taskId: string) => void;
  pauseTask: (taskId: string) => void;
  resumeTask: (taskId: string) => void;
  cancelTask: (taskId: string) => void;
  updatePlanStepStatus: (taskId: string, stepId: string, status: PlanStepStatus) => void;
  addMemory: (memory: MemoryDraft) => MemoryRecord;
  updateMemory: (id: string, patch: Partial<MemoryRecord>) => void;
  deleteMemory: (id: string) => void;
  searchMemory: (query: string, kind?: MemoryKind) => MemoryRecord[];
  enableSkill: (name: string, enabled: boolean) => void;
  installSkill: (skill: SkillManifest) => void;
  enableMcp: (name: string, enabled: boolean) => void;
  installMcp: (server: McpServerManifest) => void;
  testProvider: (id: string, apiKey?: string) => Promise<ProviderTestResult>;
  saveProvider: (provider: ProviderConfig) => void;
};

function now(): string {
  return new Date().toISOString();
}

function addLog(
  logs: RuntimeLog[],
  message: string,
  level: RuntimeLog["level"] = "info",
  taskId?: string,
): RuntimeLog[] {
  return [
    {
      id: uuidv4(),
      taskId,
      level,
      message,
      createdAt: now(),
    },
    ...logs,
  ].slice(0, 80);
}

function redactSecret(message: string, secret?: string): string {
  if (!secret) {
    return message;
  }

  return message.replaceAll(secret, "[redacted]");
}

function selectProvider(providers: ProviderConfig[], modelPolicy: ModelPolicy): ProviderConfig {
  return (
    providers.find((provider) => provider.enabled && provider.tags.includes(modelPolicy)) ??
    providers.find((provider) => provider.enabled) ??
    providers[0]
  );
}

function normalizePersistedProvider(provider: ProviderConfig): ProviderConfig {
  const maskedKey = provider.maskedKey?.trim();
  const isDemoKey = maskedKey?.toLowerCase().includes("demo") ?? false;
  const hasStoredCredential =
    provider.kind === "ollama" ||
    Boolean(maskedKey && maskedKey !== "未配置" && !isDemoKey);

  return {
    ...provider,
    maskedKey: isDemoKey ? "未配置" : provider.maskedKey,
    status:
      provider.status === "connected" && !hasStoredCredential
        ? "untested"
        : provider.status,
  };
}

const demoTask: AgentTask = {
  id: "task-demo-1",
  title: "生成跨平台自动化周报工作流",
  input: "读取本周任务日志和 Token 用量，生成一份结构化周报，并标记超预算任务。",
  workspace: "/Users/demo/workspace",
  status: "planned",
  executionMode: "plan",
  riskLevel: "medium",
  createdAt: now(),
  updatedAt: now(),
};

const demoPlan = createExecutionPlan(demoTask, "balanced", 1.5, 3);
const demoContext = compileContext({
  task: demoTask,
  memories: seedMemories,
  skills: builtInSkills,
  historySummary: "上一次周报任务中，用户要求输出按项目和模型聚合的成本表。",
  selectedArtifacts: ["任务日志摘要：12 个已完成任务，2 个超预算提醒。"],
  maxTokens: 6_000,
});
const demoProvider = selectProvider(defaultProviders, "balanced");
const demoDeepSeekProvider =
  defaultProviders.find((provider) => provider.id === "deepseek") ?? demoProvider;
const demoUsage: UsageEntry[] = [
  {
    id: "usage-1",
    taskId: demoTask.id,
    providerId: demoProvider.id,
    model: demoProvider.model,
    promptTokens: 5_420,
    completionTokens: 1_860,
    embeddingTokens: 800,
    cachedTokens: 1_200,
    cacheCostUsd: calculateCacheCost(demoProvider, 1_200),
    costUsd: calculateCost(demoProvider, 5_420, 1_860, 800),
    createdAt: now(),
  },
  {
    id: "usage-2",
    taskId: "task-demo-0",
    providerId: "deepseek",
    model: "deepseek-chat",
    promptTokens: 4_300,
    completionTokens: 1_100,
    embeddingTokens: 500,
    cachedTokens: 900,
    cacheCostUsd: calculateCacheCost(demoDeepSeekProvider, 900),
    costUsd: 0.0025,
    createdAt: now(),
  },
];

export const useAgentStore = create<AgentState>()(
  persist(
    (set, get) => ({
  tasks: [demoTask],
  plans: { [demoTask.id]: demoPlan },
  memories: seedMemories,
  skills: builtInSkills,
  mcpServers: builtInMcpServers,
  providers: defaultProviders,
  usageEntries: demoUsage,
  logs: addLog([], "AstraFlow Runtime 已启动，本地沙箱与审批策略处于启用状态。"),
  contextReports: { [demoTask.id]: demoContext },
  activeTaskId: demoTask.id,
  createTask: ({
    input,
    workspace,
    attachments = [],
    modelPolicy,
    softBudgetUsd,
    hardBudgetUsd,
    executionMode = "plan",
  }) => {
    const riskLevel = inferRiskLevel(input);
    const shouldAutoExecute = executionMode === "direct" && riskLevel !== "high";
    const shouldBlockForApproval = executionMode === "direct" && riskLevel === "high";
    const task: AgentTask = {
      id: uuidv4(),
      title: input.length > 24 ? `${input.slice(0, 24)}...` : input,
      input,
      workspace,
      attachments,
      executionMode,
      status: shouldAutoExecute ? "done" : shouldBlockForApproval ? "blocked" : "planned",
      riskLevel,
      createdAt: now(),
      updatedAt: now(),
    };
    const plan = createExecutionPlan(task, modelPolicy, softBudgetUsd, hardBudgetUsd);
    const executablePlan: ExecutionPlan = shouldAutoExecute
      ? {
          ...plan,
          steps: plan.steps.map((step) => ({
            ...step,
            status: "done",
            outputPreview:
              step.outputPreview ?? `${step.title} 已由直接执行模式完成。`,
          })),
        }
      : plan;
    const selectedArtifacts = [
      ...(workspace ? [`当前工作区：${workspace}`] : []),
      ...attachments.map(
        (attachment) =>
          `${attachment.type === "image" ? "图片" : "文件"}：${attachment.name}，类型 ${attachment.mimeType || "unknown"}，大小 ${Math.round(attachment.size / 1024)} KB。`,
      ),
    ];
    const contextReport = compileContext({
      task,
      memories: get().memories,
      skills: get().skills,
      historySummary: "最近的任务偏好：先生成计划，再等待审批，最后写入报告。",
      selectedArtifacts: selectedArtifacts.length ? selectedArtifacts : undefined,
      maxTokens: Math.min(plan.estimatedTokenPlan.maxTokens, 10_000),
    });
    const provider = selectProvider(get().providers, plan.estimatedTokenPlan.modelPolicy);
    const autoUsage: UsageEntry | undefined = shouldAutoExecute
      ? {
          id: uuidv4(),
          taskId: task.id,
          providerId: provider.id,
          model: provider.model,
          promptTokens: plan.estimatedTokenPlan.estimatedInputTokens,
          completionTokens: Math.round(plan.estimatedTokenPlan.estimatedOutputTokens * 0.64),
          embeddingTokens: attachments.length ? 760 : 420,
          cachedTokens: 1_000,
          cacheCostUsd: calculateCacheCost(provider, 1_000),
          costUsd: calculateCost(
            provider,
            plan.estimatedTokenPlan.estimatedInputTokens,
            Math.round(plan.estimatedTokenPlan.estimatedOutputTokens * 0.64),
            attachments.length ? 760 : 420,
          ),
          createdAt: now(),
        }
      : undefined;
    const autoMemory: MemoryRecord | undefined = shouldAutoExecute
      ? {
          id: uuidv4(),
          kind: "episodic",
          content: `直接执行任务「${task.title}」已完成，风险等级 ${task.riskLevel}，工作区 ${workspace || "未指定"}。`,
          source: "direct-execution",
          confidence: 0.82,
          enabled: true,
          createdAt: now(),
          updatedAt: now(),
          embeddingId: `local-episodic-${task.id}`,
        }
      : undefined;

    set((state) => ({
      tasks: [task, ...state.tasks],
      plans: { ...state.plans, [task.id]: executablePlan },
      contextReports: { ...state.contextReports, [task.id]: contextReport },
      usageEntries: autoUsage ? [autoUsage, ...state.usageEntries] : state.usageEntries,
      memories: autoMemory ? [autoMemory, ...state.memories] : state.memories,
      activeTaskId: task.id,
      logs: addLog(
        state.logs,
        shouldAutoExecute
          ? `直接执行完成：${task.title}，Token 用量和 episodic memory 已写入。`
          : shouldBlockForApproval
            ? `直接执行被安全层拦截：${task.title} 需要人工审批。`
            : `已创建任务计划：${task.title}，风险等级 ${task.riskLevel}。`,
        shouldBlockForApproval || task.riskLevel === "high" ? "security" : "info",
        task.id,
      ),
    }));

    return task;
  },
  approvePlan: (taskId) => {
    const state = get();
    const plan = state.plans[taskId];
    const task = state.tasks.find((item) => item.id === taskId);

    if (!plan || !task) {
      return;
    }

    const provider = selectProvider(state.providers, plan.estimatedTokenPlan.modelPolicy);
    const usage: UsageEntry = {
      id: uuidv4(),
      taskId,
      providerId: provider.id,
      model: provider.model,
      promptTokens: plan.estimatedTokenPlan.estimatedInputTokens,
      completionTokens: Math.round(plan.estimatedTokenPlan.estimatedOutputTokens * 0.72),
      embeddingTokens: 620,
      cachedTokens: 1_400,
      cacheCostUsd: calculateCacheCost(provider, 1_400),
      costUsd: calculateCost(
        provider,
        plan.estimatedTokenPlan.estimatedInputTokens,
        Math.round(plan.estimatedTokenPlan.estimatedOutputTokens * 0.72),
        620,
      ),
      createdAt: now(),
    };

    set((current) => ({
      tasks: current.tasks.map((item) =>
        item.id === taskId
          ? { ...item, status: "done", updatedAt: now() }
          : item,
      ),
      plans: {
        ...current.plans,
        [taskId]: {
          ...plan,
          steps: plan.steps.map((step) => ({
            ...step,
            status: "done",
            outputPreview:
              step.outputPreview ?? `${step.title} 已完成，结果写入本地任务报告。`,
          })),
        },
      },
      usageEntries: [usage, ...current.usageEntries],
      logs: addLog(
        addLog(current.logs, `审批通过，任务 ${task.title} 已完成模拟执行。`, "info", taskId),
        "Token 用量已写入 Usage Ledger，密钥未进入日志。",
        "security",
        taskId,
      ),
    }));
  },
  pauseTask: (taskId) => {
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === taskId ? { ...task, status: "paused", updatedAt: now() } : task,
      ),
      logs: addLog(state.logs, "任务已暂停。", "warning", taskId),
    }));
  },
  resumeTask: (taskId) => {
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === taskId ? { ...task, status: "running", updatedAt: now() } : task,
      ),
      logs: addLog(state.logs, "任务已继续执行。", "info", taskId),
    }));
  },
  cancelTask: (taskId) => {
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === taskId ? { ...task, status: "failed", updatedAt: now() } : task,
      ),
      logs: addLog(state.logs, "任务已取消。", "warning", taskId),
    }));
  },
  updatePlanStepStatus: (taskId, stepId, status) => {
    set((state) => {
      const plan = state.plans[taskId];
      const task = state.tasks.find((item) => item.id === taskId);
      const step = plan?.steps.find((item) => item.id === stepId);

      if (!plan || !task || !step) {
        return state;
      }

      return {
        plans: {
          ...state.plans,
          [taskId]: {
            ...plan,
            steps: plan.steps.map((item) =>
              item.id === stepId
                ? {
                    ...item,
                    status,
                    outputPreview:
                      status === "done"
                        ? item.outputPreview ?? `${item.title} 已由画布操作标记完成。`
                        : item.outputPreview,
                  }
                : item,
            ),
          },
        },
        logs: addLog(
          state.logs,
          `画布操作：${task.title} / ${step.title} 已切换为 ${status}。`,
          status === "needs_approval" ? "security" : status === "failed" ? "warning" : "info",
          taskId,
        ),
      };
    });
  },
  addMemory: (draft) => {
    const id = uuidv4();
    const memory: MemoryRecord = {
      ...draft,
      id,
      createdAt: now(),
      updatedAt: now(),
      embeddingId: `local-${draft.kind}-${id}`,
    };

    set((state) => ({
      memories: [memory, ...state.memories],
      logs: addLog(state.logs, `已添加 ${draft.kind} 记忆：${draft.source}。`),
    }));
    void persistMemory(memory);

    return memory;
  },
  updateMemory: (id, patch) => {
    set((state) => ({
      memories: state.memories.map((memory) =>
        memory.id === id ? { ...memory, ...patch, updatedAt: now() } : memory,
      ),
      logs: addLog(state.logs, `记忆 ${id} 已更新。`),
    }));
    const memory = get().memories.find((item) => item.id === id);
    if (memory) {
      void persistMemory(memory);
    }
  },
  deleteMemory: (id) => {
    set((state) => {
      const memory = state.memories.find((item) => item.id === id);

      return {
        memories: state.memories.filter((item) => item.id !== id),
        logs: addLog(
          state.logs,
          memory ? `已删除 ${memory.kind} 记忆：${memory.source}。` : `记忆 ${id} 已删除。`,
          "warning",
        ),
      };
    });
    void removePersistedMemory(id);
  },
  searchMemory: (query, kind) => {
    const normalizedQuery = query.trim().toLowerCase();
    return get().memories.filter((memory) => {
      const matchesKind = kind ? memory.kind === kind : true;
      const matchesQuery = normalizedQuery
        ? memory.content.toLowerCase().includes(normalizedQuery) ||
          memory.source.toLowerCase().includes(normalizedQuery)
        : true;
      return matchesKind && matchesQuery;
    });
  },
  enableSkill: (name, enabled) => {
    set((state) => ({
      skills: state.skills.map((skill) =>
        skill.name === name ? { ...skill, enabled } : skill,
      ),
      logs: addLog(state.logs, `Skill ${name} 已${enabled ? "启用" : "停用"}。`),
    }));
  },
  installSkill: (skill) => {
    set((state) => ({
      skills: [{ ...skill, installedAt: now(), enabled: false }, ...state.skills],
      logs: addLog(state.logs, `已生成 Skill 配置草稿：${skill.name}。`),
    }));
  },
  enableMcp: (name, enabled) => {
    const server = get().mcpServers.find((item) => item.name === name);
    set((state) => ({
      mcpServers: state.mcpServers.map((server) =>
        server.name === name ? { ...server, enabled } : server,
      ),
      logs: addLog(state.logs, `MCP Server ${name} 已${enabled ? "启用" : "停用"}。`),
    }));
    if (server) {
      void setMcpEnabled(server, enabled)
        .then((result) => {
          set((state) => ({
            mcpServers: state.mcpServers.map((item) =>
              item.name === name ? { ...item, health: result.health } : item,
            ),
            logs: addLog(state.logs, `MCP Server ${name}：${result.message}`),
          }));
        })
        .catch((error: unknown) => {
          set((state) => ({
            mcpServers: state.mcpServers.map((item) =>
              item.name === name ? { ...item, enabled: false, health: "offline" } : item,
            ),
            logs: addLog(
              state.logs,
              `MCP Server ${name} 启停失败：${error instanceof Error ? error.message : "未知错误"}`,
              "warning",
            ),
          }));
        });
    }
  },
  installMcp: (server) => {
    set((state) => ({
      mcpServers: [
        { ...server, installedAt: now(), enabled: false, health: "offline" },
        ...state.mcpServers,
      ],
      logs: addLog(state.logs, `已生成 MCP Server 配置草稿：${server.name}。`),
    }));
    void registerMcp(server);
  },
  testProvider: async (id, apiKey) => {
    const provider = get().providers.find((item) => item.id === id);

    if (!provider) {
      const result: ProviderTestResult = {
        ok: false,
        message: `未找到 Provider：${id}`,
        latencyMs: 0,
        promptTokens: 0,
        completionTokens: 0,
        costUsd: 0,
      };

      set((state) => ({
        logs: addLog(state.logs, result.message, "error"),
      }));

      return result;
    }

    set((state) => ({
      logs: addLog(state.logs, `开始测试 Provider：${provider.name}，不会记录明文 API Key。`),
    }));

    const rawResult = await testProviderConnection(provider, apiKey);
    const result: ProviderTestResult = {
      ...rawResult,
      message: redactSecret(rawResult.message, apiKey),
    };
    const usage: UsageEntry | undefined = result.ok
      ? {
          id: uuidv4(),
          taskId: "provider-test",
          providerId: provider.id,
          model: provider.model,
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
          embeddingTokens: 0,
          cachedTokens: 0,
          cacheCostUsd: 0,
          costUsd: result.costUsd,
          createdAt: now(),
        }
      : undefined;

    set((state) => ({
      providers: state.providers.map((item) =>
        item.id === id
          ? {
              ...item,
              maskedKey: result.maskedKey ?? item.maskedKey,
              status: result.ok ? "connected" : "failed",
            }
          : item,
      ),
      usageEntries: usage ? [usage, ...state.usageEntries] : state.usageEntries,
      logs: addLog(
        state.logs,
        `Provider ${provider.name} ${result.ok ? "连通成功" : "连通失败"}：${result.message}`,
        result.ok ? "info" : "warning",
      ),
    }));

    return result;
  },
  saveProvider: (provider) => {
    set((state) => ({
      providers: state.providers.some((item) => item.id === provider.id)
        ? state.providers.map((item) => (item.id === provider.id ? provider : item))
        : [provider, ...state.providers],
      logs: addLog(state.logs, `Provider ${provider.name} 已保存，API Key 仅保留脱敏标记。`),
    }));
  },
}),
    {
      name: "astraflow-agent-state-v1",
      version: 5,
      storage: createJSONStorage(() => localStorage),
      merge: (persisted, current) => {
        const saved = persisted as Partial<AgentState> | undefined;
        const savedProviders = saved?.providers ?? [];
        const providerMap = new Map(
          savedProviders.map((provider) => [provider.id, normalizePersistedProvider(provider)]),
        );

        for (const provider of defaultProviders) {
          providerMap.set(
            provider.id,
            normalizePersistedProvider({ ...provider, ...providerMap.get(provider.id) }),
          );
        }

        return {
          ...current,
          ...saved,
          providers: Array.from(providerMap.values()),
        } as AgentState;
      },
      partialize: (state) => ({
        tasks: state.tasks,
        plans: state.plans,
        memories: state.memories,
        skills: state.skills,
        mcpServers: state.mcpServers,
        providers: state.providers,
        usageEntries: state.usageEntries,
        logs: state.logs,
        contextReports: state.contextReports,
        activeTaskId: state.activeTaskId,
      }),
    },
  ),
);

export { permissions };
