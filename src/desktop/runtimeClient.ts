import type { McpServerManifest, MemoryRecord } from "../domain/types";
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
  runningMcp: number;
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

export async function executeRestrictedShell(
  input: ShellExecuteInput,
): Promise<ShellExecuteResult> {
  return invokeAstraFlow<ShellExecuteResult>("shell.execute", input);
}
