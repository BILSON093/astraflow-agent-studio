import type {
  AgentTask,
  ExecutionPlan,
  ModelPolicy,
  Permission,
  PlanStep,
  RiskLevel,
  TokenPlan,
} from "../domain/types";
import { permissions } from "./catalog";

const highRiskPattern =
  /删除|rm\s+-rf|deploy|部署|生产|prod|git\s+push|推送|密钥|secret|api\s*token|access\s*token|shell|终端|命令/iu;
const mediumRiskPattern =
  /写入|修改|创建文件|调用接口|api|http|数据库|db|安装|install|mcp|skill/iu;
const codingPattern =
  /代码|bug|测试|lint|build|编译|重构|repo|仓库|commit|pr|ci|前端|后端/iu;

export function inferRiskLevel(input: string): RiskLevel {
  if (highRiskPattern.test(input)) {
    return "high";
  }

  if (mediumRiskPattern.test(input)) {
    return "medium";
  }

  return "low";
}

export function estimateTokens(text: string): number {
  return Math.max(128, Math.ceil(text.length / 3.2));
}

export function estimateTokenPlan(
  input: string,
  modelPolicy: ModelPolicy,
  softBudgetUsd = 1.5,
  hardBudgetUsd = 3,
): TokenPlan {
  const inputTokens = estimateTokens(input) + 3_200;
  const outputTokens =
    modelPolicy === "strong_reasoning"
      ? 4_000
      : modelPolicy === "long_context"
        ? 3_000
        : 2_000;
  const multiplier =
    modelPolicy === "low_cost" || modelPolicy === "privacy_first"
      ? 0.25
      : modelPolicy === "strong_reasoning"
        ? 1.8
        : 0.8;

  return {
    maxTokens: inputTokens + outputTokens + 6_000,
    softBudgetUsd,
    hardBudgetUsd,
    modelPolicy,
    estimatedInputTokens: inputTokens,
    estimatedOutputTokens: outputTokens,
    estimatedCostUsd: Number(((inputTokens * 0.000001 + outputTokens * 0.000006) * multiplier).toFixed(4)),
  };
}

export function getRequiredPermissions(input: string, riskLevel: RiskLevel): Permission[] {
  const required = [permissions["fs.read"]];
  const lower = input.toLowerCase();

  if (riskLevel !== "low" || /写入|修改|生成|创建|修复|重构|bug/i.test(input)) {
    required.push(permissions["fs.write"]);
  }

  if (riskLevel === "high" || lower.includes("shell") || lower.includes("命令")) {
    required.push(permissions["shell.exec"]);
  }

  if (/api|http|联网|外部|mcp/.test(lower)) {
    required.push(permissions["network.http"]);
  }

  if (/git push|推送/.test(lower)) {
    required.push(permissions["git.push"]);
  }

  return Array.from(new Map(required.map((permission) => [permission.id, permission])).values());
}

function makeStep(
  index: number,
  data: Omit<PlanStep, "id" | "status">,
  needsApproval: boolean,
): PlanStep {
  return {
    ...data,
    id: `step-${index}`,
    status: needsApproval && data.riskLevel === "high" ? "needs_approval" : "waiting",
  };
}

export function createExecutionPlan(
  task: AgentTask,
  modelPolicy: ModelPolicy,
  softBudgetUsd?: number,
  hardBudgetUsd?: number,
): ExecutionPlan {
  const riskLevel = inferRiskLevel(task.input);
  const tokenPlan = estimateTokenPlan(task.input, modelPolicy, softBudgetUsd, hardBudgetUsd);
  const requiresApproval = riskLevel === "high";
  const isCodingTask = codingPattern.test(task.input);
  const requiredPermissions = getRequiredPermissions(task.input, riskLevel);

  const steps: PlanStep[] = [
    makeStep(
      1,
      {
        title: "Planner 任务拆解",
        description: "识别目标、风险、约束和可执行步骤。",
        type: "planner",
        riskLevel: "low",
        estimatedTokens: 900,
        inputPreview: task.input,
        outputPreview: "生成 6 步执行计划，标记权限和预算。",
      },
      requiresApproval,
    ),
    makeStep(
      2,
      {
        title: "Memory 记忆召回",
        description: "检索用户偏好、项目背景、历史任务和流程经验。",
        type: "memory",
        riskLevel: "low",
        tool: "LanceDB local vector memory",
        estimatedTokens: 700,
        inputPreview: "query: task intent + workspace",
        outputPreview: "返回 profile/project/episodic/procedural 相关记忆。",
      },
      requiresApproval,
    ),
    makeStep(
      3,
      {
        title: "Context 上下文编排",
        description: "按优先级组装任务输入、选中文件、记忆和 Skill 指令。",
        type: "context",
        riskLevel: "low",
        tool: "Context Compiler",
        estimatedTokens: 1_200,
        inputPreview: "task + memory + skills + selected artifacts",
        outputPreview: "生成可检查的 included/dropped context report。",
      },
      requiresApproval,
    ),
    makeStep(
      4,
      {
        title: isCodingTask ? "Skill: 代码任务计划" : "Skill: 工作流计划",
        description: isCodingTask
          ? "生成影响文件、修改策略、验证命令和回滚建议。"
          : "选择合适的通用工作流 Skill，并验证所需权限。",
        type: "skill",
        riskLevel: riskLevel === "high" ? "medium" : "low",
        tool: isCodingTask ? "coding-plan" : "workflow-orchestrator",
        estimatedTokens: 1_100,
        inputPreview: "task + compact context",
        outputPreview: isCodingTask ? "代码任务计划已生成。" : "工作流计划已生成。",
      },
      requiresApproval,
    ),
    makeStep(
      5,
      {
        title: "MCP/Tool 执行准备",
        description: "检查 MCP Server 健康状态，路由到可用工具。",
        type: "mcp",
        riskLevel,
        tool: riskLevel === "high" ? "sandbox-shell / filesystem-safe" : "filesystem-safe",
        estimatedTokens: 500,
        inputPreview: "required tools + permission manifest",
        outputPreview: requiresApproval ? "等待高风险权限审批。" : "工具准备完成。",
      },
      requiresApproval,
    ),
    makeStep(
      6,
      {
        title: "Model Call + 结果汇总",
        description: "执行模型推理，写入任务报告、Token 账单和可复用记忆。",
        type: "model",
        riskLevel: "low",
        model: tokenPlan.modelPolicy,
        estimatedTokens: tokenPlan.estimatedInputTokens + tokenPlan.estimatedOutputTokens,
        inputPreview: "compiled context + tool results",
        outputPreview: "生成最终报告，并沉淀 episodic/procedural memory。",
      },
      requiresApproval,
    ),
  ];

  return {
    taskId: task.id,
    steps,
    requiredPermissions,
    estimatedTokenPlan: tokenPlan,
    codingPlan: isCodingTask
      ? {
          affectedAreas: ["任务入口", "上下文编排", "验证命令"],
          strategy: "先读项目结构和关键文件，再生成最小变更，最后运行类型检查与单元测试。",
          verification: ["npm run build", "npm run test"],
          rollback: "保持每个任务的文件级变更记录，高风险操作前生成快照。",
        }
      : undefined,
  };
}
