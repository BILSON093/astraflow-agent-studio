import type { ProviderConfig } from "../domain/types";
import { invokeAstraFlow, isTauriRuntime } from "../desktop/commands";
import {
  buildProviderPingRequest,
  parseProviderUsage,
  providerNeedsApiKey,
} from "./providerAdapters";
import { calculateCost } from "./usage";

export type ProviderTestResult = {
  ok: boolean;
  message: string;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  maskedKey?: string;
};

export type ProviderSaveResult = {
  ok: boolean;
  message: string;
  maskedKey: string;
  storedInKeychain: boolean;
};

export type ProviderDeleteSecretResult = {
  ok: boolean;
  message: string;
  maskedKey: string;
};

type JsonRecord = Record<string, unknown>;

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const json = (await response.json()) as JsonRecord;
    const error = json.error as JsonRecord | string | undefined;

    if (typeof error === "string") {
      return error;
    }

    if (error && typeof error.message === "string") {
      return error.message;
    }

    return JSON.stringify(json).slice(0, 240);
  } catch {
    return response.statusText;
  }
}

function maskKey(apiKey?: string, fallback?: string): string {
  if (!apiKey) {
    return fallback ?? "未配置";
  }

  if (apiKey.length <= 8) {
    return "***";
  }

  return `${apiKey.slice(0, 3)}...${apiKey.slice(-4)}`;
}

export async function saveProviderCredential(
  provider: ProviderConfig,
  apiKey?: string,
): Promise<ProviderSaveResult> {
  if (isTauriRuntime()) {
    return invokeAstraFlow<ProviderSaveResult>("provider.save", { provider, apiKey });
  }

  return {
    ok: true,
    message: apiKey
      ? "网页预览模式仅保留脱敏标记；真实桌面版会写入系统钥匙串。"
      : "未提供新的 API Key。",
    maskedKey: maskKey(apiKey, provider.maskedKey),
    storedInKeychain: false,
  };
}

export async function deleteProviderCredential(
  provider: ProviderConfig,
): Promise<ProviderDeleteSecretResult> {
  if (isTauriRuntime()) {
    return invokeAstraFlow<ProviderDeleteSecretResult>("provider.deleteSecret", {
      providerId: provider.id,
    });
  }

  return {
    ok: true,
    message: "网页预览模式已清除脱敏标记。",
    maskedKey: provider.kind === "ollama" ? "本地无需密钥" : "未配置",
  };
}

export async function testProviderConnection(
  provider: ProviderConfig,
  apiKey?: string,
): Promise<ProviderTestResult> {
  if (isTauriRuntime()) {
    return invokeAstraFlow<ProviderTestResult>("provider.test", { provider, apiKey });
  }

  const startedAt = performance.now();
  const needsKey = providerNeedsApiKey(provider);

  if (needsKey && !apiKey) {
    return {
      ok: false,
      message: "需要填写 API Key 才能进行真实连通测试。",
      latencyMs: 0,
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
    };
  }

  try {
    const request = buildProviderPingRequest(provider, apiKey);
    const response = await fetch(request.url, request.init);

    const latencyMs = Math.round(performance.now() - startedAt);

    if (!response.ok) {
      return {
        ok: false,
        message: await readErrorMessage(response),
        latencyMs,
        promptTokens: 0,
        completionTokens: 0,
        costUsd: 0,
      };
    }

    const json = (await response.json()) as JsonRecord;
    const usage = parseProviderUsage(provider, json);

    return {
      ok: true,
      message: `连接成功，延迟 ${latencyMs}ms。`,
      latencyMs,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      costUsd: calculateCost(provider, usage.promptTokens, usage.completionTokens),
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? `连接失败：${error.message}`
          : "连接失败：未知错误",
      latencyMs: Math.round(performance.now() - startedAt),
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
    };
  }
}
