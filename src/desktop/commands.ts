import { invoke } from "@tauri-apps/api/core";

export type AstraFlowCommand =
  | "task.create"
  | "task.approvePlan"
  | "task.pause"
  | "task.resume"
  | "task.cancel"
  | "provider.test"
  | "provider.save"
  | "provider.deleteSecret"
  | "memory.search"
  | "memory.update"
  | "mcp.install"
  | "mcp.enable"
  | "skill.install"
  | "skill.enable"
  | "usage.report";

const nativeCommandMap: Record<AstraFlowCommand, string> = {
  "task.create": "task_create",
  "task.approvePlan": "task_approve_plan",
  "task.pause": "task_pause",
  "task.resume": "task_resume",
  "task.cancel": "task_cancel",
  "provider.test": "provider_test",
  "provider.save": "provider_save",
  "provider.deleteSecret": "provider_delete_secret",
  "memory.search": "memory_search",
  "memory.update": "memory_update",
  "mcp.install": "mcp_install",
  "mcp.enable": "mcp_enable",
  "skill.install": "skill_install",
  "skill.enable": "skill_enable",
  "usage.report": "usage_report",
};

type TauriWindow = Window & { __TAURI_INTERNALS__?: unknown };

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in (window as TauriWindow);
}

export async function invokeAstraFlow<T>(
  command: AstraFlowCommand,
  payload?: Record<string, unknown>,
): Promise<T> {
  if (!isTauriRuntime()) {
    throw new Error(`Command ${command} requires Tauri runtime`);
  }

  return invoke<T>(nativeCommandMap[command], { payload });
}

export const astraFlowCommands = Object.keys(nativeCommandMap) as AstraFlowCommand[];
