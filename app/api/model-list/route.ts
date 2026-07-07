import { NextRequest, NextResponse } from "next/server";

import { buildModelListUrl, normalizeModelIds } from "@/app/utils/model-list";

export const runtime = "nodejs";

const MODEL_LIST_TIMEOUT_MS = 20_000;

export async function POST(req: NextRequest) {
  let body: {
    baseUrl?: string;
    apiKey?: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 },
    );
  }

  const baseUrl = body.baseUrl?.trim() ?? "";
  const apiKey = body.apiKey?.trim() ?? "";

  if (!baseUrl) {
    return NextResponse.json(
      { error: "Missing endpoint URL" },
      { status: 400 },
    );
  }

  if (!apiKey) {
    return NextResponse.json({ error: "Missing API key" }, { status: 400 });
  }

  let modelListUrl: string;
  try {
    modelListUrl = buildModelListUrl(baseUrl);
  } catch (error) {
    const message =
      error instanceof Error && error.message === "relative_endpoint"
        ? "Please enter a full http(s):// endpoint URL"
        : "Invalid endpoint URL";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), MODEL_LIST_TIMEOUT_MS);

  try {
    const res = await fetch(modelListUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: apiKey.startsWith("Bearer ")
          ? apiKey
          : `Bearer ${apiKey}`,
      },
      cache: "no-store",
      signal: controller.signal,
    });

    if (!res.ok) {
      const detail = (await res.text()).slice(0, 500);
      return NextResponse.json(
        {
          error: detail || `${res.status} ${res.statusText}`,
          status: res.status,
        },
        { status: 502 },
      );
    }

    const payload = await res.json();
    const models = normalizeModelIds(payload);

    return NextResponse.json({ models, url: modelListUrl });
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? "Model list request timed out"
        : error instanceof Error
        ? error.message
        : "Failed to fetch model list";

    return NextResponse.json({ error: message }, { status: 502 });
  } finally {
    clearTimeout(timeoutId);
  }
}
