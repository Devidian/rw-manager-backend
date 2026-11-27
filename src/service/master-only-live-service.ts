import { listServers } from '../db/manager-store.js';
import { cachedMasterObservations, setMasterOnlyLive } from './master-only-cache-service.js';
import type { ServerConfig } from '../interfaces/server-config.js';
import { AppConfig } from '../utils/app-config.js';
import { observedPlayerCount, playerObservation, type PlayerObservation } from './global-player-observation.js';
import { readPublicOnlinePlayers } from './public-online-player-service.js';

export interface MasterOnlyLive {
  status: 'online' | 'offline' | 'unknown';
  expiresAt: number;
  names: string[];
  observation?: PlayerObservation;
  maxPlayers?: number;
  map?: string;
  version?: string;
}

async function fetchStatus(queryUrl: string): Promise<Record<string, unknown> | undefined> {
  try {
    const response = await fetch(queryUrl, {
      signal: AbortSignal.timeout(AppConfig.liveQueryProxyTimeoutMs),
      redirect: 'error',
    });
    if (!response.ok) return undefined;
    const data: unknown = await response.json();
    return data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

async function observeMasterOnlyServer(server: ServerConfig, ttlMs: number): Promise<MasterOnlyLive> {
  const data = await fetchStatus(server.queryUrl);
  const offline = data?.status === 'offline';
  const count = observedPlayerCount(data);
  const roster = count === 0 ? null : await readPublicOnlinePlayers(server);
  return {
    status: offline ? 'offline' : data || roster ? 'online' : 'unknown',
    observation: playerObservation(count, roster),
    maxPlayers: observedPlayerCount({ playercount: data?.maxplayers }),
    map: typeof data?.map === 'string' ? data.map.trim() || undefined : undefined,
    version: typeof data?.version === 'string' ? data.version.trim() || undefined : undefined,
    names: roster?.flatMap(({ name }) => name ? [name] : []) ?? [],
    expiresAt: Date.now() + ttlMs,
  };
}

let inFlight: Promise<void> | undefined;

export function refreshMasterOnlyLive(): Promise<void> {
  inFlight ??= refreshCatalogObservations().finally(() => { inFlight = undefined; });
  return inFlight;
}

async function refreshCatalogObservations(): Promise<void> {
  if (!cachedMasterObservations().length) return;
  const catalog = cachedMasterObservations(await listServers())
    .sort((a, b) => a.server.id.localeCompare(b.server.id));
  const concurrency = AppConfig.playerListRefreshConcurrency;
  const batches = Math.ceil(catalog.length / concurrency);
  // Allow a bounded query round and two refresh intervals, including client polling.
  const ttlMs = Math.max(60_000, 2 * AppConfig.activePlayerListRefreshIntervalMs) +
    2 * batches * AppConfig.liveQueryProxyTimeoutMs;
  for (let offset = 0; offset < catalog.length; offset += concurrency) {
    await Promise.all(catalog.slice(offset, offset + concurrency).map(async ({ server }) => {
      setMasterOnlyLive(server, await observeMasterOnlyServer(server, ttlMs));
    }));
  }
}
