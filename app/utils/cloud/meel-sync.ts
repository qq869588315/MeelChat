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

function normalizeEndpoint(endpoint: string) {
  return endpoint.trim() || DEFAULT_MEEL_SYNC_ENDPOINT;
}

async function readMeelSyncResponse(res: Response) {
  const data = (await res.json()) as MeelSyncResponse;

  if (!res.ok || !data.ok) {
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
        return res.ok;
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
      return normalizeEndpoint(config.endpoint);
    },
  };
}
