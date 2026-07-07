import { ServiceProvider } from "../constant";
import { getModelProvider } from "./model";

const MODEL_LIST_ONLY_MARKER = "-all";

export type CustomModelDisplayItem = {
  name: string;
  displayName: string;
  providerName?: string;
};

function splitCustomModelItems(customModels: string) {
  return customModels
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function formatFetchedModelConfig(
  models: string[],
  providerName = ServiceProvider.OpenAI,
) {
  const seen = new Set<string>();
  const normalizedModels = models
    .map((model) => model.trim())
    .filter(Boolean)
    .filter((model) => {
      const dedupeKey = model.toLowerCase();
      if (seen.has(dedupeKey)) return false;
      seen.add(dedupeKey);
      return true;
    })
    .map((model) => `${model}@${providerName}`);

  return [MODEL_LIST_ONLY_MARKER, ...normalizedModels].join(",");
}

export function hasModelListOnlyRule(customModels: string) {
  return splitCustomModelItems(customModels).some((item) => {
    const normalized = item.startsWith("+") ? item.slice(1) : item;
    return normalized === "all" || normalized === MODEL_LIST_ONLY_MARKER;
  });
}

export function getAvailableCustomModelItems(customModels: string) {
  const items: CustomModelDisplayItem[] = [];

  for (const rawItem of splitCustomModelItems(customModels)) {
    if (rawItem.startsWith("-")) continue;

    const item = rawItem.startsWith("+") ? rawItem.slice(1) : rawItem;
    const [nameConfig, displayName] = item.split("=");
    const [name, providerName] = getModelProvider(nameConfig);

    if (!name || name === "all") continue;

    items.push({
      name,
      providerName,
      displayName: displayName || name,
    });
  }

  return items;
}

export function hasConfiguredModelList(customModels: string) {
  return (
    hasModelListOnlyRule(customModels) ||
    getAvailableCustomModelItems(customModels).length > 0
  );
}

export function matchesCustomModelItem(
  model: {
    name: string;
    provider?: {
      id?: string;
      providerName?: string;
    };
  },
  item: CustomModelDisplayItem,
) {
  if (model.name !== item.name) return false;
  if (!item.providerName) return true;

  const itemProvider = item.providerName.toLowerCase();
  return (
    model.provider?.id?.toLowerCase() === itemProvider ||
    model.provider?.providerName?.toLowerCase() === itemProvider
  );
}
