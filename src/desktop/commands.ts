import { invoke } from "@tauri-apps/api/core";

export type AstraFlowCommand =
  | "runtime.status"
  | "task.create"
  | "task.approvePlan"
  | "task.pause"
  | "task.resume"
  | "task.cancel"
  | "task.checkpoint"
  | "task.restore"
  | "task.list"
  | "provider.test"
  | "provider.save"
  | "provider.deleteSecret"
  | "memory.search"
  | "memory.update"
  | "memory.delete"
  | "mcp.install"
  | "mcp.enable"
  | "mcp.status"
  | "mcp.listTools"
  | "mcp.callTool"
  | "sidecar.status"
  | "sidecar.restart"
  | "runtime.logAppend"
  | "runtime.logsList"
  | "permission.auditAppend"
  | "agent.jobUpsert"
  | "agent.stepUpsert"
  | "agent.jobsList"
  | "shell.execute"
  | "skill.install"
  | "skill.enable"
  | "usage.report"
  | "usage.list";

const nativeCommandMap: Record<AstraFlowCommand, string> = {
  "runtime.status": "runtime_status",
  "task.create": "task_create",
  "task.approvePlan": "task_approve_plan",
  "task.pause": "task_pause",
  "task.resume": "task_resume",
  "task.cancel": "task_cancel",
  "task.checkpoint": "task_checkpoint",
  "task.restore": "task_restore",
  "task.list": "task_list",
  "provider.test": "provider_test",
  "provider.save": "provider_save",
  "provider.deleteSecret": "provider_delete_secret",
  "memory.search": "memory_search",
  "memory.update": "memory_update",
  "memory.delete": "memory_delete",
  "mcp.install": "mcp_install",
  "mcp.enable": "mcp_enable",
  "mcp.status": "mcp_status",
  "mcp.listTools": "mcp_list_tools",
  "mcp.callTool": "mcp_call_tool",
  "sidecar.status": "sidecar_status",
  "sidecar.restart": "sidecar_restart",
  "runtime.logAppend": "runtime_log_append",
  "runtime.logsList": "runtime_logs_list",
  "permission.auditAppend": "permission_audit_append",
  "agent.jobUpsert": "agent_job_upsert",
  "agent.stepUpsert": "agent_step_upsert",
  "agent.jobsList": "agent_jobs_list",
  "shell.execute": "shell_execute",
  "skill.install": "skill_install",
  "skill.enable": "skill_enable",
  "usage.report": "usage_report",
  "usage.list": "usage_list",
};

type TauriWindow = Window & { __TAURI_INTERNALS__?: unknown };

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in (window as TauriWindow);
}

export async function invokeAstraFlow<T>(
  command: AstraFlowCommand,
  payload?: unknown,
): Promise<T> {
  if (!isTauriRuntime()) {
    throw new Error(`Command ${command} requires Tauri runtime`);
  }

  return invoke<T>(nativeCommandMap[command], { payload });
}

export const astraFlowCommands = Object.keys(nativeCommandMap) as AstraFlowCommand[];
