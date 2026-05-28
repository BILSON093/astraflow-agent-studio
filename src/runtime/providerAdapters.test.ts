import { describe, expect, it } from "vitest";
import type { ProviderConfig } from "../domain/types";
import {
  buildProviderPingRequest,
  getProviderProtocolLabel,
  parseProviderUsage,
  providerNeedsApiKey,
} from "./providerAdapters";

function provider(patch: Partial<ProviderConfig>): ProviderConfig {
  return {
    id: "test",
    name: "Test Provider",
    kind: "openai-compatible",
    baseUrl: "https://api.example.com/v1",
    model: "model-test",
    contextWindow: 128_000,
    inputPricePerMTok: 1,
    outputPricePerMTok: 5,
    tags: ["balanced"],
    enabled: true,
    status: "untested",
    ...patch,
  };
}

describe("provider adapters", () => {
  it("builds OpenAI-compatible chat completion requests", () => {
    const request = buildProviderPingRequest(provider({ kind: "deepseek" }), "sk-test");
    const body = JSON.parse(String(request.init.body));

    expect(request.protocol).toBe("openai_chat_completions");
    expect(request.url).toBe("https://api.example.com/v1/chat/completions");
    expect((request.init.headers as Record<string, string>).authorization).toBe("Bearer sk-test");
    expect(body.messages[0].content).toBe("ping");
  });

  it("builds Anthropic native Messages API requests", () => {
    const request = buildProviderPingRequest(
      provider({
        kind: "anthropic",
        baseUrl: "https://api.anthropic.com",
        model: "claude-sonnet-4-20250514",
      }),
      "sk-ant",
    );
    const headers = request.init.headers as Record<string, string>;
    const body = JSON.parse(String(request.init.body));

    expect(request.protocol).toBe("anthropic_messages");
    expect(request.url).toBe("https://api.anthropic.com/v1/messages");
    expect(headers["x-api-key"]).toBe("sk-ant");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(body.max_tokens).toBe(16);
  });

  it("builds Gemini native generateContent requests", () => {
    const request = buildProviderPingRequest(
      provider({
        kind: "gemini",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
        model: "gemini-2.5-pro",
      }),
      "gemini-key",
    );
    const headers = request.init.headers as Record<string, string>;
    const body = JSON.parse(String(request.init.body));

    expect(request.protocol).toBe("gemini_generate_content");
    expect(request.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent",
    );
    expect(headers["x-goog-api-key"]).toBe("gemini-key");
    expect(body.contents[0].parts[0].text).toBe("ping");
  });

  it("normalizes usage across provider protocols", () => {
    expect(
      parseProviderUsage(provider({ kind: "openai-compatible" }), {
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
    ).toEqual({ promptTokens: 10, completionTokens: 5 });
    expect(
      parseProviderUsage(provider({ kind: "anthropic" }), {
        usage: { input_tokens: 11, output_tokens: 6 },
      }),
    ).toEqual({ promptTokens: 11, completionTokens: 6 });
    expect(
      parseProviderUsage(provider({ kind: "gemini" }), {
        usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 7 },
      }),
    ).toEqual({ promptTokens: 12, completionTokens: 7 });
  });

  it("marks local Ollama as keyless and labels native protocols", () => {
    expect(providerNeedsApiKey(provider({ kind: "ollama" }))).toBe(false);
    expect(getProviderProtocolLabel(provider({ kind: "anthropic" }))).toContain("Anthropic");
    expect(getProviderProtocolLabel(provider({ kind: "gemini" }))).toContain("Gemini");
  });
});
