import {
  ChatSession,
  useAccessStore,
  useAppConfig,
  useChatStore,
} from "../store";
import { useMaskStore } from "../store/mask";
import { usePromptStore } from "../store/prompt";
import { StoreKey } from "../constant";
import { merge } from "./merge";
import { sanitizeMeelSyncState } from "./meel-sync/sanitize";

type NonFunctionKeys<T> = {
  [K in keyof T]: T[K] extends (...args: any[]) => any ? never : K;
}[keyof T];
type NonFunctionFields<T> = Pick<T, NonFunctionKeys<T>>;

export function getNonFunctionFileds<T extends object>(obj: T) {
  const ret: any = {};

  Object.entries(obj).map(([k, v]) => {
    if (typeof v !== "function") {
      ret[k] = v;
    }
  });

  return ret as NonFunctionFields<T>;
}

export type GetStoreState<T> = T extends { getState: () => infer U }
  ? NonFunctionFields<U>
  : never;

const LocalStateSetters = {
  [StoreKey.Chat]: useChatStore.setState,
  [StoreKey.Access]: useAccessStore.setState,
  [StoreKey.Config]: useAppConfig.setState,
  [StoreKey.Mask]: useMaskStore.setState,
  [StoreKey.Prompt]: usePromptStore.setState,
} as const;

const LocalStateGetters = {
  [StoreKey.Chat]: () => getNonFunctionFileds(useChatStore.getState()),
  [StoreKey.Access]: () => getNonFunctionFileds(useAccessStore.getState()),
  [StoreKey.Config]: () => getNonFunctionFileds(useAppConfig.getState()),
  [StoreKey.Mask]: () => getNonFunctionFileds(useMaskStore.getState()),
  [StoreKey.Prompt]: () => getNonFunctionFileds(usePromptStore.getState()),
} as const;

export const SyncableStoreKeys = [
  StoreKey.Chat,
  StoreKey.Config,
  StoreKey.Mask,
  StoreKey.Prompt,
] as const;

export type AppState = {
  [k in keyof typeof LocalStateGetters]: ReturnType<
    (typeof LocalStateGetters)[k]
  >;
};

export type SyncableStoreKey = (typeof SyncableStoreKeys)[number];
export type SyncableAppState = Partial<Pick<AppState, SyncableStoreKey>>;

type Merger<T extends keyof AppState, U = AppState[T]> = (
  localState: U,
  remoteState: U,
) => U;

type StateMerger = {
  [K in keyof AppState]: Merger<K>;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidSyncableStoreState(key: SyncableStoreKey, value: unknown) {
  if (!isPlainObject(value)) {
    return false;
  }

  switch (key) {
    case StoreKey.Chat:
      return Array.isArray(value.sessions);
    case StoreKey.Mask:
      return isPlainObject(value.masks);
    case StoreKey.Prompt:
      return isPlainObject(value.prompts);
    case StoreKey.Config:
      return true;
  }
}

// we merge remote state to local state
const MergeStates: StateMerger = {
  [StoreKey.Chat]: (localState, remoteState) => {
    // merge sessions
    const localSessions: Record<string, ChatSession> = {};
    localState.sessions.forEach((s) => (localSessions[s.id] = s));

    remoteState.sessions.forEach((remoteSession) => {
      // skip empty chats
      if (remoteSession.messages.length === 0) return;

      const localSession = localSessions[remoteSession.id];
      if (!localSession) {
        // if remote session is new, just merge it
        localState.sessions.push(remoteSession);
      } else {
        // if both have the same session id, merge the messages
        const localMessageIds = new Set(localSession.messages.map((v) => v.id));
        remoteSession.messages.forEach((m) => {
          if (!localMessageIds.has(m.id)) {
            localSession.messages.push(m);
          }
        });

        // sort local messages with date field in asc order
        localSession.messages.sort(
          (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
        );
      }
    });

    // sort local sessions with date field in desc order
    localState.sessions.sort(
      (a, b) =>
        new Date(b.lastUpdate).getTime() - new Date(a.lastUpdate).getTime(),
    );

    return localState;
  },
  [StoreKey.Prompt]: (localState, remoteState) => {
    localState.prompts = {
      ...remoteState.prompts,
      ...localState.prompts,
    };
    return localState;
  },
  [StoreKey.Mask]: (localState, remoteState) => {
    localState.masks = {
      ...remoteState.masks,
      ...localState.masks,
    };
    return localState;
  },
  [StoreKey.Config]: mergeWithUpdate<AppState[StoreKey.Config]>,
  [StoreKey.Access]: mergeWithUpdate<AppState[StoreKey.Access]>,
};

export function getLocalAppState() {
  const appState = Object.fromEntries(
    Object.entries(LocalStateGetters).map(([key, getter]) => {
      return [key, getter()];
    }),
  ) as AppState;

  return appState;
}

export function getSyncableAppState() {
  const appState = Object.fromEntries(
    SyncableStoreKeys.map((key) => {
      return [key, LocalStateGetters[key]()];
    }),
  ) as SyncableAppState;

  return sanitizeMeelSyncState(appState) as SyncableAppState;
}

export function setLocalAppState(appState: AppState) {
  Object.entries(LocalStateSetters).forEach(([key, setter]) => {
    setter(appState[key as keyof AppState]);
  });
}

export function setSyncableAppState(appState: SyncableAppState) {
  Object.entries(appState).forEach(([key, value]) => {
    const setter = LocalStateSetters[key as SyncableStoreKey];
    if (!setter || value === undefined) return;
    setter(value as never);
  });
}

export function mergeAppState(localState: AppState, remoteState: AppState) {
  Object.keys(localState).forEach(<T extends keyof AppState>(k: string) => {
    const key = k as T;
    const localStoreState = localState[key];
    const remoteStoreState = remoteState[key];
    if (remoteStoreState === undefined) return;
    localState[key] = MergeStates[key](
      localStoreState,
      remoteStoreState,
    ) as AppState[T];
  });

  return localState;
}

export function mergeSyncableAppState(
  localState: SyncableAppState,
  remoteState: SyncableAppState,
) {
  SyncableStoreKeys.forEach(<T extends SyncableStoreKey>(key: T) => {
    const localStoreState = localState[key];
    const remoteStoreState = remoteState[key];

    if (localStoreState === undefined || remoteStoreState === undefined) {
      return;
    }

    if (!isValidSyncableStoreState(key, remoteStoreState)) {
      return;
    }

    localState[key] = MergeStates[key](
      localStoreState as never,
      remoteStoreState as never,
    ) as SyncableAppState[T];
  });

  return localState;
}

/**
 * Merge state with `lastUpdateTime`, older state will be override
 */
export function mergeWithUpdate<T extends { lastUpdateTime?: number }>(
  localState: T,
  remoteState: T,
) {
  const localUpdateTime = localState.lastUpdateTime ?? 0;
  const remoteUpdateTime = remoteState.lastUpdateTime ?? 1;

  if (localUpdateTime < remoteUpdateTime) {
    merge(localState, remoteState);
  }

  return { ...localState };
}
