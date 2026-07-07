import { createWebDavClient } from "./webdav";
import { createUpstashClient } from "./upstash";
import { createMeelSyncClient } from "./meel-sync";

export enum ProviderType {
  Meel = "meel",
  WebDAV = "webdav",
  UpStash = "upstash",
}

export const SyncClients = {
  [ProviderType.Meel]: createMeelSyncClient,
  [ProviderType.UpStash]: createUpstashClient,
  [ProviderType.WebDAV]: createWebDavClient,
} as const;

type SyncClientConfig = {
  [K in keyof typeof SyncClients]: (typeof SyncClients)[K] extends (
    _: infer C,
  ) => any
    ? C
    : never;
};

export type SyncClient = {
  get: (key: string) => Promise<string>;
  set: (key: string, value: string) => Promise<void>;
  check: () => Promise<boolean>;
};

export function createSyncClient<T extends ProviderType>(
  provider: T,
  config: SyncClientConfig[T],
): SyncClient {
  return SyncClients[provider](config as any) as any;
}
