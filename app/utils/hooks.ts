import { useMemo } from "react";
import { useAccessStore, useAppConfig } from "../store";
import { collectModelsWithDefaultModel } from "./model";
import {
  getAvailableCustomModelItems,
  hasConfiguredModelList,
  hasModelListOnlyRule,
  matchesCustomModelItem,
} from "./model-list-config";

export function useAllModels() {
  const accessStore = useAccessStore();
  const configStore = useAppConfig();
  const models = useMemo(() => {
    return collectModelsWithDefaultModel(
      configStore.models,
      [configStore.customModels, accessStore.customModels].join(","),
      accessStore.defaultModel,
    );
  }, [
    accessStore.customModels,
    accessStore.defaultModel,
    configStore.customModels,
    configStore.models,
  ]);

  return models;
}

export function useSelectableModels() {
  const accessStore = useAccessStore();
  const configStore = useAppConfig();
  const allModels = useAllModels();
  const customModelConfig = [
    configStore.customModels,
    accessStore.customModels,
  ].join(",");

  const models = useMemo(() => {
    if (!hasConfiguredModelList(customModelConfig)) {
      return [];
    }

    const availableModels = allModels.filter((model) => model.available);
    if (hasModelListOnlyRule(customModelConfig)) {
      return availableModels;
    }

    const customItems = getAvailableCustomModelItems(customModelConfig);
    return availableModels.filter((model) =>
      customItems.some((item) => matchesCustomModelItem(model, item)),
    );
  }, [allModels, customModelConfig]);

  return models;
}
