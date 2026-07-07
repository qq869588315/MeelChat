import { NextRequest, NextResponse } from "next/server";

import {
  findMeelSyncUserByToken,
  getMeelSyncConfig,
  hasMeelSyncSensitiveText,
  parseBearerToken,
  readMeelSyncFile,
  resolveMeelSyncStatePath,
  sanitizeMeelSyncState,
  writeMeelSyncFile,
} from "@/app/utils/meel-sync/server";

export const runtime = "nodejs";

type MeelSyncError =
  | "unauthorized"
  | "payload_too_large"
  | "invalid_payload"
  | "sync_failed";

function jsonError(error: MeelSyncError, status: number) {
  return NextResponse.json({ ok: false, error }, { status });
}

function jsonOk(payload: Record<string, unknown>) {
  return NextResponse.json({ ok: true, ...payload });
}

function authenticate(req: NextRequest) {
  let config;

  try {
    config = getMeelSyncConfig();
  } catch {
    return null;
  }

  if (!config.enabled || config.users.length === 0) {
    return null;
  }

  const token = parseBearerToken(req.headers.get("authorization"));
  if (!token) {
    return null;
  }

  const user = findMeelSyncUserByToken(token, config.users);
  if (!user) {
    return null;
  }

  return { config, user };
}

export async function GET(req: NextRequest) {
  const auth = authenticate(req);

  if (!auth) {
    return jsonError("unauthorized", 401);
  }

  try {
    const filePath = resolveMeelSyncStatePath(
      auth.config.syncDir,
      auth.user.userId,
    );

    try {
      const remote = await readMeelSyncFile(filePath);
      return jsonOk({
        userId: auth.user.userId,
        updatedAt: remote.updatedAt,
        state: remote.state,
      });
    } catch (error: any) {
      if (error?.code === "ENOENT") {
        return jsonOk({
          userId: auth.user.userId,
          updatedAt: null,
          state: null,
        });
      }
      throw error;
    }
  } catch {
    return jsonError("sync_failed", 500);
  }
}

export async function PUT(req: NextRequest) {
  const auth = authenticate(req);

  if (!auth) {
    return jsonError("unauthorized", 401);
  }

  const contentLength = Number.parseInt(
    req.headers.get("content-length") ?? "",
    10,
  );

  if (Number.isFinite(contentLength) && contentLength > auth.config.maxBytes) {
    return jsonError("payload_too_large", 413);
  }

  let rawBody: string;
  let state: ReturnType<typeof sanitizeMeelSyncState>;

  try {
    rawBody = await req.text();
    if (Buffer.byteLength(rawBody, "utf8") > auth.config.maxBytes) {
      return jsonError("payload_too_large", 413);
    }

    const body = JSON.parse(rawBody) as { state?: unknown };
    if (!body || typeof body !== "object" || !("state" in body)) {
      return jsonError("invalid_payload", 400);
    }

    state = sanitizeMeelSyncState(body.state);
  } catch {
    return jsonError("invalid_payload", 400);
  }

  try {
    if (hasMeelSyncSensitiveText(state)) {
      return jsonError("invalid_payload", 400);
    }

    const updatedAt = Date.now();
    const payload = { updatedAt, state };
    const serialized = JSON.stringify(payload);

    if (Buffer.byteLength(serialized, "utf8") > auth.config.maxBytes) {
      return jsonError("payload_too_large", 413);
    }

    const filePath = resolveMeelSyncStatePath(
      auth.config.syncDir,
      auth.user.userId,
    );

    await writeMeelSyncFile(filePath, payload);

    return jsonOk({
      userId: auth.user.userId,
      updatedAt,
    });
  } catch {
    return jsonError("sync_failed", 500);
  }
}

export function OPTIONS() {
  return NextResponse.json({ body: "OK" }, { status: 200 });
}
