import type { ServerConfig } from '../interfaces/server-config.js';
import type { ServerDto } from '../dto/server-dto.js';
import { mapServerToDto } from '../mapper/server-mapper.js';

let masterOnlyCache = new Map<string, ServerConfig>();

export function cachedMasterServers(): ServerDto[] {
  return [...masterOnlyCache.values()].map((server) => ({ ...mapServerToDto(server), masterOnly: true }));
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
    if (server.ip === ip && server.port === port) masterOnlyCache.delete(id);
  }
}

export function replaceMasterOnlyCache(next: Map<string, ServerConfig>): void {
  masterOnlyCache = next;
}

export function clearMasterOnlyCache(): void {
  masterOnlyCache = new Map();
}
