import type { ServerConfig } from '../interfaces/server-config.js';
import type { ServerDto } from '../dto/server-dto.js';
import { mapServerToDto } from '../mapper/server-mapper.js';

import { serverObservationKeys } from './global-player-observation.js';
import type { MasterOnlyLive } from './master-only-live-service.js';

let liveCache = new Map<string, MasterOnlyLive>();
let masterOnlyCache = new Map<string, ServerConfig>();

export function cachedMasterObservations(stored: readonly ServerConfig[] = []) {
  const storedKeys = new Set(stored.flatMap(serverObservationKeys));
  const now = Date.now();
  for (const [id, live] of liveCache) if (live.expiresAt <= now) liveCache.delete(id);
  return [...masterOnlyCache.values()]
    .filter(server => !serverObservationKeys(server).some(key => storedKeys.has(key)))
    .map(server => ({ server, live: liveCache.get(server.id) }));
}

export function cachedMasterServers(stored?: readonly ServerConfig[]): ServerDto[] {
  return cachedMasterObservations(stored).map(({ server, live }) => ({
    ...mapServerToDto(server),
    masterOnly: true,
    status: live?.status ?? 'unknown',
    ...(live && live.status !== 'unknown' ? {
      masterOnlyLiveUntil: new Date(live.expiresAt).toISOString(),
      masterOnlyPlayerNames: live.names,
      queryData: {
        playercount: live.observation?.count,
        maxplayers: live.maxPlayers,
        map: live.map,
        version: live.version,
      },
    } : {}),
  }));
}

export function cachedMasterById(id: string): ServerConfig | undefined {
  return masterOnlyCache.get(id);
}

export function cachedMasterEndpoint(ip: string, port: number): ServerConfig | undefined {
  return [...masterOnlyCache.values()].find((server) => server.ip === ip && server.port === port);
}

export function cachedMasterByQueryUrl(queryUrl: string): ServerConfig | undefined {
  return [...masterOnlyCache.values()].find((server) => server.queryUrl === queryUrl);
}

export function removeCachedMasterEndpoint(ip: string, port: number): void {
  for (const [id, server] of masterOnlyCache) {
    if (server.ip === ip && server.port === port) {
      masterOnlyCache.delete(id);
      liveCache.delete(id);
    }
  }
}

export function setMasterOnlyLive(server: ServerConfig, live: MasterOnlyLive): void {
  // A response can arrive after discovery removed or replaced this endpoint.
  if (masterOnlyCache.get(server.id)?.queryUrl === server.queryUrl) liveCache.set(server.id, live);
}

export function replaceMasterOnlyCache(next: Map<string, ServerConfig>): void {
  for (const id of liveCache.keys()) {
    const server = next.get(id);
    if (!server || server.queryUrl !== masterOnlyCache.get(id)?.queryUrl) liveCache.delete(id);
  }
  masterOnlyCache = next;
}

export function clearMasterOnlyCache(): void {
  replaceMasterOnlyCache(new Map());
}
