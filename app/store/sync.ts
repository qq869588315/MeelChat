import { getClientConfig } from "../config/client";
import { ApiPath, STORAGE_KEY, StoreKey } from "../constant";
import { createPersistStore } from "../utils/store";
import {
  AppState,
  SyncableAppState,
  getLocalAppState,
  getSyncableAppState,
  GetStoreState,
  mergeAppState,
  mergeSyncableAppState,
  setLocalAppState,
  setSyncableAppState,
} from "../utils/sync";
import { downloadAs, readFromFile } from "../utils";
import { showToast } from "../components/ui-lib";
import Locale from "../locales";
import { createSyncClient, ProviderType } from "../utils/cloud";

export interface WebDavConfig {
  server: string;
  username: string;
  password: string;
}

const isApp = !!getClientConfig()?.isApp;
export type SyncStore = GetStoreState<typeof useSyncStore>;
export type MeelSyncStatus =
  | "unconfigured"
  | "idle"
  | "pulling"
  | "pushing"
  | "synced"
  | "dirty"
  | "error"
  | "offline";

const DEFAULT_MEEL_SYNC_ENDPOINT = "/api/meel-sync/state";
const DEFAULT_SYNC_STATE = {
  provider: ProviderType.Meel,
  useProxy: true,
  proxyUrl: ApiPath.Cors as string,

  meel: {
    endpoint: DEFAULT_MEEL_SYNC_ENDPOINT,
    token: "",
    autoSync: true,
  },

  webdav: {
    endpoint: "",
    username: "",
    password: "",
  },

  upstash: {
    endpoint: "",
    username: STORAGE_KEY,
    apiKey: "",
  },

  lastSyncTime: 0,
  lastPullTime: 0,
  lastProvider: "",
  syncStatus: "unconfigured" as MeelSyncStatus,
  syncError: "",
  dirty: false,
};

function getSyncClientKey(provider: ProviderType, config: unknown) {
  if (
    provider !== ProviderType.Meel &&
    config &&
    typeof config === "object" &&
    "username" in config &&
    typeof config.username === "string"
  ) {
    return config.username;
  }

  return STORAGE_KEY;
}

function isBrowserOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

export const useSyncStore = createPersistStore(
  DEFAULT_SYNC_STATE,
  (set, get) => ({
    cloudSync() {
      const provider = get().provider;

      if (provider === ProviderType.Meel) {
        return (
          get().meel.endpoint.trim().length > 0 &&
          get().meel.token.trim().length > 0
        );
      }

      const config = get()[provider];
      return Object.values(config).every((c) => c.toString().length > 0);
    },

    markSyncTime() {
      set({
        lastSyncTime: Date.now(),
        lastProvider: get().provider,
        syncStatus: "synced",
        syncError: "",
      });
    },

    setSyncStatus(status: MeelSyncStatus, error = "") {
      set({ syncStatus: status, syncError: error });
    },

    markMeelDirty() {
      if (get().provider !== ProviderType.Meel) return;

      if (!this.cloudSync()) {
        set({ syncStatus: "unconfigured", dirty: false, syncError: "" });
        return;
      }

      set({ syncStatus: "dirty", dirty: true, syncError: "" });
    },

    export() {
      const state = getLocalAppState();
      const datePart = isApp
        ? `${new Date().toLocaleDateString().replace(/\//g, "_")} ${new Date()
            .toLocaleTimeString()
            .replace(/:/g, "_")}`
        : new Date().toLocaleString();

      const fileName = `Backup-${datePart}.json`;
      downloadAs(JSON.stringify(state), fileName);
    },

    async import() {
      const rawContent = await readFromFile();

      try {
        const remoteState = JSON.parse(rawContent) as AppState;
        const localState = getLocalAppState();
        mergeAppState(localState, remoteState);
        setLocalAppState(localState);
        location.reload();
      } catch (e) {
        console.error("[Import]", e);
        showToast(Locale.Settings.Sync.ImportFailed);
      }
    },

    getClient() {
      const provider = get().provider;
      const client = createSyncClient(provider, get());
      return client;
    },

    async pullMeelState() {
      if (get().provider !== ProviderType.Meel) {
        return false;
      }

      if (!this.cloudSync()) {
        set({ syncStatus: "unconfigured", syncError: "" });
        return false;
      }

      if (isBrowserOffline()) {
        set({ syncStatus: "offline", dirty: get().dirty, syncError: "" });
        return false;
      }

      set({ syncStatus: "pulling", syncError: "" });

      try {
        const client = this.getClient();
        const remoteState = await client.get(STORAGE_KEY);

        if (remoteState && remoteState !== "") {
          const parsedRemoteState = JSON.parse(remoteState) as SyncableAppState;
          const localState = getSyncableAppState();
          mergeSyncableAppState(localState, parsedRemoteState);
          setSyncableAppState(localState);
        }

        set({
          lastPullTime: Date.now(),
          dirty: false,
        });
        this.markSyncTime();
        return true;
      } catch (e: any) {
        set({
          syncStatus: "error",
          syncError: e?.message ?? "sync_failed",
        });
        throw e;
      }
    },

    async pushMeelState() {
      if (get().provider !== ProviderType.Meel) {
        return false;
      }

      if (!this.cloudSync()) {
        set({ syncStatus: "unconfigured", syncError: "" });
        return false;
      }

      if (isBrowserOffline()) {
        set({ syncStatus: "offline", dirty: true, syncError: "" });
        return false;
      }

      set({ syncStatus: "pushing", syncError: "" });

      try {
        const client = this.getClient();
        const localState = getSyncableAppState();
        await client.set(STORAGE_KEY, JSON.stringify(localState));
        set({ dirty: false });
        this.markSyncTime();
        return true;
      } catch (e: any) {
        set({
          syncStatus: "error",
          syncError: e?.message ?? "sync_failed",
          dirty: true,
        });
        throw e;
      }
    },

    async retryMeelSync() {
      if (get().dirty) {
        return await this.pushMeelState();
      }

      return await this.pullMeelState();
    },

    async sync() {
      const provider = get().provider;
      const config = get()[provider];
      const client = this.getClient();
      const key = getSyncClientKey(provider, config);

      if (provider === ProviderType.Meel) {
        await this.pullMeelState();
        await this.pushMeelState();
        return;
      }

      try {
        const remoteState = await client.get(key);
        if (!remoteState || remoteState === "") {
          await client.set(key, JSON.stringify(getSyncableAppState()));
          console.log(
            "[Sync] Remote state is empty, using local state instead.",
          );
          return;
        } else {
          const parsedRemoteState = JSON.parse(remoteState) as SyncableAppState;
          const localState = getSyncableAppState();
          mergeSyncableAppState(localState, parsedRemoteState);
          setSyncableAppState(localState);
        }
      } catch (e) {
        console.log("[Sync] failed to get remote state", e);
        throw e;
      }

      await client.set(key, JSON.stringify(getSyncableAppState()));

      this.markSyncTime();
    },

    async legacySync() {
      const localState = getLocalAppState();
      const provider = get().provider;
      const config = get()[provider];
      const client = this.getClient();
      const key = getSyncClientKey(provider, config);

      try {
        const remoteState = await client.get(key);
        if (!remoteState || remoteState === "") {
          await client.set(key, JSON.stringify(localState));
          return;
        } else {
          const parsedRemoteState = JSON.parse(remoteState) as AppState;
          mergeAppState(localState, parsedRemoteState);
          setLocalAppState(localState);
        }
      } catch (e) {
        console.log("[Sync] failed to get remote state", e);
        throw e;
      }

      await client.set(key, JSON.stringify(localState));

      this.markSyncTime();
    },

    async check() {
      const client = this.getClient();
      return await client.check();
    },
  }),
  {
    name: StoreKey.Sync,
    version: 1.3,

    migrate(persistedState, version) {
      const newState = persistedState as typeof DEFAULT_SYNC_STATE;

      if (!newState.meel) {
        newState.meel = {
          endpoint: DEFAULT_MEEL_SYNC_ENDPOINT,
          token: "",
          autoSync: true,
        };
      }

      if (!newState.syncStatus) {
        newState.syncStatus = newState.meel.token ? "idle" : "unconfigured";
      }

      if (version < 1.1) {
        newState.upstash.username = STORAGE_KEY;
      }

      if (version < 1.2) {
        if (
          (persistedState as typeof DEFAULT_SYNC_STATE).proxyUrl ===
          "/api/cors/"
        ) {
          newState.proxyUrl = "";
        }
      }

      return newState as any;
    },
  },
);
