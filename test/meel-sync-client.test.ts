import { jest } from "@jest/globals";

import {
  createMeelSyncClient,
  normalizeMeelSyncEndpoint,
} from "../app/utils/cloud/meel-sync";

describe("Meel sync client", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("normalizes site roots to the sync API endpoint", () => {
    expect(normalizeMeelSyncEndpoint("")).toBe("/api/meel-sync/state");
    expect(normalizeMeelSyncEndpoint("/")).toBe("/api/meel-sync/state");
    expect(normalizeMeelSyncEndpoint("api/meel-sync/state")).toBe(
      "/api/meel-sync/state",
    );
    expect(normalizeMeelSyncEndpoint("https://chat.aameel.top")).toBe(
      "https://chat.aameel.top/api/meel-sync/state",
    );
    expect(normalizeMeelSyncEndpoint("chat.aameel.top")).toBe(
      "https://chat.aameel.top/api/meel-sync/state",
    );
  });

  test("requires a valid Meel sync JSON response when checking availability", async () => {
    const fetchMock = jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, userId: "me01", updatedAt: null }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new SyntaxError("Unexpected token <");
        },
      } as Response);

    const client = createMeelSyncClient({
      meel: {
        endpoint: "https://chat.aameel.top",
        token: "token",
        autoSync: true,
      },
    } as any);

    await expect(client.check()).resolves.toBe(true);
    await expect(client.check()).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://chat.aameel.top/api/meel-sync/state",
      expect.objectContaining({ method: "GET" }),
    );
  });

  test("includes status and payload size in upload errors", async () => {
    jest.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 413,
      json: async () => ({ ok: false, error: "payload_too_large" }),
    } as Response);

    const client = createMeelSyncClient({
      meel: {
        endpoint: "/api/meel-sync/state",
        token: "token",
        autoSync: true,
      },
    } as any);

    await expect(
      client.set("state", JSON.stringify({ "chat-next-web-store": {} })),
    ).rejects.toThrow(/payload_too_large \(HTTP 413, .+ B\)/);
  });

  test("trims copied token whitespace before sending authorization", async () => {
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, userId: "me01", updatedAt: null }),
    } as Response);

    const client = createMeelSyncClient({
      meel: {
        endpoint: "/api/meel-sync/state",
        token: "  token\n",
        autoSync: true,
      },
    } as any);

    await expect(
      client.set("state", JSON.stringify({ "chat-next-web-store": {} })),
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/meel-sync/state",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer token" }),
      }),
    );
  });

  test("rejects unsafe token formatting before sending the request", async () => {
    const fetchMock = jest.spyOn(global, "fetch");
    fetchMock.mockClear();

    const client = createMeelSyncClient({
      meel: {
        endpoint: "/api/meel-sync/state",
        token: "tok\nen",
        autoSync: true,
      },
    } as any);

    await expect(
      client.set("state", JSON.stringify({ "chat-next-web-store": {} })),
    ).rejects.toThrow("invalid_sync_token");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("wraps failed uploads as network errors with payload size", async () => {
    jest.spyOn(global, "fetch").mockRejectedValueOnce(new TypeError("failed"));

    const client = createMeelSyncClient({
      meel: {
        endpoint: "/api/meel-sync/state",
        token: "token",
        autoSync: true,
      },
    } as any);

    await expect(
      client.set("state", JSON.stringify({ "chat-next-web-store": {} })),
    ).rejects.toThrow(/network_error \(.+ B\)/);
  });

  test("rejects oversized uploads before sending the request", async () => {
    const fetchMock = jest.spyOn(global, "fetch");
    fetchMock.mockClear();
    const client = createMeelSyncClient({
      meel: {
        endpoint: "/api/meel-sync/state",
        token: "token",
        autoSync: true,
      },
    } as any);

    await expect(
      client.set("state", JSON.stringify({ oversized: "x".repeat(10485760) })),
    ).rejects.toThrow(/payload_too_large \(.+ MB\)/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
