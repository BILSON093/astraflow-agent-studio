import { z } from "zod";
import type { McpServerManifest, SkillManifest } from "../domain/types";

const permissionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  level: z.enum(["read", "write", "execute", "external", "admin"]),
  riskLevel: z.enum(["low", "medium", "high"]),
  description: z.string().min(1),
});

export const skillManifestSchema = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-_.]*$/i),
  version: z.string().min(1),
  description: z.string().min(1),
  entry: z.literal("SKILL.md"),
  permissions: z.array(permissionSchema),
  scripts: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean().optional(),
  installedAt: z.string().optional(),
});

export const mcpServerManifestSchema = z
  .object({
    name: z.string().regex(/^[a-z0-9][a-z0-9-_.]*$/i),
    transport: z.enum(["stdio", "http", "sse"]),
    command: z.string().optional(),
    url: z.string().url().optional(),
    envSchema: z.record(z.string(), z.string()).optional(),
    permissions: z.array(permissionSchema),
    enabled: z.boolean().optional(),
    health: z.enum(["healthy", "degraded", "offline"]).optional(),
    installedAt: z.string().optional(),
  })
  .refine((manifest) => {
    if (manifest.transport === "stdio") {
      return Boolean(manifest.command);
    }

    return Boolean(manifest.url);
  }, "stdio MCP requires command, http/sse MCP requires url");

export function validateSkillManifest(value: unknown): SkillManifest {
  return skillManifestSchema.parse(value);
}

export function validateMcpServerManifest(value: unknown): McpServerManifest {
  return mcpServerManifestSchema.parse(value);
}
