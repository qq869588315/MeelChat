import {
  parseOpenAICompatibleStreamPayload,
  shouldUseOfficialOpenAIRequestShape,
} from "../app/utils/openai-compatible-response";

describe("OpenAI-compatible stream responses", () => {
  test("parses standard chat completion text", () => {
    expect(
      parseOpenAICompatibleStreamPayload({
        choices: [{ delta: { content: "hello" } }],
      }),
    ).toEqual({ isThinking: false, content: "hello" });
  });

  test("parses alternate reasoning fields", () => {
    expect(
      parseOpenAICompatibleStreamPayload({
        choices: [{ delta: { reasoning: "thinking" } }],
      }),
    ).toEqual({ isThinking: true, content: "thinking" });
  });

  test("parses array-based content", () => {
    expect(
      parseOpenAICompatibleStreamPayload({
        choices: [
          {
            delta: {
              content: [
                { type: "text", text: "hello " },
                { type: "text", text: "world" },
              ],
            },
          },
        ],
      }),
    ).toEqual({ isThinking: false, content: "hello world" });
  });

  test("parses Responses API output events", () => {
    expect(
      parseOpenAICompatibleStreamPayload({
        type: "response.output_text.delta",
        delta: "hello",
      }),
    ).toEqual({ isThinking: false, content: "hello" });
  });

  test("returns upstream SSE errors instead of an empty chunk", () => {
    expect(
      parseOpenAICompatibleStreamPayload({
        error: { message: "model unavailable", code: "model_error" },
      }),
    ).toEqual({
      isThinking: false,
      content: "",
      error: "model unavailable (model_error)",
    });
  });

  test("does not treat a null error field as a failure", () => {
    expect(
      parseOpenAICompatibleStreamPayload({
        error: null,
        choices: [{ delta: { content: "ok" } }],
      }),
    ).toEqual({ isThinking: false, content: "ok" });
  });
});

describe("OpenAI-compatible request shape", () => {
  test("keeps official parameters for the built-in endpoint", () => {
    expect(shouldUseOfficialOpenAIRequestShape(false, "")).toBe(true);
  });

  test("keeps official parameters for api.openai.com", () => {
    expect(
      shouldUseOfficialOpenAIRequestShape(true, "https://api.openai.com/v1"),
    ).toBe(true);
  });

  test("uses a minimal request for third-party compatible endpoints", () => {
    expect(
      shouldUseOfficialOpenAIRequestShape(
        true,
        "https://example.com/openai/v1",
      ),
    ).toBe(false);
  });
});
