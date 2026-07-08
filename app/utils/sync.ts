import {
  ChatSession,
  normalizeChatSession,
  normalizeChatStoreState,
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

function normalizeSyncableStoreState<T extends SyncableStoreKey>(
  key: T,
  value: SyncableAppState[T],
) {
  if (key === StoreKey.Chat) {
    return normalizeChatStoreState(
      value as Partial<AppState[StoreKey.Chat]>,
    ) as SyncableAppState[T];
  }

  return value;
}

function getSessionUpdateTime(session: Partial<ChatSession>) {
  return typeof session.lastUpdate === "number" ? session.lastUpdate : 0;
}

function isEmptyChatSession(session: Partial<ChatSession> | undefined) {
  return !session || !Array.isArray(session.messages)
    ? true
    : session.messages.length === 0;
}

function sortChatSessions(sessions: ChatSession[]) {
  sessions.sort((a, b) => getSessionUpdateTime(b) - getSessionUpdateTime(a));
}

function mergeChatState(
  localState: AppState[StoreKey.Chat],
  remoteState: AppState[StoreKey.Chat],
) {
  localState.sessions = Array.isArray(localState.sessions)
    ? localState.sessions.map((session) => normalizeChatSession(session))
    : [];
  localState.currentSessionIndex =
    localState.sessions.length > 0 &&
    typeof localState.currentSessionIndex === "number"
      ? Math.min(
          localState.sessions.length - 1,
          Math.max(0, localState.currentSessionIndex),
        )
      : 0;

  const remoteSessions = Array.isArray(remoteState.sessions)
    ? remoteState.sessions.map((session) => normalizeChatSession(session))
    : [];

  if (remoteSessions.length === 0) {
    return localState;
  }

  const currentSession = localState.sessions[localState.currentSessionIndex];
  const currentSessionId = currentSession?.id;
  const localOnlyHasPlaceholder =
    localState.sessions.length === 1 && isEmptyChatSession(currentSession);

  if (localOnlyHasPlaceholder) {
    localState.sessions = remoteSessions.map((session) => ({ ...session }));
    sortChatSessions(localState.sessions);
    localState.currentSessionIndex = 0;
    return localState;
  }

  const localSessions = new Map<string, ChatSession>();
  localState.sessions.forEach((session) =>
    localSessions.set(session.id, session),
  );

  remoteSessions.forEach((remoteSession) => {
    const localSession = localSessions.get(remoteSession.id);

    if (!localSession) {
      localState.sessions.push(remoteSession);
      localSessions.set(remoteSession.id, remoteSession);
      return;
    }

    if (
      getSessionUpdateTime(remoteSession) > getSessionUpdateTime(localSession)
    ) {
      Object.assign(localSession, remoteSession);
    }
  });

  sortChatSessions(localState.sessions);

  const nextCurrentSessionIndex = localState.sessions.findIndex(
    (session) => session.id === currentSessionId,
  );
  localState.currentSessionIndex =
    nextCurrentSessionIndex >= 0
      ? nextCurrentSessionIndex
      : Math.min(
          localState.sessions.length - 1,
          localState.currentSessionIndex,
        );

  return localState;
}

// we merge remote state to local state
const MergeStates: StateMerger = {
  [StoreKey.Chat]: mergeChatState,
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
    const storeKey = key as SyncableStoreKey;
    const setter = LocalStateSetters[storeKey];
    if (!setter || value === undefined) return;
    setter(normalizeSyncableStoreState(storeKey, value as never) as never);
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
