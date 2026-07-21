type JsonRecord = Record<string, unknown>;

export type OpenAICompatibleStreamChunk = {
  content: string;
  isThinking: boolean;
  error?: string;
};

function asRecord(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function readText(value: unknown): string {
  if (typeof value === "string") return value;

  if (Array.isArray(value)) {
    return value.map(readText).join("");
  }

  const record = asRecord(value);
  if (!record) return "";

  return (
    readText(record.text) ||
    readText(record.value) ||
    readText(record.content) ||
    readText(record.output_text)
  );
}

function readError(value: unknown): string {
  if (typeof value === "string") return value;

  const record = asRecord(value);
  if (!record) return "Upstream service returned an unknown error";

  const message = readText(record.message) || readText(record.error);
  const code = readText(record.code) || readText(record.type);

  if (message && code && !message.includes(code)) {
    return `${message} (${code})`;
  }

  if (message) return message;

  try {
    return JSON.stringify(record);
  } catch {
    return "Upstream service returned an unknown error";
  }
}

export function parseOpenAICompatibleStreamPayload(
  payload: unknown,
): OpenAICompatibleStreamChunk {
  const root = asRecord(payload);
  if (!root) return { isThinking: false, content: "" };

  const wrappedData = asRecord(root.data);
  const body = wrappedData && !Array.isArray(root.choices) ? wrappedData : root;
  const eventType = readText(body.type);
  const upstreamError = body.error ?? body.response;

  if (
    body.error != null ||
    eventType === "error" ||
    eventType === "response.failed"
  ) {
    const responseError = asRecord(body.response)?.error;
    return {
      isThinking: false,
      content: "",
      error: readError(body.error ?? responseError ?? upstreamError),
    };
  }

  if (
    eventType === "response.output_text.delta" ||
    eventType === "response.refusal.delta"
  ) {
    return { isThinking: false, content: readText(body.delta) };
  }

  if (
    eventType === "response.reasoning_text.delta" ||
    eventType === "response.reasoning_summary_text.delta"
  ) {
    return { isThinking: true, content: readText(body.delta) };
  }

  const choices = Array.isArray(body.choices) ? body.choices : [];
  const choice = asRecord(choices[0]);
  const delta = asRecord(choice?.delta) ?? asRecord(choice?.message) ?? choice;

  const reasoning =
    readText(delta?.reasoning_content) ||
    readText(delta?.reasoning) ||
    readText(delta?.reasoning_text) ||
    readText(asRecord(choice?.message)?.reasoning_content);

  if (reasoning) {
    return { isThinking: true, content: reasoning };
  }

  const content =
    readText(delta?.content) ||
    readText(delta?.text) ||
    readText(delta?.output_text) ||
    readText(delta?.refusal) ||
    readText(asRecord(choice?.message)?.content) ||
    readText(choice?.text) ||
    readText(body.output_text) ||
    readText(asRecord(body.delta)?.text);

  return { isThinking: false, content };
}

export function shouldUseOfficialOpenAIRequestShape(
  useCustomConfig: boolean,
  rawBaseUrl: string,
) {
  if (!useCustomConfig) return true;

  try {
    return (
      new URL(rawBaseUrl.trim()).hostname.toLowerCase() === "api.openai.com"
    );
  } catch {
    return false;
  }
}
