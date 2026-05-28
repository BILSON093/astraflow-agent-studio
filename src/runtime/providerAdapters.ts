import type { ProviderConfig, ProviderKind } from "../domain/types";

export type ProviderProtocol =
  | "openai_chat_completions"
  | "anthropic_messages"
  | "gemini_generate_content";

export type ProviderAuthMode = "bearer" | "api-key" | "x-api-key" | "x-goog-api-key" | "none";

export type ProviderUsage = {
  promptTokens: number;
  completionTokens: number;
};

export type ProviderRequest = {
  protocol: ProviderProtocol;
  authMode: ProviderAuthMode;
  url: string;
  init: RequestInit;
};

type JsonRecord = Record<string, unknown>;

type ProviderAdapter = {
  authMode: ProviderAuthMode;
  description: string;
  protocol: ProviderProtocol;
  buildPingRequest: (provider: ProviderConfig, apiKey?: string) => ProviderRequest;
  parseUsage: (json: JsonRecord) => ProviderUsage;
};

const openAICompatibleKinds = new Set<ProviderKind>([
  "openai-compatible",
  "mimo",
  "deepseek",
  "qwen",
  "kimi",
  "zhipu",
  "ollama",
]);

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function getNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function jsonBody(body: unknown): string {
  return JSON.stringify(body);
}

const openAIAdapter: ProviderAdapter = {
  protocol: "openai_chat_completions",
  authMode: "bearer",
  description: "OpenAI-compatible /v1/chat/completions",
  buildPingRequest: (provider, apiKey) => ({
    protocol: "openai_chat_completions",
    authMode: provider.kind === "ollama" ? "none" : provider.kind === "mimo" ? "api-key" : "bearer",
    url: joinUrl(provider.baseUrl, "/chat/completions"),
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiKey && provider.kind === "mimo" ? { "api-key": apiKey } : {}),
        ...(apiKey && provider.kind !== "mimo" ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: jsonBody({
        model: provider.model,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 16,
        temperature: 0,
      }),
    },
  }),
  parseUsage: (json) => {
    const usage = (json.usage ?? {}) as JsonRecord;

    return {
      promptTokens: getNumber(usage.prompt_tokens),
      completionTokens: getNumber(usage.completion_tokens),
    };
  },
};

const anthropicAdapter: ProviderAdapter = {
  protocol: "anthropic_messages",
  authMode: "x-api-key",
  description: "Anthropic native /v1/messages",
  buildPingRequest: (provider, apiKey) => ({
    protocol: "anthropic_messages",
    authMode: "x-api-key",
    url: joinUrl(provider.baseUrl, "/v1/messages"),
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey ?? "",
        "anthropic-version": "2023-06-01",
      },
      body: jsonBody({
        model: provider.model,
        max_tokens: 16,
        messages: [{ role: "user", content: "ping" }],
      }),
    },
  }),
  parseUsage: (json) => {
    const usage = (json.usage ?? {}) as JsonRecord;

    return {
      promptTokens: getNumber(usage.input_tokens),
      completionTokens: getNumber(usage.output_tokens),
    };
  },
};

const geminiAdapter: ProviderAdapter = {
  protocol: "gemini_generate_content",
  authMode: "x-goog-api-key",
  description: "Gemini native generateContent",
  buildPingRequest: (provider, apiKey) => ({
    protocol: "gemini_generate_content",
    authMode: "x-goog-api-key",
    url: joinUrl(provider.baseUrl, `/models/${provider.model}:generateContent`),
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey ?? "",
      },
      body: jsonBody({
        contents: [{ parts: [{ text: "ping" }] }],
      }),
    },
  }),
  parseUsage: (json) => {
    const usage = (json.usageMetadata ?? {}) as JsonRecord;

    return {
      promptTokens: getNumber(usage.promptTokenCount),
      completionTokens: getNumber(usage.candidatesTokenCount),
    };
  },
};

export function getProviderAdapter(provider: ProviderConfig): ProviderAdapter {
  if (provider.kind === "anthropic") {
    return anthropicAdapter;
  }

  if (provider.kind === "gemini") {
    return geminiAdapter;
  }

  if (openAICompatibleKinds.has(provider.kind)) {
    return openAIAdapter;
  }

  return openAIAdapter;
}

export function getProviderProtocolLabel(provider: ProviderConfig): string {
  return getProviderAdapter(provider).description;
}

export function buildProviderPingRequest(
  provider: ProviderConfig,
  apiKey?: string,
): ProviderRequest {
  return getProviderAdapter(provider).buildPingRequest(provider, apiKey);
}

export function parseProviderUsage(provider: ProviderConfig, json: JsonRecord): ProviderUsage {
  return getProviderAdapter(provider).parseUsage(json);
}

export function providerNeedsApiKey(provider: ProviderConfig): boolean {
  return getProviderAdapter(provider).authMode !== "none" && provider.kind !== "ollama";
}
