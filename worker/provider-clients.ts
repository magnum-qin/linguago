import {
  FULL_TRANSLATION_TIMEOUT_MS,
  PREVIEW_TIMEOUT_MS
} from "./config";
import { TranslateError } from "./errors";
import { parseProviderJson } from "./provider-json";
import { FULL_RESPONSE_SCHEMA, PREVIEW_RESPONSE_SCHEMA } from "./schemas";
import type { Provider } from "./types";
import {
  ACTIVE_SYSTEM_PROMPT,
  GEMINI_SYSTEM_PROMPT,
  isPreviewPrompt
} from "./prompts";

export interface ProviderRequest {
  prompt: string;
  model: string;
  apiKey: string;
  systemPrompt?: string;
}

export async function streamProviderJson(
  provider: Exclude<Provider, "auto">,
  input: ProviderRequest,
  onAccumulated: (accumulated: string) => void
): Promise<string> {
  if (provider === "gemini") {
    return streamGeminiJson(input, onAccumulated);
  }

  if (provider === "dashscope") {
    return streamOpenAiCompatibleJson(
      "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
      "dashscope",
      input,
      { type: "json_object" },
      onAccumulated
    );
  }

  if (provider === "deepseek") {
    return streamOpenAiCompatibleJson(
      "https://api.deepseek.com/chat/completions",
      "deepseek",
      input,
      { type: "json_object" },
      onAccumulated
    );
  }

  let response = await fetchOpenRouterStream(input, openRouterSchemaResponseFormat(input.systemPrompt));
  if (!response.ok && (await shouldRetryOpenRouterJsonObject(response.clone()))) {
    response = await fetchOpenRouterStream(input, { type: "json_object" });
  }
  if (!response.ok) {
    throw new TranslateError(
      "PROVIDER_API_ERROR",
      `OpenRouter streaming API error: ${response.status} ${await response.text()}`,
      502,
      "openrouter",
      input.model
    );
  }

  return readSseText(
    response,
    (_delta, accumulated) => onAccumulated(accumulated),
    extractOpenAiCompatibleDelta
  );
}

export async function translateWithDashScope(input: ProviderRequest): Promise<Record<string, unknown>> {
  const provider = "dashscope";
  const response = await fetch(
    "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "authorization": `Bearer ${input.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: input.model,
        messages: [
          { role: "system", content: input.systemPrompt || ACTIVE_SYSTEM_PROMPT },
          { role: "user", content: input.prompt }
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
        max_tokens: isPreviewPrompt(input.systemPrompt) ? 512 : 4096,
        enable_thinking: false
      }),
      signal: AbortSignal.timeout(modelRequestTimeout(input.systemPrompt))
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new TranslateError(
      "PROVIDER_API_ERROR",
      `DashScope API error: ${response.status} ${errorText}`,
      502,
      provider,
      input.model
    );
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const rawText = payload.choices?.[0]?.message?.content?.trim() ?? "";

  if (!rawText) {
    throw new TranslateError(
      "PROVIDER_EMPTY_RESPONSE",
      "DashScope returned empty content.",
      502,
      provider,
      input.model
    );
  }

  return parseProviderJson(rawText, provider, input.model, isPreviewPrompt(input.systemPrompt));
}

export async function translateWithOpenRouter(input: ProviderRequest): Promise<Record<string, unknown>> {
  const provider = "openrouter";
  let response = await fetchOpenRouter(input, openRouterSchemaResponseFormat(input.systemPrompt));

  if (!response.ok && (await shouldRetryOpenRouterJsonObject(response.clone()))) {
    response = await fetchOpenRouter(input, { type: "json_object" });
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new TranslateError(
      "PROVIDER_API_ERROR",
      `OpenRouter API error: ${response.status} ${errorText}`,
      502,
      provider,
      input.model
    );
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const rawText = payload.choices?.[0]?.message?.content?.trim() ?? "";

  if (!rawText) {
    throw new TranslateError(
      "PROVIDER_EMPTY_RESPONSE",
      "OpenRouter returned empty content.",
      502,
      provider,
      input.model
    );
  }

  return parseProviderJson(rawText, provider, input.model, isPreviewPrompt(input.systemPrompt));
}

export async function translateWithDeepSeek(input: ProviderRequest): Promise<Record<string, unknown>> {
  const provider = "deepseek";
  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "authorization": `Bearer ${input.apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: input.model,
      messages: [
        { role: "system", content: input.systemPrompt || ACTIVE_SYSTEM_PROMPT },
        { role: "user", content: input.prompt }
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
      max_tokens: isPreviewPrompt(input.systemPrompt) ? 512 : 4096,
      thinking: { type: "disabled" }
    }),
    signal: AbortSignal.timeout(modelRequestTimeout(input.systemPrompt))
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new TranslateError(
      "PROVIDER_API_ERROR",
      `DeepSeek API error: ${response.status} ${errorText}`,
      502,
      provider,
      input.model
    );
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const rawText = payload.choices?.[0]?.message?.content?.trim() ?? "";

  if (!rawText) {
    throw new TranslateError(
      "PROVIDER_EMPTY_RESPONSE",
      "DeepSeek returned empty content.",
      502,
      provider,
      input.model
    );
  }

  return parseProviderJson(rawText, provider, input.model, isPreviewPrompt(input.systemPrompt));
}

export async function translateWithGemini(input: ProviderRequest): Promise<Record<string, unknown>> {
  const provider = "gemini";
  let response = await fetchGemini(input, geminiStructuredConfig(input.systemPrompt));

  if (!response.ok && (await shouldRetryGeminiLegacySchema(response.clone()))) {
    response = await fetchGemini(input, geminiLegacyStructuredConfig(input.systemPrompt));
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new TranslateError(
      "PROVIDER_API_ERROR",
      `Gemini API error: ${response.status} ${errorText}`,
      502,
      provider,
      input.model
    );
  }

  const payload = (await response.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>;
      };
    }>;
  };
  const rawText =
    payload.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";

  if (!rawText) {
    throw new TranslateError(
      "PROVIDER_EMPTY_RESPONSE",
      "Gemini returned empty content.",
      502,
      provider,
      input.model
    );
  }

  return parseProviderJson(rawText, provider, input.model, isPreviewPrompt(input.systemPrompt));
}

async function readSseText(
  response: Response,
  onDelta: (delta: string, accumulated: string) => void,
  extractText: (payload: Record<string, any>) => string
): Promise<string> {
  if (!response.body) {
    throw new TranslateError("PROVIDER_EMPTY_RESPONSE", "Provider returned no stream body.", 502);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let accumulated = "";

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split(/\r?\n/u);
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") continue;

      try {
        const payload = JSON.parse(data) as Record<string, any>;
        const delta = extractText(payload);
        if (!delta) continue;
        accumulated += delta;
        onDelta(delta, accumulated);
      } catch {
        // Ignore malformed keep-alive chunks and continue reading the stream.
      }
    }

    if (done) break;
  }

  const trailing = buffer.trim();
  if (trailing.startsWith("data:")) {
    const data = trailing.slice(5).trim();
    if (data && data !== "[DONE]") {
      try {
        const payload = JSON.parse(data) as Record<string, any>;
        const delta = extractText(payload);
        if (delta) {
          accumulated += delta;
          onDelta(delta, accumulated);
        }
      } catch {
        // Ignore malformed trailing chunks.
      }
    }
  }

  if (!accumulated.trim()) {
    throw new TranslateError("PROVIDER_EMPTY_RESPONSE", "Provider returned an empty streaming preview.", 502);
  }

  return accumulated;
}

async function streamOpenAiCompatibleJson(
  url: string,
  provider: Exclude<Provider, "auto">,
  input: ProviderRequest,
  responseFormat: Record<string, unknown>,
  onAccumulated: (accumulated: string) => void
): Promise<string> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${input.apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: input.model,
      messages: [
        { role: "system", content: input.systemPrompt || ACTIVE_SYSTEM_PROMPT },
        { role: "user", content: input.prompt }
      ],
      response_format: responseFormat,
      temperature: 0.2,
      max_tokens: 4096,
      stream: true,
      ...(provider === "dashscope" ? { enable_thinking: false } : {}),
      ...(provider === "deepseek" ? { thinking: { type: "disabled" } } : {})
    }),
    signal: AbortSignal.timeout(FULL_TRANSLATION_TIMEOUT_MS)
  });

  if (!response.ok) {
    throw new TranslateError(
      "PROVIDER_API_ERROR",
      `${provider} streaming API error: ${response.status} ${await response.text()}`,
      502,
      provider,
      input.model
    );
  }

  return readSseText(
    response,
    (_delta, accumulated) => onAccumulated(accumulated),
    extractOpenAiCompatibleDelta
  );
}

function fetchOpenRouterStream(
  input: ProviderRequest,
  responseFormat: Record<string, unknown>
): Promise<Response> {
  return fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "authorization": `Bearer ${input.apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: input.model,
      messages: [
        { role: "system", content: input.systemPrompt || ACTIVE_SYSTEM_PROMPT },
        { role: "user", content: input.prompt }
      ],
      response_format: responseFormat,
      provider: {
        require_parameters: responseFormat.type === "json_schema"
      },
      temperature: 0.2,
      max_tokens: 4096,
      stream: true
    }),
    signal: AbortSignal.timeout(FULL_TRANSLATION_TIMEOUT_MS)
  });
}

async function streamGeminiJson(
  input: ProviderRequest,
  onAccumulated: (accumulated: string) => void
): Promise<string> {
  let response = await fetchGeminiStream(input, geminiStructuredConfig(input.systemPrompt));

  if (!response.ok && (await shouldRetryGeminiLegacySchema(response.clone()))) {
    response = await fetchGeminiStream(input, geminiLegacyStructuredConfig(input.systemPrompt));
  }

  if (!response.ok) {
    throw new TranslateError(
      "PROVIDER_API_ERROR",
      `Gemini streaming API error: ${response.status} ${await response.text()}`,
      502,
      "gemini",
      input.model
    );
  }

  return readSseText(
    response,
    (_delta, accumulated) => onAccumulated(accumulated),
    (payload) => normalizeStringOrText(payload.candidates?.[0]?.content?.parts?.[0]?.text)
  );
}

function fetchGeminiStream(
  input: ProviderRequest,
  generationConfig: Record<string, unknown>
): Promise<Response> {
  return fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(input.apiKey)}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: input.systemPrompt || GEMINI_SYSTEM_PROMPT }]
        },
        contents: [
          {
            role: "user",
            parts: [{ text: input.prompt }]
          }
        ],
        generationConfig
      }),
      signal: AbortSignal.timeout(FULL_TRANSLATION_TIMEOUT_MS)
    }
  );
}

function extractOpenAiCompatibleDelta(payload: Record<string, any>): string {
  const choice = payload.choices?.[0];
  return normalizeStringOrText(choice?.delta?.content) || normalizeStringOrText(choice?.message?.content);
}

function fetchOpenRouter(
  input: ProviderRequest,
  responseFormat: Record<string, unknown>
): Promise<Response> {
  return fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "authorization": `Bearer ${input.apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: input.model,
      messages: [
        { role: "system", content: input.systemPrompt || ACTIVE_SYSTEM_PROMPT },
        { role: "user", content: input.prompt }
      ],
      response_format: responseFormat,
      provider: {
        require_parameters: responseFormat.type === "json_schema"
      },
      temperature: 0.2,
      max_tokens: isPreviewPrompt(input.systemPrompt) ? 512 : 4096
    }),
    signal: AbortSignal.timeout(modelRequestTimeout(input.systemPrompt))
  });
}

function openRouterSchemaResponseFormat(systemPrompt?: string): Record<string, unknown> {
  return {
    type: "json_schema",
    json_schema: {
      name: isPreviewPrompt(systemPrompt)
        ? "linguago_translation_preview"
        : "linguago_translation",
      strict: true,
      schema: withAdditionalPropertiesFalse(
        isPreviewPrompt(systemPrompt) ? PREVIEW_RESPONSE_SCHEMA : FULL_RESPONSE_SCHEMA
      )
    }
  };
}

async function shouldRetryOpenRouterJsonObject(response: Response): Promise<boolean> {
  if (![400, 404, 422].includes(response.status)) return false;
  const text = await response.text();
  return /response_format|json_schema|schema|require_parameters|not support|unsupported|provider/i.test(text);
}

function fetchGemini(
  input: ProviderRequest,
  generationConfig: Record<string, unknown>
): Promise<Response> {
  return fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}:generateContent?key=${encodeURIComponent(input.apiKey)}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: input.systemPrompt || GEMINI_SYSTEM_PROMPT }]
        },
        contents: [
          {
            role: "user",
            parts: [{ text: input.prompt }]
          }
        ],
        generationConfig
      }),
      signal: AbortSignal.timeout(modelRequestTimeout(input.systemPrompt))
    }
  );
}

function geminiStructuredConfig(systemPrompt?: string): Record<string, unknown> {
  return {
    temperature: 0.2,
    responseFormat: {
      text: {
        mimeType: "APPLICATION_JSON",
        schema: isPreviewPrompt(systemPrompt)
          ? PREVIEW_RESPONSE_SCHEMA
          : FULL_RESPONSE_SCHEMA
      }
    }
  };
}

function geminiLegacyStructuredConfig(systemPrompt?: string): Record<string, unknown> {
  return {
    temperature: 0.2,
    responseMimeType: "application/json",
    responseSchema: isPreviewPrompt(systemPrompt)
      ? PREVIEW_RESPONSE_SCHEMA
      : FULL_RESPONSE_SCHEMA
  };
}

async function shouldRetryGeminiLegacySchema(response: Response): Promise<boolean> {
  if (response.status !== 400) return false;
  const text = await response.text();
  return /response_format|responseFormat|mime_type|response_schema|responseSchema/i.test(text);
}

function modelRequestTimeout(systemPrompt?: string): number {
  return isPreviewPrompt(systemPrompt)
    ? PREVIEW_TIMEOUT_MS
    : FULL_TRANSLATION_TIMEOUT_MS;
}

function withAdditionalPropertiesFalse(schema: unknown): unknown {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return schema;
  }

  const source = schema as Record<string, unknown>;
  const next: Record<string, unknown> = { ...source };
  if (next.type === "object") {
    next.additionalProperties = false;
  }
  if (source.properties && typeof source.properties === "object" && !Array.isArray(source.properties)) {
    next.properties = Object.fromEntries(
      Object.entries(source.properties as Record<string, unknown>).map(([key, value]) => [
        key,
        withAdditionalPropertiesFalse(value)
      ])
    );
  }
  if (source.items) {
    next.items = withAdditionalPropertiesFalse(source.items);
  }
  return next;
}

function normalizeStringOrText(value: unknown): string {
  if (value == null) {
    return "";
  }
  if (typeof value === "object") {
    const item = value as Record<string, unknown>;
    return String(item.text ?? item.translation ?? "");
  }
  return String(value);
}
