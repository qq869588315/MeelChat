import {
  formatFetchedModelConfig,
  getAvailableCustomModelItems,
  hasConfiguredModelList,
  hasModelListOnlyRule,
  matchesCustomModelItem,
} from "../app/utils/model-list-config";

describe("model list config helpers", () => {
  test("formats fetched models as an allow-list for OpenAI-compatible chat", () => {
    expect(
      formatFetchedModelConfig(["gpt-5.4", "gpt-5.4", "gpt-5.5"]),
    ).toBe("-all,gpt-5.4@OpenAI,gpt-5.5@OpenAI");
  });

  test("hides internal allow-list markers from display items", () => {
    expect(
      getAvailableCustomModelItems(
        "-all,gpt-5.4@OpenAI,gpt-5.5@OpenAI=GPT 5.5,-old-model",
      ),
    ).toEqual([
      {
        name: "gpt-5.4",
        providerName: "OpenAI",
        displayName: "gpt-5.4",
      },
      {
        name: "gpt-5.5",
        providerName: "OpenAI",
        displayName: "GPT 5.5",
      },
    ]);
  });

  test("detects configured and model-list-only states", () => {
    expect(hasConfiguredModelList("")).toBe(false);
    expect(hasConfiguredModelList("-all")).toBe(true);
    expect(hasConfiguredModelList("custom-model")).toBe(true);
    expect(hasModelListOnlyRule("-all,gpt-5.4@OpenAI")).toBe(true);
  });

  test("matches models by name and optional provider", () => {
    const model = {
      name: "gpt-5.4",
      provider: { id: "openai", providerName: "OpenAI" },
    };

    expect(
      matchesCustomModelItem(model, {
        name: "gpt-5.4",
        displayName: "gpt-5.4",
      }),
    ).toBe(true);
    expect(
      matchesCustomModelItem(model, {
        name: "gpt-5.4",
        providerName: "OpenAI",
        displayName: "gpt-5.4",
      }),
    ).toBe(true);
    expect(
      matchesCustomModelItem(model, {
        name: "gpt-5.4",
        providerName: "Other",
        displayName: "gpt-5.4",
      }),
    ).toBe(false);
  });
});
