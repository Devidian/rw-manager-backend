import type { ServerLiveStatusResponse } from '../dto/server-live-status-response.js';

export interface ServerLiveUpdate {
  serverId: string;
  value: ServerLiveStatusResponse;
}

type ServerLiveUpdateListener = (update: ServerLiveUpdate) => void;

const listeners = new Set<ServerLiveUpdateListener>();

export function publishServerLiveUpdate(serverId: string, value: ServerLiveStatusResponse): void {
  for (const listener of listeners) listener({ serverId, value });
}

export function subscribeServerLiveUpdates(listener: ServerLiveUpdateListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
