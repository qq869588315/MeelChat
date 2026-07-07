type MeelSyncEventType = "dirty" | "push";

type MeelSyncEvent = {
  type: MeelSyncEventType;
};

type MeelSyncListener = (event: MeelSyncEvent) => void;

const listeners = new Set<MeelSyncListener>();

export function emitMeelSyncEvent(type: MeelSyncEventType) {
  listeners.forEach((listener) => listener({ type }));
}

export function onMeelSyncEvent(listener: MeelSyncListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function markMeelSyncDirty() {
  emitMeelSyncEvent("dirty");
}

export function pushMeelSyncNow() {
  emitMeelSyncEvent("push");
}
