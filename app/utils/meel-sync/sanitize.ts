export const MEEL_SYNC_ALLOWED_STORE_KEYS = [
  "chat-next-web-store",
  "app-config",
  "mask-store",
  "prompt-store",
] as const;

export type MeelSyncAllowedStoreKey =
  (typeof MEEL_SYNC_ALLOWED_STORE_KEYS)[number];

export type MeelSyncState = Partial<Record<MeelSyncAllowedStoreKey, unknown>>;

export const MEEL_SYNC_STORED_KEY_MAP = {
  "chat-next-web-store": "chat",
  "app-config": "config",
  "mask-store": "mask",
  "prompt-store": "prompt",
} as const satisfies Record<MeelSyncAllowedStoreKey, string>;

const MEEL_SYNC_LOCAL_KEY_MAP = Object.fromEntries(
  Object.entries(MEEL_SYNC_STORED_KEY_MAP).map(([localKey, storedKey]) => [
    storedKey,
    localKey,
  ]),
) as Record<string, MeelSyncAllowedStoreKey>;

const SENSITIVE_SK_RE = /(^|[^a-z])sk-[a-z0-9]/i;
const SENSITIVE_KEY_RE =
  /api[-_]?key|password|secret|token|access[-_]?code|base[-_]?url|endpoint/i;
const SENSITIVE_VALUE_RE =
  /bearer\s+|api[-_]?key|password|secret|token|access[-_]?code|base[-_]?url|endpoint/i;
const UNSAFE_OBJECT_KEY_RE = /^(__proto__|constructor|prototype)$/i;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stripMeelSyncSensitiveFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map((item) => stripMeelSyncSensitiveFields(item))
      .filter((item) => item !== undefined);
  }

  if (isPlainObject(value)) {
    const clean: Record<string, unknown> = {};

    for (const [key, item] of Object.entries(value)) {
      if (
        UNSAFE_OBJECT_KEY_RE.test(key) ||
        SENSITIVE_KEY_RE.test(key) ||
        SENSITIVE_SK_RE.test(key)
      ) {
        continue;
      }

      const stripped = stripMeelSyncSensitiveFields(item);
      if (stripped !== undefined) {
        clean[key] = stripped;
      }
    }

    return clean;
  }

  if (
    typeof value === "string" &&
    (SENSITIVE_VALUE_RE.test(value) || SENSITIVE_SK_RE.test(value))
  ) {
    return undefined;
  }

  return value;
}

export function sanitizeMeelSyncState(state: unknown): MeelSyncState {
  if (!isPlainObject(state)) {
    return {};
  }

  const cleanState: MeelSyncState = {};

  for (const key of MEEL_SYNC_ALLOWED_STORE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(state, key)) {
      continue;
    }

    const cleanValue = stripMeelSyncSensitiveFields(state[key]);
    if (cleanValue !== undefined) {
      cleanState[key] = cleanValue;
    }
  }

  return cleanState;
}

function normalizeSyncMessage(message: unknown, index: number) {
  const fallback = {
    id: `synced-message-${index}`,
    date: "",
    role: "user",
    content: "",
  };

  if (!isPlainObject(message)) {
    return fallback;
  }

  const content =
    typeof message.content === "string" || Array.isArray(message.content)
      ? message.content
      : "";

  return {
    ...fallback,
    ...message,
    id:
      typeof message.id === "string" && message.id.length > 0
        ? message.id
        : fallback.id,
    date:
      typeof message.date === "string" && message.date.length > 0
        ? message.date
        : fallback.date,
    role: typeof message.role === "string" ? message.role : fallback.role,
    content,
  };
}

function normalizeSyncSession(session: unknown, index: number) {
  const fallback = {
    id: `synced-session-${index}`,
    topic: "",
    messages: [],
    stat: {
      tokenCount: 0,
      wordCount: 0,
      charCount: 0,
    },
    lastUpdate: 0,
    lastSummarizeIndex: 0,
  };

  if (!isPlainObject(session)) {
    return fallback;
  }

  const sourceStat = isPlainObject(session.stat) ? session.stat : {};
  const stat = {
    ...fallback.stat,
    ...sourceStat,
    tokenCount:
      typeof sourceStat.tokenCount === "number" ? sourceStat.tokenCount : 0,
    wordCount:
      typeof sourceStat.wordCount === "number" ? sourceStat.wordCount : 0,
    charCount:
      typeof sourceStat.charCount === "number" ? sourceStat.charCount : 0,
  };
  const sourceMask = isPlainObject(session.mask) ? session.mask : undefined;
  const mask = sourceMask
    ? {
        ...sourceMask,
        context: Array.isArray(sourceMask.context)
          ? sourceMask.context.map((message, messageIndex) =>
              normalizeSyncMessage(message, messageIndex),
            )
          : [],
      }
    : sourceMask;

  return {
    ...fallback,
    ...session,
    id:
      typeof session.id === "string" && session.id.length > 0
        ? session.id
        : fallback.id,
    topic: typeof session.topic === "string" ? session.topic : fallback.topic,
    messages: Array.isArray(session.messages)
      ? session.messages.map((message, messageIndex) =>
          normalizeSyncMessage(message, messageIndex),
        )
      : [],
    stat,
    lastUpdate:
      typeof session.lastUpdate === "number"
        ? session.lastUpdate
        : fallback.lastUpdate,
    lastSummarizeIndex:
      typeof session.lastSummarizeIndex === "number"
        ? session.lastSummarizeIndex
        : fallback.lastSummarizeIndex,
    ...(mask ? { mask } : {}),
  };
}

function normalizeSyncChatState(chatState: unknown) {
  if (!isPlainObject(chatState)) {
    return chatState;
  }

  const sessions = Array.isArray(chatState.sessions)
    ? chatState.sessions.map((session, index) =>
        normalizeSyncSession(session, index),
      )
    : [];
  const currentSessionIndex =
    sessions.length > 0 && typeof chatState.currentSessionIndex === "number"
      ? Math.min(sessions.length - 1, Math.max(0, chatState.currentSessionIndex))
      : 0;

  return {
    ...chatState,
    sessions,
    currentSessionIndex,
  };
}

export function normalizeMeelSyncStateForClient(state: unknown): MeelSyncState {
  const cleanState = sanitizeMeelSyncState(state);
  const chatState = cleanState["chat-next-web-store"];

  if (chatState !== undefined) {
    cleanState["chat-next-web-store"] = normalizeSyncChatState(chatState);
  }

  return cleanState;
}

export function encodeMeelSyncStoredState(state: MeelSyncState) {
  const storedState: Record<string, unknown> = {};

  for (const key of MEEL_SYNC_ALLOWED_STORE_KEYS) {
    const value = state[key];
    if (value !== undefined) {
      storedState[MEEL_SYNC_STORED_KEY_MAP[key]] = value;
    }
  }

  return storedState;
}

export function decodeMeelSyncStoredState(state: unknown): MeelSyncState {
  if (!isPlainObject(state)) {
    return {};
  }

  const localState: MeelSyncState = {};

  for (const [key, value] of Object.entries(state)) {
    const localKey =
      MEEL_SYNC_LOCAL_KEY_MAP[key] ??
      (MEEL_SYNC_ALLOWED_STORE_KEYS.includes(key as MeelSyncAllowedStoreKey)
        ? (key as MeelSyncAllowedStoreKey)
        : undefined);

    if (localKey) {
      localState[localKey] = value;
    }
  }

  return localState;
}

export function hasMeelSyncSensitiveText(value: unknown) {
  const serialized = JSON.stringify(value);
  return (
    SENSITIVE_VALUE_RE.test(serialized) || SENSITIVE_SK_RE.test(serialized)
  );
}
