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
});
