import type { SyncStore } from "@/app/store/sync";

export type MeelSyncConfig = SyncStore["meel"];
export type MeelSyncClient = ReturnType<typeof createMeelSyncClient>;

type MeelSyncResponse =
  | {
      ok: true;
      userId: string;
      updatedAt: number | null;
      state?: unknown;
    }
  | {
      ok: false;
      error: string;
    };

const DEFAULT_MEEL_SYNC_ENDPOINT = "/api/meel-sync/state";
const DEFAULT_MEEL_SYNC_MAX_BYTES = 10 * 1024 * 1024;

function formatBytes(bytes?: number) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function getUtf8ByteLength(value: string) {
  let bytes = 0;

  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);

    if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      i += 1;
    } else {
      bytes += 3;
    }
  }

  return bytes;
}

function formatSyncError(error: string, status?: number, bytes?: number) {
  const details = [status ? `HTTP ${status}` : "", formatBytes(bytes)].filter(
    Boolean,
  );

  return details.length > 0 ? `${error} (${details.join(", ")})` : error;
}

function normalizeMeelSyncToken(token: string) {
  return token.trim();
}

function assertSafeMeelSyncToken(token: string) {
  if (!token || /[\r\n\0]/.test(token)) {
    throw new Error("invalid_sync_token");
  }

  return token;
}

async function fetchMeelSync(
  path: string,
  init: RequestInit,
  requestBytes?: number,
) {
  try {
    return await fetch(path, init);
  } catch {
    throw new Error(formatSyncError("network_error", undefined, requestBytes));
  }
}

export function normalizeMeelSyncEndpoint(endpoint: string) {
  const trimmed = endpoint.trim();

  if (!trimmed || trimmed === "/") {
    return DEFAULT_MEEL_SYNC_ENDPOINT;
  }

  if (/^[a-z][a-z\d+\-.]*:\/\//i.test(trimmed)) {
    const url = new URL(trimmed);
    if (!url.pathname || url.pathname === "/") {
      url.pathname = DEFAULT_MEEL_SYNC_ENDPOINT;
      url.search = "";
      url.hash = "";
    }
    return url.toString();
  }

  const firstSegment = trimmed.split("/")[0];
  const looksLikeHost =
    firstSegment.includes(".") ||
    firstSegment.includes(":") ||
    firstSegment === "localhost";

  if (looksLikeHost) {
    const protocol =
      firstSegment === "localhost" ||
      firstSegment.startsWith("127.") ||
      firstSegment.startsWith("0.0.0.0")
        ? "http"
        : "https";
    const url = new URL(`${protocol}://${trimmed}`);
    if (!url.pathname || url.pathname === "/") {
      url.pathname = DEFAULT_MEEL_SYNC_ENDPOINT;
      url.search = "";
      url.hash = "";
    }
    return url.toString();
  }

  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

async function readMeelSyncResponse(res: Response, requestBytes?: number) {
  let data: MeelSyncResponse;

  try {
    data = (await res.json()) as MeelSyncResponse;
  } catch {
    throw new Error(
      formatSyncError("invalid_sync_endpoint", res.status, requestBytes),
    );
  }

  if (!data || typeof data !== "object" || !("ok" in data)) {
    throw new Error(
      formatSyncError("invalid_sync_endpoint", res.status, requestBytes),
    );
  }

  if (!res.ok || data.ok !== true) {
    const error = data.ok ? "sync_failed" : data.error;
    throw new Error(
      formatSyncError(error || "sync_failed", res.status, requestBytes),
    );
  }

  return data;
}

export function createMeelSyncClient(store: SyncStore) {
  const config = store.meel;

  return {
    async check() {
      if (!normalizeMeelSyncToken(config.token)) {
        return false;
      }

      try {
        const res = await fetchMeelSync(this.path(), {
          method: "GET",
          headers: this.headers(),
        });
        await readMeelSyncResponse(res);
        return true;
      } catch {
        return false;
      }
    },

    async get() {
      const res = await fetchMeelSync(this.path(), {
        method: "GET",
        headers: this.headers(),
      });
      const data = await readMeelSyncResponse(res);

      if (data.state === null || data.state === undefined) {
        return "";
      }

      return JSON.stringify(data.state);
    },

    async set(_: string, value: string) {
      const state = JSON.parse(value);
      const body = JSON.stringify({ state });
      const requestBytes = getUtf8ByteLength(body);

      if (requestBytes > DEFAULT_MEEL_SYNC_MAX_BYTES) {
        throw new Error(
          formatSyncError("payload_too_large", undefined, requestBytes),
        );
      }

      const res = await fetchMeelSync(
        this.path(),
        {
          method: "PUT",
          headers: {
            ...this.headers(),
            "Content-Type": "application/json",
          },
          body,
        },
        requestBytes,
      );

      await readMeelSyncResponse(res, requestBytes);
    },

    headers() {
      const token = assertSafeMeelSyncToken(
        normalizeMeelSyncToken(config.token),
      );

      return {
        Authorization: `Bearer ${token}`,
      };
    },

    path() {
      try {
        return normalizeMeelSyncEndpoint(config.endpoint);
      } catch {
        throw new Error("invalid_sync_endpoint");
      }
    },
  };
}
