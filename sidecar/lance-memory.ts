import * as lancedb from "@lancedb/lancedb";
import { homedir } from "node:os";
import { join } from "node:path";
import type { MemoryKind, MemoryRecord } from "../src/domain/types";

const TABLE_NAME = "agent_memories";
const VECTOR_DIMENSIONS = 96;

type MemorySearchResult = MemoryRecord & { distance: number };

function dataDirectory(): string {
  return process.env.ASTRAFLOW_DATA_DIR ?? join(homedir(), ".astraflow");
}

function escapePredicate(value: string): string {
  return value.replaceAll("'", "''");
}

export function embedText(text: string): number[] {
  const vector = Array<number>(VECTOR_DIMENSIONS).fill(0);
  const normalized = text.trim().toLowerCase();

  for (let index = 0; index < normalized.length; index += 1) {
    const codePoint = normalized.codePointAt(index) ?? 0;
    const bucket = (codePoint * 31 + index * 17) % VECTOR_DIMENSIONS;
    vector[bucket] += 1;
  }

  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => value / magnitude);
}

async function openMemoryTable() {
  const db = await lancedb.connect(join(dataDirectory(), "lancedb"));
  const tableNames = await db.tableNames();

  if (tableNames.includes(TABLE_NAME)) {
    return db.openTable(TABLE_NAME);
  }

  return db.createTable(TABLE_NAME, [
    {
      id: "__schema__",
      kind: "profile",
      content: "AstraFlow LanceDB schema seed",
      source: "runtime",
      confidence: 0,
      enabled: false,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      embeddingId: "__schema__",
      vector: embedText("schema"),
    },
  ]);
}

export async function upsertMemory(memory: MemoryRecord): Promise<void> {
  const table = await openMemoryTable();
  await table.delete(`id = '${escapePredicate(memory.id)}'`);
  await table.add([
    {
      ...memory,
      embeddingId: memory.embeddingId ?? `lance-${memory.id}`,
      vector: embedText(`${memory.kind} ${memory.source} ${memory.content}`),
    },
  ]);
}

export async function deleteMemory(id: string): Promise<void> {
  const table = await openMemoryTable();
  await table.delete(`id = '${escapePredicate(id)}'`);
}

export async function searchMemory(
  query: string,
  kind?: MemoryKind,
  limit = 8,
): Promise<MemorySearchResult[]> {
  const table = await openMemoryTable();
  const safeLimit = Math.max(1, Math.min(limit, 40));
  let search = table
    .vectorSearch(embedText(query))
    .distanceType("cosine")
    .limit(safeLimit + 1);

  if (kind) {
    search = search.where(`kind = '${escapePredicate(kind)}'`);
  }

  const rows = await search.toArray();
  return rows
    .filter((row) => row.id !== "__schema__" && row.enabled)
    .slice(0, safeLimit)
    .map((row) => ({
      id: String(row.id),
      kind: String(row.kind) as MemoryKind,
      content: String(row.content),
      source: String(row.source),
      confidence: Number(row.confidence),
      enabled: Boolean(row.enabled),
      createdAt: String(row.createdAt),
      updatedAt: String(row.updatedAt),
      embeddingId: String(row.embeddingId),
      distance: Number(row._distance ?? 0),
    }));
}
