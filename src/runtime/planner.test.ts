import { describe, expect, it } from "vitest";
import type { AgentTask } from "../domain/types";
import { createExecutionPlan, inferRiskLevel } from "./planner";

function makeTask(input: string): AgentTask {
  return {
    id: "task-test",
    title: "test",
    input,
    status: "planned",
    riskLevel: inferRiskLevel(input),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe("planner", () => {
  it("marks shell and deploy requests as high risk", () => {
    expect(inferRiskLevel("执行 shell 命令并部署到生产环境")).toBe("high");
  });

  it("does not confuse token budget planning with secret access", () => {
    expect(inferRiskLevel("生成一份 token plan 和成本预算")).toBe("low");
  });

  it("creates a coding plan for code related tasks", () => {
    const plan = createExecutionPlan(makeTask("修复这个前端 bug 并运行测试"), "code_first");

    expect(plan.codingPlan).toBeDefined();
    expect(plan.requiredPermissions.map((permission) => permission.id)).toContain("fs.write");
    expect(plan.steps.length).toBeGreaterThanOrEqual(6);
  });

  it("requires approval for high risk tool preparation", () => {
    const plan = createExecutionPlan(makeTask("运行 shell 命令并 git push"), "strong_reasoning");

    expect(plan.requiredPermissions.map((permission) => permission.id)).toContain("shell.exec");
    expect(plan.steps.some((step) => step.status === "needs_approval")).toBe(true);
  });
});
