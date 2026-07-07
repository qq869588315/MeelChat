"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";

import Locale from "../locales";
import { useAppConfig, useChatStore } from "../store";
import { useMaskStore } from "../store/mask";
import { usePromptStore } from "../store/prompt";
import { useSyncStore } from "../store/sync";
import { ProviderType } from "../utils/cloud";
import { onMeelSyncEvent } from "../utils/meel-sync/events";

import styles from "./chat.module.scss";

const AUTO_PUSH_DELAY_MS = 3000;
const AUTO_PULL_INTERVAL_MS = 60 * 1000;

function isMeelAutoSyncReady() {
  const syncStore = useSyncStore.getState();
  return (
    syncStore.provider === ProviderType.Meel &&
    syncStore.meel.autoSync &&
    syncStore.cloudSync()
  );
}

export function MeelSyncController() {
  const syncHydrated = useSyncStore((state) => state._hasHydrated);
  const chatHydrated = useChatStore((state) => state._hasHydrated);
  const configHydrated = useAppConfig((state) => state._hasHydrated);
  const maskHydrated = useMaskStore((state) => state._hasHydrated);
  const promptHydrated = usePromptStore((state) => state._hasHydrated);
  const initialPullDoneRef = useRef(false);
  const pushTimerRef = useRef<number>();

  const allHydrated =
    syncHydrated &&
    chatHydrated &&
    configHydrated &&
    maskHydrated &&
    promptHydrated;

  const pushNow = useCallback(() => {
    window.clearTimeout(pushTimerRef.current);

    if (!isMeelAutoSyncReady()) {
      return;
    }

    useSyncStore
      .getState()
      .pushMeelState()
      .catch(() => undefined);
  }, []);

  const schedulePush = useCallback(() => {
    const syncStore = useSyncStore.getState();
    syncStore.markMeelDirty();

    window.clearTimeout(pushTimerRef.current);

    if (!isMeelAutoSyncReady()) {
      return;
    }

    pushTimerRef.current = window.setTimeout(pushNow, AUTO_PUSH_DELAY_MS);
  }, [pushNow]);

  useEffect(() => {
    return onMeelSyncEvent((event) => {
      if (event.type === "push") {
        pushNow();
        return;
      }

      schedulePush();
    });
  }, [pushNow, schedulePush]);

  useEffect(() => {
    if (!allHydrated || initialPullDoneRef.current) {
      return;
    }

    initialPullDoneRef.current = true;
    const syncStore = useSyncStore.getState();

    if (syncStore.provider !== ProviderType.Meel) {
      return;
    }

    if (!syncStore.cloudSync()) {
      syncStore.setSyncStatus("unconfigured");
      return;
    }

    if (!syncStore.meel.autoSync) {
      syncStore.setSyncStatus("idle");
      return;
    }

    syncStore.pullMeelState().catch(() => undefined);
  }, [allHydrated]);

  useEffect(() => {
    const maybePull = () => {
      if (document.visibilityState !== "visible" || !isMeelAutoSyncReady()) {
        return;
      }

      const syncStore = useSyncStore.getState();
      const lastPullTime = syncStore.lastPullTime || syncStore.lastSyncTime;

      if (Date.now() - lastPullTime > AUTO_PULL_INTERVAL_MS) {
        syncStore.pullMeelState().catch(() => undefined);
      }
    };

    const handleOffline = () => {
      const syncStore = useSyncStore.getState();
      if (syncStore.provider === ProviderType.Meel) {
        syncStore.setSyncStatus("offline");
      }
    };

    const handleOnline = () => {
      const syncStore = useSyncStore.getState();
      if (!isMeelAutoSyncReady()) {
        return;
      }

      const action = syncStore.dirty
        ? syncStore.pushMeelState()
        : syncStore.pullMeelState();
      action.catch(() => undefined);
    };

    const pushBeforeHidden = () => {
      const syncStore = useSyncStore.getState();
      if (document.visibilityState === "hidden" && syncStore.dirty) {
        syncStore.pushMeelState().catch(() => undefined);
      }
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("pagehide", pushNow);
    window.addEventListener("beforeunload", pushNow);
    document.addEventListener("visibilitychange", maybePull);
    document.addEventListener("visibilitychange", pushBeforeHidden);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("pagehide", pushNow);
      window.removeEventListener("beforeunload", pushNow);
      document.removeEventListener("visibilitychange", maybePull);
      document.removeEventListener("visibilitychange", pushBeforeHidden);
    };
  }, [pushNow]);

  useEffect(() => {
    let lastUpdateTime = useAppConfig.getState().lastUpdateTime;

    return useAppConfig.subscribe((state) => {
      if (!state._hasHydrated) return;
      if (state.lastUpdateTime === lastUpdateTime) return;

      lastUpdateTime = state.lastUpdateTime;
      schedulePush();
    });
  }, [schedulePush]);

  useEffect(() => {
    return () => window.clearTimeout(pushTimerRef.current);
  }, []);

  return null;
}

function formatSyncTime(time: number) {
  return new Date(time).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatSyncError(error: string) {
  return error
    ? `${Locale.Chat.SyncStatus.Error}: ${error}`
    : Locale.Chat.SyncStatus.Error;
}

export function MeelSyncStatusBar() {
  const syncStore = useSyncStore();

  const label = useMemo(() => {
    if (syncStore.provider !== ProviderType.Meel) {
      return "";
    }

    if (!syncStore.cloudSync()) {
      return Locale.Chat.SyncStatus.Unconfigured;
    }

    switch (syncStore.syncStatus) {
      case "pulling":
        return Locale.Chat.SyncStatus.Pulling;
      case "pushing":
        return Locale.Chat.SyncStatus.Pushing;
      case "dirty":
        return Locale.Chat.SyncStatus.Dirty;
      case "error":
        return formatSyncError(syncStore.syncError);
      case "offline":
        return Locale.Chat.SyncStatus.Offline;
      case "synced":
        return syncStore.lastSyncTime
          ? Locale.Chat.SyncStatus.Synced(
              formatSyncTime(syncStore.lastSyncTime),
            )
          : Locale.Chat.SyncStatus.Idle;
      default:
        return Locale.Chat.SyncStatus.Idle;
    }
  }, [syncStore]);

  if (!label) {
    return null;
  }

  const canRetry = ["dirty", "error", "offline"].includes(syncStore.syncStatus);

  return (
    <button
      type="button"
      className={styles["meel-sync-status"]}
      data-status={syncStore.syncStatus}
      disabled={!canRetry}
      title={syncStore.syncError || label}
      onClick={() => {
        if (!canRetry) return;
        syncStore.retryMeelSync().catch(() => undefined);
      }}
    >
      {label}
    </button>
  );
}
