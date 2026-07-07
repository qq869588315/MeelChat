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

async function readMeelSyncResponse(res: Response) {
  let data: MeelSyncResponse;

  try {
    data = (await res.json()) as MeelSyncResponse;
  } catch {
    throw new Error("invalid_sync_endpoint");
  }

  if (!data || typeof data !== "object" || !("ok" in data)) {
    throw new Error("invalid_sync_endpoint");
  }

  if (!res.ok || data.ok !== true) {
    const error = data.ok ? "sync_failed" : data.error;
    throw new Error(error || "sync_failed");
  }

  return data;
}

export function createMeelSyncClient(store: SyncStore) {
  const config = store.meel;

  return {
    async check() {
      if (!config.token.trim()) {
        return false;
      }

      try {
        const res = await fetch(this.path(), {
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
      const res = await fetch(this.path(), {
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
      const res = await fetch(this.path(), {
        method: "PUT",
        headers: {
          ...this.headers(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ state }),
      });

      await readMeelSyncResponse(res);
    },

    headers() {
      return {
        Authorization: `Bearer ${config.token}`,
      };
    },

    path() {
      return normalizeMeelSyncEndpoint(config.endpoint);
    },
  };
}
