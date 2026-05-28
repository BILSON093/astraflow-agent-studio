import type { Permission, RiskLevel } from "../domain/types";

export function highestRisk(permissions: Permission[]): RiskLevel {
  if (permissions.some((permission) => permission.riskLevel === "high")) {
    return "high";
  }

  if (permissions.some((permission) => permission.riskLevel === "medium")) {
    return "medium";
  }

  return "low";
}

export function shouldRequireApproval(permissions: Permission[]): boolean {
  return permissions.some((permission) =>
    ["execute", "admin"].includes(permission.level),
  );
}

export function isPathTraversal(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  return normalized.split("/").some((segment) => segment === "..");
}

export function redactSecrets(value: string): string {
  return value
    .replace(/sk-[a-zA-Z0-9_-]{8,}/g, "sk-...redacted")
    .replace(/(api[_-]?key|token|secret)=([^&\s]+)/giu, "$1=...redacted");
}
