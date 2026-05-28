import { createInterface } from "node:readline";
import type { AgentTask, ModelPolicy } from "../src/domain/types";
import { builtInSkills, seedMemories } from "../src/runtime/catalog";
import { compileContext } from "../src/runtime/contextEngine";
import { createExecutionPlan, inferRiskLevel } from "../src/runtime/planner";

type RuntimeRequest = {
  command: string;
  payload?: Record<string, unknown>;
};

function now(): string {
  return new Date().toISOString();
}

function createTaskFromPayload(payload: Record<string, unknown> = {}): AgentTask {
  const input = String(payload.input ?? "生成一份 AstraFlow 执行计划");

  return {
    id: String(payload.id ?? `sidecar-${Date.now()}`),
    title: input.length > 24 ? `${input.slice(0, 24)}...` : input,
    input,
    workspace: typeof payload.workspace === "string" ? payload.workspace : undefined,
    status: "planned",
    riskLevel: inferRiskLevel(input),
    createdAt: now(),
    updatedAt: now(),
  };
}

function handleRequest(request: RuntimeRequest): unknown {
  if (request.command === "task.create") {
    const task = createTaskFromPayload(request.payload);
    const policy = String(request.payload?.modelPolicy ?? "balanced") as ModelPolicy;
    const plan = createExecutionPlan(task, policy);
    const context = compileContext({
      task,
      memories: seedMemories,
      skills: builtInSkills,
      maxTokens: Math.min(plan.estimatedTokenPlan.maxTokens, 10_000),
    });

    return { task, plan, context };
  }

  if (request.command === "usage.report") {
    return { ok: true, message: "Usage report is produced by the desktop store in this build." };
  }

  return { ok: false, error: `Unknown command: ${request.command}` };
}

const reader = createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

reader.on("line", (line) => {
  try {
    const request = JSON.parse(line) as RuntimeRequest;
    const result = handleRequest(request);
    process.stdout.write(`${JSON.stringify({ ok: true, result })}\n`);
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "Unknown error" })}\n`,
    );
  }
});
