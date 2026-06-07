import type {
  AgentTask,
  ExecutionPlan,
  McpServerManifest,
  MemoryRecord,
  RuntimeLog,
  UsageEntry,
} from "../domain/types";
import { invokeAstraFlow, isTauriRuntime } from "./commands";

export type McpStatusResult = {
  ok: boolean;
  name: string;
  health: "healthy" | "degraded" | "offline";
  message: string;
};

export type RuntimeStatus = {
  ok: boolean;
  storage: "sqlite";
  memoryCount: number;
  mcpCount: number;
  taskCount: number;
  usageCount: number;
  runtimeLogCount: number;
  permissionAuditCount: number;
  agentJobCount: number;
  runningMcp: number;
  sidecarRunning: boolean;
};

export type ShellExecuteInput = {
  workspace: string;
  executable: string;
  args: string[];
  approved: boolean;
};

export type ShellExecuteResult = {
  ok: boolean;
  executable: string;
  args: string[];
  statusCode?: number;
  stdout: string;
  stderr: string;
};

export type McpTool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

export type RestorableTask = {
  id: string;
  status: AgentTask["status"];
  task: AgentTask;
  plan?: ExecutionPlan;
  updatedAt: string;
};

export type PersistedTask = RestorableTask & {
  createdAt: string;
};

export type PermissionAuditInput = {
  id: string;
  taskId?: string;
  actor: string;
  permissionId: string;
  resource: string;
  decision: "approved" | "rejected" | "timeout" | "auto";
  payloadHash?: string;
  createdAt: string;
};

export type AgentJobRecord = {
  id: string;
  taskId: string;
  status: "queued" | "running" | "paused" | "done" | "failed" | "cancelled";
  cursorStepId?: string;
  failureReason?: string;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
};

export type AgentStepRecord = {
  id: string;
  jobId: string;
  stepId: string;
  status: string;
  inputJson?: unknown;
  outputJson?: unknown;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
};

export async function persistMemory(memory: MemoryRecord): Promise<void> {
  if (isTauriRuntime()) {
    await invokeAstraFlow("memory.update", memory);
  }
}

export async function removePersistedMemory(id: string): Promise<void> {
  if (isTauriRuntime()) {
    await invokeAstraFlow("memory.delete", { id });
  }
}

export async function registerMcp(server: McpServerManifest): Promise<void> {
  if (isTauriRuntime()) {
    await invokeAstraFlow("mcp.install", server);
  }
}

export async function setMcpEnabled(
  server: McpServerManifest,
  enabled: boolean,
): Promise<McpStatusResult> {
  if (!isTauriRuntime()) {
    return {
      ok: true,
      name: server.name,
      health: "offline",
      message: "网页预览模式仅保存配置草稿。",
    };
  }

  await registerMcp(server);
  return invokeAstraFlow<McpStatusResult>("mcp.enable", { server, enabled });
}

export async function readRuntimeStatus(): Promise<RuntimeStatus | undefined> {
  if (isTauriRuntime()) {
    return invokeAstraFlow<RuntimeStatus>("runtime.status");
  }
}

export async function listMcpTools(server: McpServerManifest): Promise<McpTool[]> {
  const result = await invokeAstraFlow<{ tools?: McpTool[] }>("mcp.listTools", { server });
  return result.tools ?? [];
}

export async function callMcpTool(
  server: McpServerManifest,
  toolName: string,
  arguments_: Record<string, unknown> = {},
): Promise<unknown> {
  return invokeAstraFlow("mcp.callTool", { server, toolName, arguments: arguments_ });
}

export async function persistTaskCheckpoint(task: AgentTask, plan?: ExecutionPlan): Promise<void> {
  if (isTauriRuntime()) {
    await invokeAstraFlow("task.checkpoint", { id: task.id, status: task.status, task, plan });
  }
}

export async function persistUsageEntry(entry: UsageEntry): Promise<void> {
  if (isTauriRuntime()) {
    await invokeAstraFlow("usage.report", entry);
  }
}

export async function persistRuntimeLog(log: RuntimeLog): Promise<void> {
  if (isTauriRuntime()) {
    await invokeAstraFlow("runtime.logAppend", log);
  }
}

export async function listPersistedTasks(limit = 200): Promise<PersistedTask[]> {
  if (!isTauriRuntime()) {
    return [];
  }
  return invokeAstraFlow<PersistedTask[]>("task.list", { limit });
}

export async function listPersistedUsage(limit = 500): Promise<UsageEntry[]> {
  if (!isTauriRuntime()) {
    return [];
  }
  return invokeAstraFlow<UsageEntry[]>("usage.list", { limit });
}

export async function listPersistedRuntimeLogs(limit = 300): Promise<RuntimeLog[]> {
  if (!isTauriRuntime()) {
    return [];
  }
  return invokeAstraFlow<RuntimeLog[]>("runtime.logsList", { limit });
}

export async function persistPermissionAudit(input: PermissionAuditInput): Promise<void> {
  if (isTauriRuntime()) {
    await invokeAstraFlow("permission.auditAppend", input);
  }
}

export async function upsertAgentJob(job: AgentJobRecord): Promise<void> {
  if (isTauriRuntime()) {
    await invokeAstraFlow("agent.jobUpsert", job);
  }
}

export async function upsertAgentStep(step: AgentStepRecord): Promise<void> {
  if (isTauriRuntime()) {
    await invokeAstraFlow("agent.stepUpsert", step);
  }
}

export async function listAgentJobs(limit = 100): Promise<AgentJobRecord[]> {
  if (!isTauriRuntime()) {
    return [];
  }
  return invokeAstraFlow<AgentJobRecord[]>("agent.jobsList", { limit });
}

export async function restoreInterruptedTasks(): Promise<RestorableTask[]> {
  if (!isTauriRuntime()) {
    return [];
  }
  return invokeAstraFlow<RestorableTask[]>("task.restore");
}

export async function executeRestrictedShell(
  input: ShellExecuteInput,
): Promise<ShellExecuteResult> {
  return invokeAstraFlow<ShellExecuteResult>("shell.execute", input);
}
