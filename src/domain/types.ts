export type RiskLevel = "low" | "medium" | "high";

export type TaskStatus =
  | "planned"
  | "running"
  | "paused"
  | "blocked"
  | "done"
  | "failed";

export type PlanStepStatus =
  | "waiting"
  | "running"
  | "needs_approval"
  | "done"
  | "failed";

export type ModelPolicy =
  | "low_cost"
  | "balanced"
  | "strong_reasoning"
  | "long_context"
  | "code_first"
  | "privacy_first";

export type MemoryKind = "profile" | "project" | "episodic" | "procedural";

export type PermissionLevel = "read" | "write" | "execute" | "external" | "admin";

export type Permission = {
  id: string;
  label: string;
  level: PermissionLevel;
  riskLevel: RiskLevel;
  description: string;
};

export type AgentTask = {
  id: string;
  title: string;
  input: string;
  workspace?: string;
  attachments?: TaskAttachment[];
  status: TaskStatus;
  riskLevel: RiskLevel;
  createdAt: string;
  updatedAt: string;
};

export type TaskAttachment = {
  id: string;
  name: string;
  type: "image" | "file";
  mimeType: string;
  size: number;
  previewUrl?: string;
};

export type PlanStep = {
  id: string;
  title: string;
  description: string;
  type:
    | "planner"
    | "memory"
    | "context"
    | "mcp"
    | "skill"
    | "model"
    | "approval"
    | "result";
  status: PlanStepStatus;
  riskLevel: RiskLevel;
  tool?: string;
  model?: string;
  estimatedTokens: number;
  inputPreview: string;
  outputPreview?: string;
};

export type TokenPlan = {
  maxTokens: number;
  softBudgetUsd?: number;
  hardBudgetUsd?: number;
  modelPolicy: ModelPolicy;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCostUsd: number;
};

export type ExecutionPlan = {
  taskId: string;
  steps: PlanStep[];
  requiredPermissions: Permission[];
  estimatedTokenPlan: TokenPlan;
  codingPlan?: {
    affectedAreas: string[];
    strategy: string;
    verification: string[];
    rollback: string;
  };
};

export type MemoryRecord = {
  id: string;
  kind: MemoryKind;
  content: string;
  source: string;
  confidence: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  embeddingId?: string;
};

export type SkillManifest = {
  name: string;
  version: string;
  description: string;
  entry: "SKILL.md";
  permissions: Permission[];
  scripts?: Record<string, string>;
  enabled?: boolean;
  installedAt?: string;
};

export type McpServerManifest = {
  name: string;
  transport: "stdio" | "http" | "sse";
  command?: string;
  url?: string;
  envSchema?: Record<string, string>;
  permissions: Permission[];
  enabled?: boolean;
  health?: "healthy" | "degraded" | "offline";
  installedAt?: string;
};

export type ProviderKind =
  | "openai-compatible"
  | "anthropic"
  | "gemini"
  | "deepseek"
  | "qwen"
  | "kimi"
  | "zhipu"
  | "ollama";

export type ProviderConfig = {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  model: string;
  contextWindow: number;
  inputPricePerMTok: number;
  outputPricePerMTok: number;
  tags: ModelPolicy[];
  enabled: boolean;
  maskedKey?: string;
  status: "untested" | "connected" | "failed";
};

export type UsageEntry = {
  id: string;
  taskId: string;
  providerId: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  embeddingTokens: number;
  cachedTokens: number;
  costUsd: number;
  createdAt: string;
};

export type ContextSection = {
  id: string;
  title: string;
  source: string;
  priority: number;
  tokens: number;
  content: string;
};

export type ContextReport = {
  taskId: string;
  maxTokens: number;
  included: ContextSection[];
  dropped: ContextSection[];
  totalTokens: number;
};

export type RuntimeLog = {
  id: string;
  taskId?: string;
  level: "info" | "warning" | "error" | "security";
  message: string;
  createdAt: string;
};
