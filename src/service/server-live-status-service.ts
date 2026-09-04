import { findServerById, listServers, updateServer } from '../db/manager-store.js';
import { recordServerStatisticsSample } from '../db/server-statistics-store.js';
import type { ServerLiveStatusResponse } from '../dto/server-live-status-response.js';
import type { ServerConfig } from '../interfaces/server-config.js';
import { AppConfig } from '../utils/app-config.js';
import { defaultLogger } from '../utils/logger.js';
import { mergeKnownPlayers, observedPlayersFromValues } from './observed-player-service.js';
import { parseNativeAdminUtilsInfo } from './native-admin-utils-info.js';
import { gameConnectorAuthorizationHeader } from './game-connector-credential-service.js';
import { publishServerLiveUpdate } from './server-live-update-service.js';
import { hasActiveGameConnectorFeature, registerGameConnectorEventHandler } from './game-connector-websocket-service.js';

const NATIVE_ADMIN_UTILS_ROUTE = 'plugins/oz---admin-utils';

interface CacheEntry {
  expiresAt: number;
  response: ServerLiveStatusResponse;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<ServerLiveStatusResponse>>();
const playerListRefreshAttemptedAt = new Map<string, number>();

registerGameConnectorEventHandler(async (serverId, event, data) => {
  if (event === 'playerStatus') await acceptConnectorPlayerStatus(serverId, data);
});

async function fetchJson(
  url: string,
  timeoutMs: number = AppConfig.liveQueryProxyTimeoutMs,
  authorization?: string,
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: authorization ? { Authorization: authorization } : undefined,
    });
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
    return { ok: true, data: await response.json() };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'UNKNOWN_ERROR',
    };
  }
}

function buildInfoUrl(queryUrl: string): string {
  return new URL('info', `${queryUrl.replace(/\/+$/, '')}/`).toString();
}

function buildNativeAdminUtilsInfoUrl(queryUrl: string): string {
  return new URL(`${NATIVE_ADMIN_UTILS_ROUTE}/info`, `${queryUrl.replace(/\/+$/, '')}/`).toString();
}

function buildPlayerListUrl(queryUrl: string): string {
  return new URL('playerlist', `${queryUrl.replace(/\/+$/, '')}/`).toString();
}

function playersFromPayload(payload: unknown): unknown[] | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const players = (payload as { players?: unknown }).players;
  return Array.isArray(players) ? players : undefined;
}

function onlinePlayerUids(players: unknown[] | undefined): string[] {
  if (!players) return [];
  return [...new Set(players.flatMap((player): string[] => {
    if (!player || typeof player !== 'object') return [];
    const uid = (player as { uid?: unknown; UID?: unknown }).uid ?? (player as { UID?: unknown }).UID;
    return typeof uid === 'string' && uid.trim() ? [uid.trim()] : [];
  }))];
}

function numberFromPayload(payload: unknown, key: string): number | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function arrayOrUndefined(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function isQueryDataFresh(server: ServerConfig, now: number): boolean {
  if (!server.queryDataUpdatedAt) return false;
  const updatedAt = new Date(server.queryDataUpdatedAt).getTime();
  if (Number.isNaN(updatedAt)) return false;
  return now - updatedAt < AppConfig.serverQueryRefreshIntervalMs;
}

export function storedLiveStatusResponse(server: ServerConfig): ServerLiveStatusResponse {
  const parsedLastChecked = server.lastChecked
    ? new Date(server.lastChecked)
    : new Date();
  const lastChecked = Number.isNaN(parsedLastChecked.getTime())
    ? new Date().toISOString()
    : parsedLastChecked.toISOString();
  const status = server.status === 'online'
    ? 'online'
    : server.status === 'offline'
      ? 'offline'
      : server.data !== undefined
        ? 'online'
        : 'offline';
  return {
    status,
    lastChecked: lastChecked as ServerLiveStatusResponse['lastChecked'],
    queryData: server.data,
    infoData: server.info,
    onlinePlayers: arrayOrUndefined(server.onlinePlayers),
    errorMessage: stringOrUndefined(server.errorMessage),
  };
}

async function persistLiveStatus(server: ServerConfig, response: ServerLiveStatusResponse): Promise<void> {
  let changed = false;

  if (response.queryData !== undefined) {
    server.data = response.queryData;
    changed = true;
  }

  server.status = response.status;
  server.lastChecked = new Date(response.lastChecked);
  server.errorMessage = response.errorMessage;
  server.onlinePlayers = response.onlinePlayers;
  server.knownPlayers = mergeKnownPlayers(
    server.knownPlayers,
    observedPlayersFromValues(response.onlinePlayers, response.lastChecked),
  );
  changed = true;

  if (response.infoData !== undefined) {
    server.info = response.infoData;
    const nativeInfo = parseNativeAdminUtilsInfo(response.infoData);
    server.mapUrl = nativeInfo?.mapUrl ?? server.mapUrl;
    server.adminUid = nativeInfo?.adminUid ?? server.adminUid;
    changed = true;
  }

  if (changed) {
    server.queryDataUpdatedAt = new Date(response.lastChecked);
    await updateServer(server.id, {
      data: server.data,
      info: server.info,
      label: server.label,
      mapUrl: server.mapUrl,
      backendUrl: server.backendUrl,
      status: server.status,
      lastChecked: server.lastChecked,
      errorMessage: server.errorMessage,
      onlinePlayers: server.onlinePlayers,
      knownPlayers: server.knownPlayers,
      queryDataUpdatedAt: server.queryDataUpdatedAt,
    });
    publishServerLiveUpdate(server.id, response);
  }
}

export async function getStoredServerLiveStatus(serverId: string): Promise<ServerLiveStatusResponse> {
  const server = await findServerById(serverId);
  if (!server) throw new Error('SERVER_NOT_FOUND');
  if (!server.queryUrl) throw new Error('QUERY_URL_MISSING');
  return storedLiveStatusResponse(server);
}

async function fetchLiveStatus(server: ServerConfig): Promise<ServerLiveStatusResponse> {
  const queryUrl = server.queryUrl;
  const startedAt = Date.now();
  defaultLogger.debug(`Live server query started: ${queryUrl}`);
  const [queryResult, infoResult, nativeInfoResult, playerlistResult] = await Promise.all([
    fetchJson(queryUrl),
    fetchJson(buildInfoUrl(queryUrl), AppConfig.liveQueryProxyTimeoutMs),
    fetchJson(buildNativeAdminUtilsInfoUrl(queryUrl), AppConfig.liveQueryProxyTimeoutMs, gameConnectorAuthorizationHeader(server)),
    fetchJson(buildPlayerListUrl(queryUrl), AppConfig.playerListTimeoutMs),
  ]);

  const lastChecked = new Date().toISOString() as ServerLiveStatusResponse['lastChecked'];
  const onlinePlayers = playerlistResult.ok
    ? playersFromPayload(playerlistResult.data)
    : undefined;
  const response: ServerLiveStatusResponse = {
    status: queryResult.ok || onlinePlayers !== undefined ? 'online' : 'offline',
    lastChecked,
  };

  if (queryResult.ok) {
    response.queryData = queryResult.data;
  } else {
    response.errorMessage = queryResult.error;
  }

  if (infoResult.ok) response.infoData = infoResult.data;
  if (nativeInfoResult.ok) {
    const nativeInfo = parseNativeAdminUtilsInfo(nativeInfoResult.data);
    if (nativeInfo) {
      server.mapUrl = nativeInfo.mapUrl ?? server.mapUrl;
      server.adminUid = nativeInfo.adminUid ?? server.adminUid;
    }
  }
  if (onlinePlayers !== undefined) response.onlinePlayers = onlinePlayers;

  defaultLogger.debug('Live server query completed:', {
    queryUrl,
    status: response.status,
    durationMs: Date.now() - startedAt,
  });
  return response;
}

function playerCountFromLiveStatus(response: ServerLiveStatusResponse): number {
  const playerListCount = numberFromPayload(
    { playercount: response.onlinePlayers?.length },
    'playercount',
  );
  if (playerListCount !== undefined) return playerListCount;
  const queryCount = numberFromPayload(response.queryData, 'playercount');
  return queryCount ?? 0;
}

function playerListRefreshIntervalMs(server: ServerConfig): number {
  return Array.isArray(server.onlinePlayers) && server.onlinePlayers.length > 0
    ? AppConfig.activePlayerListRefreshIntervalMs
    : AppConfig.playerListRefreshIntervalMs;
}

function lastPlayerListRefreshAt(server: ServerConfig): number {
  const attemptedAt = playerListRefreshAttemptedAt.get(server.id);
  if (attemptedAt !== undefined) return attemptedAt;
  const lastChecked = server.lastChecked ? new Date(server.lastChecked).getTime() : Number.NaN;
  return Number.isFinite(lastChecked) ? lastChecked : 0;
}

async function refreshOnlinePlayersForServer(server: ServerConfig, now: number): Promise<boolean> {
  if (!server.queryUrl || server.status !== 'online') return false;
  if (hasActiveGameConnectorFeature(server.id, 'playerStatus')) return false;
  if (now - lastPlayerListRefreshAt(server) < playerListRefreshIntervalMs(server)) return false;
  playerListRefreshAttemptedAt.set(server.id, now);

  const playerlistResult = await fetchJson(
    buildPlayerListUrl(server.queryUrl),
    AppConfig.playerListTimeoutMs,
  );
  const onlinePlayers = playerlistResult.ok ? playersFromPayload(playerlistResult.data) : undefined;
  if (onlinePlayers === undefined) return false;

  const lastChecked = new Date(now);
  server.onlinePlayers = onlinePlayers;
  server.knownPlayers = mergeKnownPlayers(
    server.knownPlayers,
    observedPlayersFromValues(onlinePlayers, lastChecked.toISOString()),
  );
  server.lastChecked = lastChecked;
  await updateServer(server.id, {
    onlinePlayers: server.onlinePlayers,
    knownPlayers: server.knownPlayers,
    lastChecked: server.lastChecked,
  });
  publishServerLiveUpdate(server.id, storedLiveStatusResponse(server));
  return true;
}

/** Accepts only a complete, bounded runtime player-list snapshot from the authenticated game connector. */
export async function acceptConnectorPlayerStatus(serverId: string, payload: unknown): Promise<void> {
  const players = connectorOnlinePlayers(payload);
  if (players === undefined) throw new Error('INVALID_PLAYER_STATUS');
  const server = await findServerById(serverId);
  if (!server) return;
  const lastChecked = new Date();
  server.onlinePlayers = players;
  server.knownPlayers = mergeKnownPlayers(
    server.knownPlayers,
    observedPlayersFromValues(players, lastChecked.toISOString()),
  );
  server.status = 'online';
  server.lastChecked = lastChecked;
  server.errorMessage = undefined;
  await updateServer(server.id, {
    onlinePlayers: server.onlinePlayers,
    knownPlayers: server.knownPlayers,
    status: server.status,
    lastChecked: server.lastChecked,
    errorMessage: undefined,
  });
  const response = storedLiveStatusResponse(server);
  cache.set(server.id, { expiresAt: Date.now() + AppConfig.liveQueryProxyCacheTtlMs, response });
  publishServerLiveUpdate(server.id, response);
}

function connectorOnlinePlayers(payload: unknown): unknown[] | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const value = payload as { schemaVersion?: unknown; players?: unknown };
  if (value.schemaVersion !== 1 || !Array.isArray(value.players) || value.players.length > 500) return undefined;
  const players = value.players.filter((player): player is Record<string, unknown> => (
    !!player && typeof player === 'object' && typeof (player as { uid?: unknown }).uid === 'string'
  ));
  if (players.length !== value.players.length) return undefined;
  return players.filter((player) => player.connected !== false);
}

export async function refreshDueServerPlayerLists(): Promise<{ checked: number; refreshed: number }> {
  const now = Date.now();
  const servers = await listServers();
  let refreshed = 0;
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(AppConfig.playerListRefreshConcurrency, servers.length) },
    async () => {
      while (nextIndex < servers.length) {
        const server = servers[nextIndex++];
        if (await refreshOnlinePlayersForServer(server, now)) refreshed += 1;
      }
    },
  );
  await Promise.all(workers);
  return { checked: servers.length, refreshed };
}

export async function getServerLiveStatus(serverId: string): Promise<ServerLiveStatusResponse> {
  const server = await findServerById(serverId);
  if (!server) throw new Error('SERVER_NOT_FOUND');
  if (!server.queryUrl) throw new Error('QUERY_URL_MISSING');

  const now = Date.now();
  const cached = cache.get(serverId);
  if (cached && cached.expiresAt > now) {
    defaultLogger.debug(`Live server status cache hit: ${serverId}`);
    return cached.response;
  }

  if (isQueryDataFresh(server, now)) {
    const response = storedLiveStatusResponse(server);
    cache.set(serverId, {
      expiresAt: Date.now() + AppConfig.liveQueryProxyCacheTtlMs,
      response,
    });
    defaultLogger.debug('Live server query skipped within server refresh interval:', {
      serverId,
      queryDataUpdatedAt: server.queryDataUpdatedAt,
      serverQueryRefreshIntervalMs: AppConfig.serverQueryRefreshIntervalMs,
    });
    return response;
  }

  const existing = inflight.get(serverId);
  if (existing) return existing;

  const request = fetchLiveStatus(server)
    .then(async (response) => {
      await persistLiveStatus(server, response);
      await recordServerStatisticsSample({
        serverId,
        sampledAt: new Date(response.lastChecked),
        online: response.status === 'online',
        playerCount: playerCountFromLiveStatus(response),
        onlinePlayerUids: onlinePlayerUids(response.onlinePlayers),
      });
      cache.set(serverId, {
        expiresAt: Date.now() + AppConfig.liveQueryProxyCacheTtlMs,
        response,
      });
      return response;
    })
    .finally(() => {
      inflight.delete(serverId);
    });

  inflight.set(serverId, request);
  return request;
}

export function clearServerLiveStatusCache(): void {
  cache.clear();
  inflight.clear();
  playerListRefreshAttemptedAt.clear();
}
