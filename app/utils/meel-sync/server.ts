import { randomUUID, timingSafeEqual, createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";

import {
  MEEL_SYNC_ALLOWED_STORE_KEYS,
  MeelSyncState,
  decodeMeelSyncStoredState,
  encodeMeelSyncStoredState,
  hasMeelSyncSensitiveText,
  normalizeMeelSyncStateForClient,
  sanitizeMeelSyncState,
  stripMeelSyncSensitiveFields,
} from "./sanitize";

export const DEFAULT_MEEL_SYNC_DIR = "/data/nextchat-sync";
export const DEFAULT_MEEL_SYNC_MAX_BYTES = 10 * 1024 * 1024;
export {
  MEEL_SYNC_ALLOWED_STORE_KEYS,
  decodeMeelSyncStoredState,
  encodeMeelSyncStoredState,
  hasMeelSyncSensitiveText,
  normalizeMeelSyncStateForClient,
  sanitizeMeelSyncState,
  stripMeelSyncSensitiveFields,
};

export type MeelSyncUser = {
  userId: string;
  tokenHash: string;
};

export type MeelSyncConfig = {
  enabled: boolean;
  syncDir: string;
  maxBytes: number;
  users: MeelSyncUser[];
};

export type StoredMeelSyncFile = {
  updatedAt: number;
  state: MeelSyncState;
};

const SAFE_USER_ID_RE = /^[a-zA-Z0-9_-]+$/;

export function hashMeelSyncToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function parseMeelSyncUsers(rawUsers = ""): MeelSyncUser[] {
  return rawUsers
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separatorIndex = entry.indexOf(":");
      if (separatorIndex <= 0) {
        throw new Error("invalid_user_mapping");
      }

      const userId = entry.slice(0, separatorIndex).trim();
      const tokenHash = entry
        .slice(separatorIndex + 1)
        .trim()
        .toLowerCase();

      if (!SAFE_USER_ID_RE.test(userId) || !/^[a-f0-9]{64}$/.test(tokenHash)) {
        throw new Error("invalid_user_mapping");
      }

      return { userId, tokenHash };
    });
}

export function getMeelSyncConfig(
  env: Pick<
    NodeJS.ProcessEnv,
    | "MEEL_SYNC_ENABLED"
    | "MEEL_SYNC_DIR"
    | "MEEL_SYNC_MAX_BYTES"
    | "MEEL_SYNC_USERS"
  > = process.env,
): MeelSyncConfig {
  const maxBytes = Number.parseInt(env.MEEL_SYNC_MAX_BYTES ?? "", 10);

  return {
    enabled: env.MEEL_SYNC_ENABLED === "1",
    syncDir: env.MEEL_SYNC_DIR || DEFAULT_MEEL_SYNC_DIR,
    maxBytes:
      Number.isFinite(maxBytes) && maxBytes > 0
        ? maxBytes
        : DEFAULT_MEEL_SYNC_MAX_BYTES,
    users: parseMeelSyncUsers(env.MEEL_SYNC_USERS ?? ""),
  };
}

function safeHashEqual(leftHex: string, rightHex: string) {
  const left = Buffer.from(leftHex, "hex");
  const right = Buffer.from(rightHex, "hex");

  if (left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(left, right);
}

export function findMeelSyncUserByToken(token: string, users: MeelSyncUser[]) {
  const tokenHash = hashMeelSyncToken(token);
  let matchedUser: MeelSyncUser | undefined;

  for (const user of users) {
    if (safeHashEqual(tokenHash, user.tokenHash)) {
      matchedUser = user;
    }
  }

  return matchedUser;
}

export function parseBearerToken(authHeader: string | null) {
  const header = authHeader?.trim() ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

export function resolveMeelSyncStatePath(syncDir: string, userId: string) {
  if (!SAFE_USER_ID_RE.test(userId)) {
    throw new Error("invalid_user_id");
  }

  const baseDir = path.resolve(syncDir);
  const filePath = path.resolve(baseDir, `${userId}.json`);
  const relative = path.relative(baseDir, filePath);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("invalid_sync_path");
  }

  return filePath;
}

export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function readMeelSyncFile(filePath: string) {
  const rawContent = await fs.readFile(filePath, "utf8");
  const parsed = JSON.parse(rawContent) as StoredMeelSyncFile | MeelSyncState;

  if (isPlainObject(parsed) && "state" in parsed) {
    const state = normalizeMeelSyncStateForClient(
      decodeMeelSyncStoredState(parsed.state),
    );
    const updatedAt =
      typeof parsed.updatedAt === "number" ? parsed.updatedAt : null;
    return { updatedAt, state };
  }

  return {
    updatedAt: null,
    state: normalizeMeelSyncStateForClient(decodeMeelSyncStoredState(parsed)),
  };
}

export async function writeMeelSyncFile(
  filePath: string,
  payload: StoredMeelSyncFile,
) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  const tempFilePath = `${filePath}.${randomUUID()}.tmp`;
  const backupFilePath = `${filePath}.bak`;
  const serialized = JSON.stringify({
    ...payload,
    state: encodeMeelSyncStoredState(payload.state),
  });

  try {
    await fs.writeFile(tempFilePath, serialized, "utf8");

    try {
      await fs.copyFile(filePath, backupFilePath);
    } catch (error: any) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }

    await fs.rename(tempFilePath, filePath);
  } catch (error) {
    await fs.rm(tempFilePath, { force: true }).catch(() => undefined);
    throw error;
  }
}
