import { describe, expect, it } from "vitest";
import { permissions } from "./catalog";
import { validateMcpServerManifest, validateSkillManifest } from "./manifests";

describe("manifest validators", () => {
  it("accepts a valid skill manifest", () => {
    const manifest = validateSkillManifest({
      name: "demo-skill",
      version: "0.1.0",
      description: "Demo skill",
      entry: "SKILL.md",
      permissions: [permissions["fs.read"]],
    });

    expect(manifest.name).toBe("demo-skill");
  });

  it("requires stdio MCP command", () => {
    expect(() =>
      validateMcpServerManifest({
        name: "broken-mcp",
        transport: "stdio",
        permissions: [permissions["fs.read"]],
      }),
    ).toThrow();
  });

  it("accepts http MCP url", () => {
    const manifest = validateMcpServerManifest({
      name: "http-mcp",
      transport: "http",
      url: "http://localhost:7777/mcp",
      permissions: [permissions["network.http"]],
    });

    expect(manifest.transport).toBe("http");
  });
});
