import { DEFAULT_MODELS, EDITABLE_PROVIDERS, MODEL_OPTIONS, MODEL_OPTIONS_VERSION } from "./config";
import { normalizeProvider, normalizeText } from "./normalization";
import type { Env, Provider } from "./types";

type JsonResponse = (data: unknown, status?: number) => Response;

export function handleModels(json: JsonResponse): Response {
  return json({
    version: MODEL_OPTIONS_VERSION,
    providers: ["auto", ...EDITABLE_PROVIDERS],
    editableProviders: EDITABLE_PROVIDERS,
    defaults: DEFAULT_MODELS,
    options: MODEL_OPTIONS
  });
}

export async function handleSettings(request: Request, env: Env, json: JsonResponse): Promise<Response> {
  if (request.method === "GET") {
    return json(await getStoredSettings(env));
  }

  if (request.method !== "POST") {
    return json({ error: "method not allowed" }, 405);
  }

  const body = (await request.json()) as { provider?: string; model?: string };
  const provider = normalizeProvider(body.provider);
  const model = normalizeText(body.model || "") || DEFAULT_MODELS[provider] || DEFAULT_MODELS.auto;
  const settings = {
    provider,
    model,
    updated_at: new Date().toISOString()
  };

  await env.CACHE.put("global:model-settings", JSON.stringify(settings));
  return json(settings);
}

export async function getStoredSettings(env: Env): Promise<{ provider: Provider; model: string; updated_at?: string }> {
  const stored = await env.CACHE.get<{ provider?: Provider; model?: string; updated_at?: string }>(
    "global:model-settings",
    "json"
  );
  const provider = normalizeProvider(stored?.provider);
  return {
    provider,
    model: normalizeText(stored?.model || "") || DEFAULT_MODELS[provider] || DEFAULT_MODELS.auto,
    updated_at: stored?.updated_at
  };
}

export async function getStoredModel(env: Env, provider: Provider): Promise<string> {
  const settings = await getStoredSettings(env);
  return settings.model || DEFAULT_MODELS[provider] || DEFAULT_MODELS.auto;
}

