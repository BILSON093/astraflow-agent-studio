import { describe, expect, it } from "vitest";
import type { AgentTask } from "../domain/types";
import { builtInSkills, seedMemories } from "./catalog";
import { compileContext } from "./contextEngine";

const task: AgentTask = {
  id: "task-context",
  title: "context",
  input: "分析当前任务并生成计划",
  status: "planned",
  riskLevel: "low",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("context engine", () => {
  it("keeps the current task at the highest priority", () => {
    const report = compileContext({
      task,
      memories: seedMemories,
      skills: builtInSkills,
      maxTokens: 10_000,
    });

    expect(report.included[0].id).toBe("ctx-task");
    expect(report.totalTokens).toBeGreaterThan(0);
  });

  it("drops low priority sections when token budget is tight", () => {
    const report = compileContext({
      task,
      memories: seedMemories,
      skills: builtInSkills,
      selectedArtifacts: ["x".repeat(20_000)],
      maxTokens: 512,
    });

    expect(report.included.some((section) => section.id === "ctx-task")).toBe(true);
    expect(report.dropped.length).toBeGreaterThan(0);
  });
});
