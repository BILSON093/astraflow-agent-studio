import type { ProviderConfig } from "../domain/types";
import { calculateCost } from "./usage";

export type ProviderTestResult = {
  ok: boolean;
  message: string;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
};

type JsonRecord = Record<string, unknown>;

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function getNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function parseOpenAIUsage(json: JsonRecord) {
  const usage = (json.usage ?? {}) as JsonRecord;

  return {
    promptTokens: getNumber(usage.prompt_tokens),
    completionTokens: getNumber(usage.completion_tokens),
  };
}

function parseAnthropicUsage(json: JsonRecord) {
  const usage = (json.usage ?? {}) as JsonRecord;

  return {
    promptTokens: getNumber(usage.input_tokens),
    completionTokens: getNumber(usage.output_tokens),
  };
}

function parseGeminiUsage(json: JsonRecord) {
  const usage = (json.usageMetadata ?? {}) as JsonRecord;

  return {
    promptTokens: getNumber(usage.promptTokenCount),
    completionTokens: getNumber(usage.candidatesTokenCount),
  };
}

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

export async function testProviderConnection(
  provider: ProviderConfig,
  apiKey?: string,
): Promise<ProviderTestResult> {
  const startedAt = performance.now();
  const needsKey = provider.kind !== "ollama";

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
    let response: Response;
    let usage = { promptTokens: 0, completionTokens: 0 };

    if (provider.kind === "anthropic") {
      response = await fetch(joinUrl(provider.baseUrl, "/v1/messages"), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey ?? "",
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: provider.model,
          max_tokens: 16,
          messages: [{ role: "user", content: "ping" }],
        }),
      });
    } else if (provider.kind === "gemini") {
      const url = new URL(joinUrl(provider.baseUrl, `/models/${provider.model}:generateContent`));
      url.searchParams.set("key", apiKey ?? "");
      response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "ping" }] }],
        }),
      });
    } else {
      response = await fetch(joinUrl(provider.baseUrl, "/chat/completions"), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: provider.model,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 16,
          temperature: 0,
        }),
      });
    }

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

    if (provider.kind === "anthropic") {
      usage = parseAnthropicUsage(json);
    } else if (provider.kind === "gemini") {
      usage = parseGeminiUsage(json);
    } else {
      usage = parseOpenAIUsage(json);
    }

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
