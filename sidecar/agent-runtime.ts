import { createInterface } from "node:readline";
import { v4 as uuidv4 } from "uuid";
import type { AgentTask, MemoryKind, MemoryRecord, ModelPolicy } from "../src/domain/types";
import { builtInSkills, seedMemories } from "../src/runtime/catalog";
import { compileContext } from "../src/runtime/contextEngine";
import { createExecutionPlan, inferRiskLevel } from "../src/runtime/planner";
import { deleteMemory, searchMemory, upsertMemory } from "./lance-memory";

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
    executionMode: "plan",
    status: "planned",
    riskLevel: inferRiskLevel(input),
    createdAt: now(),
    updatedAt: now(),
  };
}

function createMemoryFromPayload(payload: Record<string, unknown> = {}): MemoryRecord {
  const createdAt = String(payload.createdAt ?? now());
  const id = String(payload.id ?? uuidv4());

  return {
    id,
    kind: String(payload.kind ?? "project") as MemoryKind,
    content: String(payload.content ?? ""),
    source: String(payload.source ?? "sidecar"),
    confidence: Number(payload.confidence ?? 0.8),
    enabled: Boolean(payload.enabled ?? true),
    createdAt,
    updatedAt: String(payload.updatedAt ?? createdAt),
    embeddingId: String(payload.embeddingId ?? `lance-${id}`),
  };
}

async function handleRequest(request: RuntimeRequest): Promise<unknown> {
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

  if (request.command === "memory.upsert") {
    const memory = createMemoryFromPayload(request.payload);
    await upsertMemory(memory);
    return { ok: true, memory };
  }

  if (request.command === "memory.search") {
    const query = String(request.payload?.query ?? "");
    const kind = request.payload?.kind ? String(request.payload.kind) as MemoryKind : undefined;
    const limit = Number(request.payload?.limit ?? 8);
    return { ok: true, memories: await searchMemory(query, kind, limit) };
  }

  if (request.command === "memory.delete") {
    await deleteMemory(String(request.payload?.id ?? ""));
    return { ok: true };
  }

  return { ok: false, error: `Unknown command: ${request.command}` };
}

const reader = createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

let requestQueue = Promise.resolve();

reader.on("line", (line) => {
  requestQueue = requestQueue.then(async () => {
  try {
    const request = JSON.parse(line) as RuntimeRequest;
    const result = await handleRequest(request);
    process.stdout.write(`${JSON.stringify({ ok: true, result })}\n`);
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "Unknown error" })}\n`,
    );
  }
  });
});
