import { open } from "@tauri-apps/plugin-dialog";
import { isTauriRuntime } from "./commands";

export async function selectWorkspaceDirectory(): Promise<string | undefined> {
  if (!isTauriRuntime()) {
    return undefined;
  }

  const selected = await open({
    directory: true,
    multiple: false,
    title: "选择 AstraFlow 工作区",
  });

  return typeof selected === "string" ? selected : undefined;
}
