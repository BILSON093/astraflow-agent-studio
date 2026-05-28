import type { AgentTask, ContextReport, ContextSection, MemoryRecord, SkillManifest } from "../domain/types";
import { estimateTokens } from "./planner";

type CompileContextInput = {
  task: AgentTask;
  memories: MemoryRecord[];
  skills: SkillManifest[];
  historySummary?: string;
  selectedArtifacts?: string[];
  maxTokens: number;
};

function buildSection(
  id: string,
  title: string,
  source: string,
  priority: number,
  content: string,
): ContextSection {
  return {
    id,
    title,
    source,
    priority,
    content,
    tokens: estimateTokens(content),
  };
}

export function compileContext(input: CompileContextInput): ContextReport {
  const taskSection = buildSection(
    "ctx-task",
    "当前任务",
    "user-input",
    100,
    input.task.input,
  );

  const artifactSections =
    input.selectedArtifacts?.map((artifact, index) =>
      buildSection(
        `ctx-artifact-${index}`,
        `选中资料 ${index + 1}`,
        "selected-artifact",
        88 - index,
        artifact,
      ),
    ) ?? [];

  const memorySections = input.memories
    .filter((memory) => memory.enabled)
    .map((memory) =>
      buildSection(
        `ctx-memory-${memory.id}`,
        `${memory.kind} memory`,
        memory.source,
        Math.round(memory.confidence * 70),
        memory.content,
      ),
    );

  const skillSections = input.skills
    .filter((skill) => skill.enabled)
    .map((skill) =>
      buildSection(
        `ctx-skill-${skill.name}`,
        `Skill 指令：${skill.name}`,
        skill.entry,
        62,
        `${skill.description}\nPermissions: ${skill.permissions.map((permission) => permission.id).join(", ")}`,
      ),
    );

  const historySection = input.historySummary
    ? [
        buildSection(
          "ctx-history-summary",
          "历史摘要",
          "runtime-summary",
          38,
          input.historySummary,
        ),
      ]
    : [];

  const sorted = [
    taskSection,
    ...artifactSections,
    ...memorySections,
    ...skillSections,
    ...historySection,
  ].sort((a, b) => b.priority - a.priority);

  const included: ContextSection[] = [];
  const dropped: ContextSection[] = [];
  let totalTokens = 0;

  for (const section of sorted) {
    if (totalTokens + section.tokens <= input.maxTokens) {
      included.push(section);
      totalTokens += section.tokens;
    } else {
      dropped.push(section);
    }
  }

  return {
    taskId: input.task.id,
    maxTokens: input.maxTokens,
    included,
    dropped,
    totalTokens,
  };
}
