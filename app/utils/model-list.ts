import { buildModelListUrl } from "./openai-compatible-url";

const MAX_MODELS = 500;

export { buildModelListUrl };

export function normalizeModelIds(payload: unknown) {
  const data =
    payload &&
    typeof payload === "object" &&
    "data" in payload &&
    Array.isArray((payload as { data?: unknown }).data)
      ? (payload as { data: unknown[] }).data
      : payload &&
        typeof payload === "object" &&
        "models" in payload &&
        Array.isArray((payload as { models?: unknown }).models)
      ? (payload as { models: unknown[] }).models
      : [];

  const ids = data
    .map((item) => {
      if (typeof item === "string") return item;
      if (!item || typeof item !== "object") return "";

      const record = item as Record<string, unknown>;
      return [record.id, record.name, record.model].find(
        (value) => typeof value === "string" && value.trim().length > 0,
      ) as string | undefined;
    })
    .filter((id): id is string => !!id)
    .map((id) => id.trim());

  return Array.from(new Set(ids))
    .sort((a, b) => a.localeCompare(b))
    .slice(0, MAX_MODELS);
}
