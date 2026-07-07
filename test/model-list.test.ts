/**
 * @jest-environment node
 */
import { jest } from "@jest/globals";
import { NextRequest } from "next/server";

import { POST } from "@/app/api/model-list/route";
import { buildModelListUrl, normalizeModelIds } from "@/app/utils/model-list";
import {
  appendOpenAICompatiblePath,
  buildOpenAICompatibleProxyTarget,
} from "@/app/utils/openai-compatible-url";

const originalFetch = global.fetch;

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/model-list", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("model list route helpers", () => {
  test("builds OpenAI-compatible model list URLs", () => {
    expect(buildModelListUrl("https://api.openai.com")).toBe(
      "https://api.openai.com/v1/models",
    );
    expect(buildModelListUrl("https://example.com/v1")).toBe(
      "https://example.com/v1/models",
    );
    expect(
      buildModelListUrl("https://example.com/v1/chat/completions?debug=1"),
    ).toBe("https://example.com/v1/models");
    expect(buildModelListUrl("https://example.com/v1/models")).toBe(
      "https://example.com/v1/models",
    );
    expect(() => buildModelListUrl("/api/proxy")).toThrow("relative_endpoint");
  });

  test("avoids duplicating v1 when building chat URLs", () => {
    expect(
      appendOpenAICompatiblePath(
        "https://example.com/v1",
        "v1/chat/completions",
      ),
    ).toBe("https://example.com/v1/chat/completions");
    expect(
      appendOpenAICompatiblePath(
        "https://example.com/openai/v1/",
        "v1/chat/completions",
      ),
    ).toBe("https://example.com/openai/v1/chat/completions");
    expect(
      appendOpenAICompatiblePath(
        "https://example.com/v1/chat/completions",
        "v1/chat/completions",
      ),
    ).toBe("https://example.com/v1/chat/completions");
  });

  test("splits custom OpenAI endpoints for the same-origin proxy", () => {
    expect(
      buildOpenAICompatibleProxyTarget(
        "https://example.com/v1",
        "v1/chat/completions",
      ),
    ).toEqual({
      baseUrl: "https://example.com",
      path: "v1/chat/completions",
      query: "",
    });
    expect(
      buildOpenAICompatibleProxyTarget(
        "https://example.com/openai/v1",
        "v1/chat/completions?stream=1",
      ),
    ).toEqual({
      baseUrl: "https://example.com/openai",
      path: "v1/chat/completions",
      query: "stream=1",
    });
  });

  test("normalizes common model-list response shapes", () => {
    expect(
      normalizeModelIds({
        data: [
          { id: "gpt-4o-mini" },
          { name: "gpt-4o" },
          "deepseek-chat",
          { model: "gpt-4o-mini" },
          { id: "" },
        ],
      }),
    ).toEqual(["deepseek-chat", "gpt-4o", "gpt-4o-mini"]);

    expect(normalizeModelIds({ models: [{ id: "claude" }] })).toEqual([
      "claude",
    ]);
  });
});

describe("model list route", () => {
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test("fetches models through the server without exposing API keys in URLs", async () => {
    const calls: Array<[string | URL | Request, RequestInit | undefined]> = [];
    global.fetch = jest.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        calls.push([url, init]);
        return new Response(
          JSON.stringify({
            data: [{ id: "gpt-4o" }, { id: "gpt-4o-mini" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    ) as typeof fetch;

    const res = await POST(
      makeRequest({
        baseUrl: "https://example.com/v1",
        apiKey: "test-api-key",
      }),
    );
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload).toMatchObject({
      models: ["gpt-4o", "gpt-4o-mini"],
      url: "https://example.com/v1/models",
    });
    expect(calls[0][0].toString()).toBe("https://example.com/v1/models");
    expect(calls[0][1]?.headers).toMatchObject({
      Authorization: "Bearer test-api-key",
    });
  });

  test("returns a clear error when the upstream model endpoint fails", async () => {
    global.fetch = jest.fn(async () => {
      return new Response("unauthorized", { status: 401 });
    }) as typeof fetch;

    const res = await POST(
      makeRequest({
        baseUrl: "https://example.com/v1",
        apiKey: "wrong-api-key",
      }),
    );

    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({
      error: "unauthorized",
      status: 401,
    });
  });

  test("rejects missing URL or API key before making upstream requests", async () => {
    global.fetch = jest.fn() as typeof fetch;

    expect(
      await (
        await POST(makeRequest({ baseUrl: "", apiKey: "test-api-key" }))
      ).json(),
    ).toMatchObject({ error: "Missing endpoint URL" });
    expect(
      await (
        await POST(makeRequest({ baseUrl: "https://example.com", apiKey: "" }))
      ).json(),
    ).toMatchObject({ error: "Missing API key" });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
