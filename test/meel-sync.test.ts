/**
 * @jest-environment node
 */
import { promises as fs } from "fs";
import path from "path";
import { NextRequest } from "next/server";

import { GET, PUT } from "@/app/api/meel-sync/state/route";
import {
  findMeelSyncUserByToken,
  hashMeelSyncToken,
  parseMeelSyncUsers,
  readMeelSyncFile,
  resolveMeelSyncStatePath,
  writeMeelSyncFile,
} from "@/app/utils/meel-sync/server";
import {
  hasMeelSyncSensitiveText,
  decodeMeelSyncStoredState,
  encodeMeelSyncStoredState,
  sanitizeMeelSyncState,
} from "@/app/utils/meel-sync/sanitize";
import { mergeSyncableAppState, SyncableAppState } from "@/app/utils/sync";

const TEST_TMP_DIR = path.join(process.cwd(), ".test-tmp", "meel-sync");
const TOKEN_A = "local-user-a-token";
const TOKEN_B = "local-user-b-token";

const ORIGINAL_ENV = {
  MEEL_SYNC_ENABLED: process.env.MEEL_SYNC_ENABLED,
  MEEL_SYNC_DIR: process.env.MEEL_SYNC_DIR,
  MEEL_SYNC_MAX_BYTES: process.env.MEEL_SYNC_MAX_BYTES,
  MEEL_SYNC_USERS: process.env.MEEL_SYNC_USERS,
};

function setupEnv(maxBytes = "10485760") {
  process.env.MEEL_SYNC_ENABLED = "1";
  process.env.MEEL_SYNC_DIR = TEST_TMP_DIR;
  process.env.MEEL_SYNC_MAX_BYTES = maxBytes;
  process.env.MEEL_SYNC_USERS = [
    `user1:${hashMeelSyncToken(TOKEN_A)}`,
    `user2:${hashMeelSyncToken(TOKEN_B)}`,
  ].join(",");
}

function restoreEnv() {
  process.env.MEEL_SYNC_ENABLED = ORIGINAL_ENV.MEEL_SYNC_ENABLED;
  process.env.MEEL_SYNC_DIR = ORIGINAL_ENV.MEEL_SYNC_DIR;
  process.env.MEEL_SYNC_MAX_BYTES = ORIGINAL_ENV.MEEL_SYNC_MAX_BYTES;
  process.env.MEEL_SYNC_USERS = ORIGINAL_ENV.MEEL_SYNC_USERS;
}

function makeRequest(method: "GET" | "PUT", token: string, body?: unknown) {
  return new NextRequest("http://localhost/api/meel-sync/state", {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe("Meel sync server helpers", () => {
  afterEach(async () => {
    restoreEnv();
    await fs.rm(TEST_TMP_DIR, { recursive: true, force: true });
  });

  test("authenticates hashed tokens without exposing user ids in URL", () => {
    const users = parseMeelSyncUsers(
      `user1:${hashMeelSyncToken(TOKEN_A)},user2:${hashMeelSyncToken(TOKEN_B)}`,
    );

    expect(findMeelSyncUserByToken(TOKEN_A, users)?.userId).toBe("user1");
    expect(findMeelSyncUserByToken(TOKEN_B, users)?.userId).toBe("user2");
    expect(findMeelSyncUserByToken("wrong-token", users)).toBeUndefined();
  });

  test("rejects unsafe user ids before resolving file paths", () => {
    expect(() =>
      resolveMeelSyncStatePath(TEST_TMP_DIR, "../user1"),
    ).toThrow("invalid_user_id");
  });

  test("writes atomically and keeps a backup of the previous file", async () => {
    const filePath = resolveMeelSyncStatePath(TEST_TMP_DIR, "user1");

    await writeMeelSyncFile(filePath, {
      updatedAt: 1,
      state: { "chat-next-web-store": { sessions: [] } },
    });
    await writeMeelSyncFile(filePath, {
      updatedAt: 2,
      state: { "chat-next-web-store": { sessions: [{ id: "new" }] } },
    });

    const current = await readMeelSyncFile(filePath);
    const backup = JSON.parse(await fs.readFile(`${filePath}.bak`, "utf8"));

    expect(current.updatedAt).toBe(2);
    expect(backup.updatedAt).toBe(1);
  });

  test("sanitizes stores and sensitive fields with strict token zero-match", () => {
    const clean = sanitizeMeelSyncState({
      "access-control": {
        openaiApiKey: "sk-should-not-sync",
      },
      "app-config": {
        modelConfig: {
          temperature: 0.5,
          max_tokens: 1000,
        },
        realtimeConfig: {
          apiKey: "secret-value",
          azure: { endpoint: "https://example.com" },
        },
      },
      "chat-next-web-store": {
        sessions: [
          {
            id: "session-1",
            stat: { tokenCount: 12, wordCount: 1 },
            messages: [{ id: "m1", content: "Bearer hidden" }],
          },
        ],
      },
      "mask-store": { masks: {} },
      "prompt-store": { prompts: {} },
    });
    const serialized = JSON.stringify(clean);

    expect(serialized).not.toMatch(
      /apiKey|password|secret|token|accessCode|baseUrl|endpoint/i,
    );
    expect(hasMeelSyncSensitiveText(clean)).toBe(false);
    expect(clean).toHaveProperty("app-config");
    expect(clean).not.toHaveProperty("access-control");
    expect(
      (clean["chat-next-web-store"] as any).sessions[0].id,
    ).toBe("session-1");
    expect(
      (clean["chat-next-web-store"] as any).sessions[0].stat,
    ).toMatchObject({ wordCount: 1 });
    expect(
      (clean["chat-next-web-store"] as any).sessions[0].stat,
    ).not.toHaveProperty("tokenCount");
  });

  test("stores safe wire keys while decoding back to app store keys", () => {
    const localState = sanitizeMeelSyncState({
      "chat-next-web-store": { sessions: [] },
      "app-config": { theme: "dark" },
      "mask-store": { masks: {} },
      "prompt-store": { prompts: {} },
    });
    const storedState = encodeMeelSyncStoredState(localState);
    const serialized = JSON.stringify(storedState);

    expect(Object.keys(storedState)).toEqual([
      "chat",
      "config",
      "mask",
      "prompt",
    ]);
    expect(serialized).not.toMatch(/sk-|token|secret|password|apiKey/i);
    expect(
      decodeMeelSyncStoredState(storedState)["mask-store"],
    ).toMatchObject({
      masks: {},
    });
  });

  test("normalizes filtered chat fields for client reads without changing stored zero-match files", async () => {
    const filePath = resolveMeelSyncStatePath(TEST_TMP_DIR, "user1");

    await writeMeelSyncFile(filePath, {
      updatedAt: 3,
      state: {
        "chat-next-web-store": {
          currentSessionIndex: 0,
          sessions: [
            {
              id: "filtered-session",
              stat: { wordCount: 1, charCount: 2 },
              messages: [{ id: "filtered-message", role: "user" }],
            },
          ],
        },
      },
    });

    const saved = await fs.readFile(filePath, "utf8");
    const current = await readMeelSyncFile(filePath);
    const session = (current.state["chat-next-web-store"] as any).sessions[0];

    expect(saved).not.toMatch(/apiKey|password|secret|token|accessCode|baseUrl|endpoint/i);
    expect(session.stat.tokenCount).toBe(0);
    expect(session.messages[0].content).toBe("");
  });
});

describe("Meel sync route", () => {
  beforeEach(async () => {
    setupEnv();
    await fs.rm(TEST_TMP_DIR, { recursive: true, force: true });
  });

  afterEach(async () => {
    restoreEnv();
    await fs.rm(TEST_TMP_DIR, { recursive: true, force: true });
  });

  test("rejects missing or wrong tokens", async () => {
    const missing = await GET(
      new NextRequest("http://localhost/api/meel-sync/state"),
    );
    const wrong = await GET(makeRequest("GET", "wrong-token"));

    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
  });

  test("writes with one token and isolates the other user's file", async () => {
    const state = {
      "chat-next-web-store": { sessions: [{ id: "session-a" }] },
      "app-config": { theme: "dark" },
      "mask-store": { masks: {} },
      "prompt-store": { prompts: {} },
    };

    const put = await PUT(makeRequest("PUT", TOKEN_A, { state }));
    const getUserA = await GET(makeRequest("GET", TOKEN_A));
    const getUserB = await GET(makeRequest("GET", TOKEN_B));

    expect(put.status).toBe(200);
    expect((await getUserA.json()).state["chat-next-web-store"].sessions[0].id)
      .toBe("session-a");
    expect((await getUserB.json()).state).toBeNull();
  });

  test("rejects payloads over MEEL_SYNC_MAX_BYTES", async () => {
    setupEnv("20");

    const res = await PUT(
      makeRequest("PUT", TOKEN_A, {
        state: { "chat-next-web-store": { sessions: ["too-large"] } },
      }),
    );

    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({
      ok: false,
      error: "payload_too_large",
    });
  });

  test("does not persist sensitive fields from PUT bodies", async () => {
    const res = await PUT(
      makeRequest("PUT", TOKEN_A, {
        state: {
          "chat-next-web-store": {
            sessions: [{ id: "s1", tokenCount: 1, content: "sk-secret" }],
          },
          "app-config": {
            apiKey: "sk-secret",
            modelConfig: { max_tokens: 1, temperature: 0.2 },
          },
        },
      }),
    );
    const filePath = resolveMeelSyncStatePath(TEST_TMP_DIR, "user1");
    const saved = await fs.readFile(filePath, "utf8");

    expect(res.status).toBe(200);
    expect(hasMeelSyncSensitiveText(JSON.parse(saved))).toBe(false);
    expect(saved).not.toMatch(
      /apiKey|password|secret|token|accessCode|baseUrl|endpoint/i,
    );
    expect(saved).not.toMatch(/sk-/i);
    expect(saved).not.toMatch(/mask-store/i);
  });

  test("returns sync_failed for corrupted remote JSON", async () => {
    const filePath = resolveMeelSyncStatePath(TEST_TMP_DIR, "user1");
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, "{not-json", "utf8");

    const res = await GET(makeRequest("GET", TOKEN_A));

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({
      ok: false,
      error: "sync_failed",
    });
  });
});

describe("Meel sync merge behavior", () => {
  test("empty remote state does not clear local state", () => {
    const localState = {
      "chat-next-web-store": {
        sessions: [{ id: "local-session", messages: [] }],
      },
    } as unknown as SyncableAppState;

    const merged = mergeSyncableAppState(localState, {});

    expect(
      merged["chat-next-web-store"]?.sessions?.[0]?.id,
    ).toBe("local-session");
  });

  test("malformed remote stores do not break or overwrite local state", () => {
    const localState = {
      "chat-next-web-store": {
        sessions: [{ id: "local-session", messages: [] }],
      },
      "mask-store": {
        masks: {
          localMask: { id: "localMask" },
        },
      },
      "prompt-store": {
        prompts: {
          localPrompt: { id: "localPrompt" },
        },
      },
    } as unknown as SyncableAppState;
    const remoteState = {
      "chat-next-web-store": {
        state: { sessions: [{ id: "bad-wrapper", messages: [] }] },
      },
      "mask-store": { masks: [] },
      "prompt-store": { prompts: [] },
    } as unknown as SyncableAppState;

    const merged = mergeSyncableAppState(localState, remoteState);

    expect(
      merged["chat-next-web-store"]?.sessions?.[0]?.id,
    ).toBe("local-session");
    expect(merged["mask-store"]?.masks).toHaveProperty("localMask");
    expect(merged["prompt-store"]?.prompts).toHaveProperty("localPrompt");
  });

  test("remote sessions replace the default empty local placeholder", () => {
    const localState = {
      "chat-next-web-store": {
        currentSessionIndex: 0,
        sessions: [
          {
            id: "local-empty",
            topic: "新的聊天",
            messages: [],
            lastUpdate: 3000,
          },
        ],
      },
    } as unknown as SyncableAppState;
    const remoteState = {
      "chat-next-web-store": {
        currentSessionIndex: 0,
        sessions: [
          {
            id: "remote-chat",
            topic: "remote",
            messages: [{ id: "remote-message", date: "2026-07-08" }],
            lastUpdate: 1000,
          },
        ],
      },
    } as unknown as SyncableAppState;

    const merged = mergeSyncableAppState(localState, remoteState);

    expect(merged["chat-next-web-store"]?.sessions).toHaveLength(1);
    expect(merged["chat-next-web-store"]?.sessions?.[0]?.id).toBe(
      "remote-chat",
    );
    expect(merged["chat-next-web-store"]?.currentSessionIndex).toBe(0);
  });

  test("empty remote sessions are synced instead of skipped", () => {
    const localState = {
      "chat-next-web-store": {
        currentSessionIndex: 0,
        sessions: [
          {
            id: "local-chat",
            messages: [{ id: "local-message", date: "2026-07-08" }],
            lastUpdate: 1000,
          },
        ],
      },
    } as unknown as SyncableAppState;
    const remoteState = {
      "chat-next-web-store": {
        currentSessionIndex: 0,
        sessions: [
          {
            id: "remote-empty",
            messages: [],
            lastUpdate: 2000,
          },
        ],
      },
    } as unknown as SyncableAppState;

    const merged = mergeSyncableAppState(localState, remoteState);

    expect(
      merged["chat-next-web-store"]?.sessions?.some(
        (session) => session.id === "remote-empty",
      ),
    ).toBe(true);
  });

  test("newer remote sessions update renamed and edited local sessions", () => {
    const localState = {
      "chat-next-web-store": {
        currentSessionIndex: 0,
        sessions: [
          {
            id: "same-chat",
            topic: "old topic",
            messages: [{ id: "message", content: "old", date: "2026-07-08" }],
            lastUpdate: 1000,
          },
        ],
      },
    } as unknown as SyncableAppState;
    const remoteState = {
      "chat-next-web-store": {
        currentSessionIndex: 0,
        sessions: [
          {
            id: "same-chat",
            topic: "new topic",
            messages: [{ id: "message", content: "new", date: "2026-07-08" }],
            lastUpdate: 2000,
          },
        ],
      },
    } as unknown as SyncableAppState;

    const merged = mergeSyncableAppState(localState, remoteState);

    expect(merged["chat-next-web-store"]?.sessions?.[0]?.topic).toBe(
      "new topic",
    );
    expect(
      merged["chat-next-web-store"]?.sessions?.[0]?.messages?.[0]?.content,
    ).toBe("new");
  });

  test("remote sessions with filtered fields are normalized before merging", () => {
    const localState = {
      "chat-next-web-store": {
        currentSessionIndex: 0,
        sessions: [
          {
            id: "local-empty",
            messages: [],
            lastUpdate: 1000,
          },
        ],
      },
    } as unknown as SyncableAppState;
    const remoteState = {
      "chat-next-web-store": {
        currentSessionIndex: 0,
        sessions: [
          {
            id: "remote-filtered",
            topic: "remote",
            stat: {
              wordCount: 1,
              charCount: 2,
            },
            messages: [
              {
                id: "filtered-message",
                role: "user",
                date: "2026-07-08",
              },
            ],
            lastUpdate: 2000,
          },
        ],
      },
    } as unknown as SyncableAppState;

    const merged = mergeSyncableAppState(localState, remoteState);
    const session = merged["chat-next-web-store"]?.sessions?.[0];

    expect(session?.stat?.tokenCount).toBe(0);
    expect(session?.messages?.[0]?.content).toBe("");
  });
});
