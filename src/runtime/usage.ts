import dayjs from "dayjs";
import type { ProviderConfig, UsageEntry } from "../domain/types";

export type UsageReport = {
  todayCost: number;
  weekCost: number;
  todayCacheCost: number;
  weekCacheCost: number;
  todayTokens: number;
  weekTokens: number;
  cachedTokens: number;
  cacheHitRate: number;
  byProvider: Array<{
    providerId: string;
    name: string;
    cost: number;
    cacheCost: number;
    tokens: number;
    cachedTokens: number;
    cacheHitRate: number;
  }>;
  byModel: Array<{ model: string; cost: number; cacheCost: number; tokens: number; cachedTokens: number }>;
  byTask: Array<{ taskId: string; cost: number; cacheCost: number; tokens: number; cachedTokens: number }>;
};

function sumTokens(entry: UsageEntry): number {
  return entry.promptTokens + entry.completionTokens + entry.embeddingTokens;
}

function cacheableInputTokens(entry: UsageEntry): number {
  return entry.promptTokens + entry.cachedTokens;
}

function cacheHitRate(entries: UsageEntry[]): number {
  const cacheable = entries.reduce((sum, entry) => sum + cacheableInputTokens(entry), 0);
  const cached = entries.reduce((sum, entry) => sum + entry.cachedTokens, 0);

  return cacheable > 0 ? Math.round((cached / cacheable) * 100) : 0;
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

export function calculateCacheCost(provider: ProviderConfig, cachedTokens: number): number {
  const price = provider.cacheReadPricePerMTok ?? provider.inputPricePerMTok * 0.1;

  return Number((cachedTokens * (price / 1_000_000)).toFixed(6));
}

export function aggregateUsage(entries: UsageEntry[], providers: ProviderConfig[]): UsageReport {
  const now = dayjs();
  const todayEntries = entries.filter((entry) => dayjs(entry.createdAt).isSame(now, "day"));
  const weekEntries = entries.filter((entry) => dayjs(entry.createdAt).isAfter(now.subtract(7, "day")));
  const providerMap = new Map(providers.map((provider) => [provider.id, provider]));

  const entryCacheCost = (entry: UsageEntry): number => {
    const provider = providerMap.get(entry.providerId);

    return entry.cacheCostUsd ?? (provider ? calculateCacheCost(provider, entry.cachedTokens) : 0);
  };

  const entryTotalCost = (entry: UsageEntry): number => entry.costUsd + entryCacheCost(entry);

  const group = <T extends string>(
    source: UsageEntry[],
    keyGetter: (entry: UsageEntry) => T,
  ): Array<{
    key: T;
    cost: number;
    cacheCost: number;
    tokens: number;
    cachedTokens: number;
    cacheHitRate: number;
  }> => {
    const map = new Map<
      T,
      {
        cost: number;
        cacheCost: number;
        tokens: number;
        cachedTokens: number;
        cacheableTokens: number;
      }
    >();

    for (const entry of source) {
      const key = keyGetter(entry);
      const current = map.get(key) ?? {
        cost: 0,
        cacheCost: 0,
        tokens: 0,
        cachedTokens: 0,
        cacheableTokens: 0,
      };
      current.cost += entryTotalCost(entry);
      current.cacheCost += entryCacheCost(entry);
      current.tokens += sumTokens(entry);
      current.cachedTokens += entry.cachedTokens;
      current.cacheableTokens += cacheableInputTokens(entry);
      map.set(key, current);
    }

    return Array.from(map.entries()).map(([key, value]) => ({
      key,
      cost: Number(value.cost.toFixed(4)),
      cacheCost: Number(value.cacheCost.toFixed(4)),
      tokens: value.tokens,
      cachedTokens: value.cachedTokens,
      cacheHitRate:
        value.cacheableTokens > 0
          ? Math.round((value.cachedTokens / value.cacheableTokens) * 100)
          : 0,
    }));
  };

  return {
    todayCost: Number(todayEntries.reduce((sum, entry) => sum + entryTotalCost(entry), 0).toFixed(4)),
    weekCost: Number(weekEntries.reduce((sum, entry) => sum + entryTotalCost(entry), 0).toFixed(4)),
    todayCacheCost: Number(todayEntries.reduce((sum, entry) => sum + entryCacheCost(entry), 0).toFixed(4)),
    weekCacheCost: Number(weekEntries.reduce((sum, entry) => sum + entryCacheCost(entry), 0).toFixed(4)),
    todayTokens: todayEntries.reduce((sum, entry) => sum + sumTokens(entry), 0),
    weekTokens: weekEntries.reduce((sum, entry) => sum + sumTokens(entry), 0),
    cachedTokens: weekEntries.reduce((sum, entry) => sum + entry.cachedTokens, 0),
    cacheHitRate: cacheHitRate(weekEntries),
    byProvider: group(weekEntries, (entry) => entry.providerId).map((item) => ({
      providerId: item.key,
      name: providerMap.get(item.key)?.name ?? item.key,
      cost: item.cost,
      cacheCost: item.cacheCost,
      tokens: item.tokens,
      cachedTokens: item.cachedTokens,
      cacheHitRate: item.cacheHitRate,
    })),
    byModel: group(weekEntries, (entry) => entry.model).map((item) => ({
      model: item.key,
      cost: item.cost,
      cacheCost: item.cacheCost,
      tokens: item.tokens,
      cachedTokens: item.cachedTokens,
    })),
    byTask: group(weekEntries, (entry) => entry.taskId).map((item) => ({
      taskId: item.key,
      cost: item.cost,
      cacheCost: item.cacheCost,
      tokens: item.tokens,
      cachedTokens: item.cachedTokens,
    })),
  };
}
