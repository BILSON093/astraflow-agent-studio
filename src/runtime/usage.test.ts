import { describe, expect, it } from "vitest";
import type { ProviderConfig, UsageEntry } from "../domain/types";
import { aggregateUsage, calculateCacheCost } from "./usage";

const provider: ProviderConfig = {
  id: "mimo",
  name: "Xiaomi MiMo",
  kind: "mimo",
  baseUrl: "https://api.mimo-v2.com/v1",
  model: "mimo-v2.5-pro",
  contextWindow: 1_048_576,
  inputPricePerMTok: 0.6,
  outputPricePerMTok: 2.4,
  cacheReadPricePerMTok: 0.3,
  tags: ["strong_reasoning"],
  enabled: true,
  status: "connected",
};

function usage(patch: Partial<UsageEntry>): UsageEntry {
  return {
    id: "usage",
    taskId: "task",
    providerId: provider.id,
    model: provider.model,
    promptTokens: 1_000,
    completionTokens: 500,
    embeddingTokens: 0,
    cachedTokens: 1_000,
    cacheCostUsd: calculateCacheCost(provider, 1_000),
    costUsd: 0.0018,
    createdAt: new Date().toISOString(),
    ...patch,
  };
}

describe("usage aggregation", () => {
  it("tracks cache cost and cache hit rate separately", () => {
    const report = aggregateUsage([usage({})], [provider]);

    expect(report.cachedTokens).toBe(1_000);
    expect(report.cacheHitRate).toBe(50);
    expect(report.weekCacheCost).toBe(0.0003);
    expect(report.weekCost).toBe(0.0021);
    expect(report.byProvider[0].cacheCost).toBe(0.0003);
    expect(report.byProvider[0].cacheHitRate).toBe(50);
  });
});
