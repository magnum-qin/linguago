import { DEFAULT_MODELS } from "./config";
import { TranslateError } from "./errors";
import type { Env, Provider } from "./types";

export function selectProvider(
  env: Env,
  requestedProvider: Provider,
  requestedModel: string
): { provider: Exclude<Provider, "auto">; model: string; apiKey: string } {
  if (requestedProvider === "openrouter") {
    if (!env.OPENROUTER_API_KEY) {
      throw new TranslateError(
        "PROVIDER_CONFIG_MISSING",
        "OpenRouter API Key is not configured.",
        500,
        "openrouter",
        requestedModel || DEFAULT_MODELS.openrouter
      );
    }
    return {
      provider: "openrouter",
      model: requestedModel || DEFAULT_MODELS.openrouter,
      apiKey: env.OPENROUTER_API_KEY
    };
  }

  if (requestedProvider === "dashscope") {
    if (!env.DASHSCOPE_API_KEY) {
      throw new TranslateError(
        "PROVIDER_CONFIG_MISSING",
        "DashScope API Key is not configured.",
        500,
        "dashscope",
        requestedModel || DEFAULT_MODELS.dashscope
      );
    }
    return {
      provider: "dashscope",
      model: requestedModel || DEFAULT_MODELS.dashscope,
      apiKey: env.DASHSCOPE_API_KEY
    };
  }

  if (requestedProvider === "gemini") {
    if (!env.GEMINI_API_KEY) {
      throw new TranslateError(
        "PROVIDER_CONFIG_MISSING",
        "Gemini API Key is not configured.",
        500,
        "gemini",
        requestedModel || DEFAULT_MODELS.gemini
      );
    }
    return {
      provider: "gemini",
      model: requestedModel || DEFAULT_MODELS.gemini,
      apiKey: env.GEMINI_API_KEY
    };
  }

  if (requestedProvider === "deepseek") {
    if (!env.DEEPSEEK_API_KEY) {
      throw new TranslateError(
        "PROVIDER_CONFIG_MISSING",
        "DeepSeek API Key is not configured.",
        500,
        "deepseek",
        requestedModel || DEFAULT_MODELS.deepseek
      );
    }
    return {
      provider: "deepseek",
      model: requestedModel || DEFAULT_MODELS.deepseek,
      apiKey: env.DEEPSEEK_API_KEY
    };
  }

  if (env.DASHSCOPE_API_KEY) {
    return {
      provider: "dashscope",
      model: selectModelForProvider(requestedProvider, "dashscope", requestedModel),
      apiKey: env.DASHSCOPE_API_KEY
    };
  }

  if (env.DEEPSEEK_API_KEY) {
    return {
      provider: "deepseek",
      model: selectModelForProvider(requestedProvider, "deepseek", requestedModel),
      apiKey: env.DEEPSEEK_API_KEY
    };
  }

  if (env.GEMINI_API_KEY) {
    return {
      provider: "gemini",
      model: selectModelForProvider(requestedProvider, "gemini", requestedModel),
      apiKey: env.GEMINI_API_KEY
    };
  }

  if (env.OPENROUTER_API_KEY) {
    return {
      provider: "openrouter",
      model: selectModelForProvider(requestedProvider, "openrouter", requestedModel),
      apiKey: env.OPENROUTER_API_KEY
    };
  }

  throw new TranslateError(
    "PROVIDER_CONFIG_MISSING",
    "No translation provider API key is configured.",
    500
  );
}

function selectModelForProvider(
  requestedProvider: Provider,
  selectedProvider: Exclude<Provider, "auto">,
  requestedModel: string
): string {
  if (!requestedModel) {
    return DEFAULT_MODELS[selectedProvider];
  }

  if (requestedProvider === "auto" && requestedModel === DEFAULT_MODELS.auto) {
    return DEFAULT_MODELS[selectedProvider];
  }

  return requestedModel;
}
