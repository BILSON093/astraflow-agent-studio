import dayjs from "dayjs";
import type { ProviderConfig, UsageEntry } from "../domain/types";

export type UsageReport = {
  todayCost: number;
  weekCost: number;
  todayTokens: number;
  weekTokens: number;
  byProvider: Array<{ providerId: string; name: string; cost: number; tokens: number }>;
  byModel: Array<{ model: string; cost: number; tokens: number }>;
  byTask: Array<{ taskId: string; cost: number; tokens: number }>;
};

function sumTokens(entry: UsageEntry): number {
  return entry.promptTokens + entry.completionTokens + entry.embeddingTokens;
}

export function calculateCost(
  provider: ProviderConfig,
  promptTokens: number,
  completionTokens: number,
  embeddingTokens = 0,
): number {
  const inputCost = (promptTokens + embeddingTokens) * (provider.inputPricePerMTok / 1_000_000);
  const outputCost = completionTokens * (provider.outputPricePerMTok / 1_000_000);
  return Number((inputCost + outputCost).toFixed(6));
}

export function aggregateUsage(entries: UsageEntry[], providers: ProviderConfig[]): UsageReport {
  const now = dayjs();
  const todayEntries = entries.filter((entry) => dayjs(entry.createdAt).isSame(now, "day"));
  const weekEntries = entries.filter((entry) => dayjs(entry.createdAt).isAfter(now.subtract(7, "day")));
  const providerMap = new Map(providers.map((provider) => [provider.id, provider.name]));

  const group = <T extends string>(
    source: UsageEntry[],
    keyGetter: (entry: UsageEntry) => T,
  ): Array<{ key: T; cost: number; tokens: number }> => {
    const map = new Map<T, { cost: number; tokens: number }>();

    for (const entry of source) {
      const key = keyGetter(entry);
      const current = map.get(key) ?? { cost: 0, tokens: 0 };
      current.cost += entry.costUsd;
      current.tokens += sumTokens(entry);
      map.set(key, current);
    }

    return Array.from(map.entries()).map(([key, value]) => ({
      key,
      cost: Number(value.cost.toFixed(4)),
      tokens: value.tokens,
    }));
  };

  return {
    todayCost: Number(todayEntries.reduce((sum, entry) => sum + entry.costUsd, 0).toFixed(4)),
    weekCost: Number(weekEntries.reduce((sum, entry) => sum + entry.costUsd, 0).toFixed(4)),
    todayTokens: todayEntries.reduce((sum, entry) => sum + sumTokens(entry), 0),
    weekTokens: weekEntries.reduce((sum, entry) => sum + sumTokens(entry), 0),
    byProvider: group(weekEntries, (entry) => entry.providerId).map((item) => ({
      providerId: item.key,
      name: providerMap.get(item.key) ?? item.key,
      cost: item.cost,
      tokens: item.tokens,
    })),
    byModel: group(weekEntries, (entry) => entry.model).map((item) => ({
      model: item.key,
      cost: item.cost,
      tokens: item.tokens,
    })),
    byTask: group(weekEntries, (entry) => entry.taskId).map((item) => ({
      taskId: item.key,
      cost: item.cost,
      tokens: item.tokens,
    })),
  };
}
