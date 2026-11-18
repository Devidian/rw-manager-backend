import { cachedPublicPlayerCount, clearPublicPlayerCount, refreshPublicPlayerCount } from './public-online-player-service.js';
import { findServerById, updateServer } from '../db/manager-store.js';
import { recordServerStatisticsSample } from '../db/server-statistics-store.js';
import type { ServerLiveStatusResponse } from '../dto/server-live-status-response.js';
import type { ServerConfig } from '../interfaces/server-config.js';
import { AppConfig } from '../utils/app-config.js';
import { defaultLogger } from '../utils/logger.js';
import { parseNativeAdminUtilsInfo } from './native-admin-utils-info.js';
import { fetchNativePluginJson } from './native-plugin-request-service.js';
import { fetchNativePluginList, hasNativePluginRoute } from './native-plugin-list.js';
import { publishServerLiveUpdate } from './server-live-update-service.js';
import { registerGameConnectorEventHandler } from './game-connector-websocket-service.js';
import { serializePlayerDataWrite } from './player-data-write-queue.js';
import { forgetPlayerFromServer } from './forgotten-player-service.js';
import { clearPluginDataCacheEntry } from './plugin-data-cache-service.js';

const NATIVE_ADMIN_UTILS_ROUTE = 'plugins/oz---admin-utils';

interface CacheEntry {
  expiresAt: number;
  response: ServerLiveStatusResponse;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<ServerLiveStatusResponse>>();

registerGameConnectorEventHandler(async (serverId, event, data) => {
  if (event === 'playerStatus') await serializePlayerDataWrite(serverId, () => acceptConnectorPlayerStatus(serverId, data));
  if (event === 'playerConsentRevoked') await serializePlayerDataWrite(serverId, () => acceptConnectorPlayerConsentRevoked(serverId, data));
  if (event === 'playerErasure') await serializePlayerDataWrite(serverId, () => acceptConnectorPlayerErasure(serverId, data));
});

async function acceptConnectorPlayerErasure(serverId: string, payload: unknown): Promise<void> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('INVALID_PLAYER_ERASURE');
  const { requestId, uid, dbId } = payload as { requestId?: unknown; uid?: unknown; dbId?: unknown };
  if (typeof requestId !== 'string' || !/^[0-9a-f-]{36}$/.test(requestId)) {
    throw new Error('INVALID_PLAYER_ERASURE');
  }
  await acceptConnectorPlayerConsentRevoked(serverId, { uid, dbId, purpose: 'manager' }, true);
  const { acknowledgePlayerErasure } = await import('./game-connector-websocket-service.js');
  acknowledgePlayerErasure(serverId, requestId);
}

/** An authenticated game connector can remove only a player known on its own server. */
export async function acceptConnectorPlayerConsentRevoked(serverId: string, payload: unknown, reconcileAccount = false): Promise<void> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('INVALID_CONSENT_REVOKE');
  const { uid, dbId, purpose } = payload as { uid?: unknown; dbId?: unknown; purpose?: unknown };
  if (typeof uid !== 'string' || !uid.trim() || typeof dbId !== 'number'
      || !Number.isSafeInteger(dbId) || dbId <= 0 || (purpose !== undefined && purpose !== 'manager' && purpose !== 'map'))
    throw new Error('INVALID_CONSENT_REVOKE');
  const server = await findServerById(serverId);
  if (purpose === 'map') clearPluginDataCacheEntry(serverId);
  if (!server) return;
  const ownsPlayer = server.knownPlayers?.some((player) => player.uid === uid && player.id === dbId);
  if (!ownsPlayer && (purpose === 'map' || !server.privacyPendingDeletes?.includes(uid))) return;
  if (purpose === 'map') {
    const knownPlayers = (server.knownPlayers ?? []).map((player) => player.uid === uid ? withoutPlayerLocation(player) : player);
    const onlinePlayers = (server.onlinePlayers ?? []).map((player) =>
      player && typeof player === 'object' && (player as { uid?: unknown }).uid === uid
        ? withoutPlayerLocation(player as Record<string, unknown>) : player);
    await updateServer(server.id, { knownPlayers, onlinePlayers });
    clearPluginDataCacheEntry(server.id);
    cache.delete(server.id);
    publishServerLiveUpdate(server.id, { ...storedLiveStatusResponse(server), onlinePlayers });
    return;
  }
  const knownPlayers = (server.knownPlayers ?? []).filter((player) => player.uid !== uid);
  const onlinePlayers = (server.onlinePlayers ?? []).filter((player) =>
    !player || typeof player !== 'object' || (player as { uid?: unknown }).uid !== uid);
  const privacyPendingDeletes = [...new Set([...(server.privacyPendingDeletes ?? []), uid])];
  await updateServer(server.id, { knownPlayers, onlinePlayers, privacyPendingDeletes });
  clearPluginDataCacheEntry(server.id);
  await forgetPlayerFromServer(server.id, uid);
  if (reconcileAccount && /^\d{17}$/.test(uid)) {
    const { revokeManagerAccountIfDenied } = await import('./manager-access-service.js');
    await revokeManagerAccountIfDenied(uid);
  }
  await updateServer(server.id, { privacyPendingDeletes: privacyPendingDeletes.filter((pending) => pending !== uid) });
  cache.delete(server.id);
  publishServerLiveUpdate(server.id, { ...storedLiveStatusResponse(server), onlinePlayers });
}

function withoutPlayerLocation<T extends object>(player: T): T {
  const result = { ...player } as Record<string, unknown>;
  for (const key of ['posx', 'posy', 'posz', 'rotx', 'roty', 'rotz', 'rotw',
    'primaryspawn', 'secondaryspawn', 'tertiaryspawn', 'lastspawn', 'position', 'lastPosition']) {
    delete result[key];
  }
  return result as T;
}

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
    publicPlayerCount: status === 'online' ? cachedPublicPlayerCount(server) : undefined,
    errorMessage: stringOrUndefined(server.errorMessage),
  };
}

async function persistLiveStatus(server: ServerConfig, response: ServerLiveStatusResponse): Promise<void> {
  const latest = await findServerById(server.id);
  if (!latest) return;
  let changed = false;

  if (response.queryData !== undefined) {
    server.data = response.queryData;
    changed = true;
  }

  server.status = response.status;
  server.lastChecked = new Date(response.lastChecked);
  server.errorMessage = response.errorMessage;
  // An offline server cannot retain a stale player list in storage or statistics.
  server.onlinePlayers = response.status === 'offline' ? [] : latest.onlinePlayers;
  response.onlinePlayers = server.onlinePlayers;
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
      queryDataUpdatedAt: server.queryDataUpdatedAt,
    });
    publishServerLiveUpdate(server.id, response);
  }
}

export async function getStoredServerLiveStatus(serverId: string): Promise<ServerLiveStatusResponse> {
  const server = await findServerById(serverId);
  if (!server) throw new Error('SERVER_NOT_FOUND');
  if (!server.queryUrl) throw new Error('QUERY_URL_MISSING');
  if (storedLiveStatusResponse(server).status === 'online') await refreshPublicPlayerCount(server);
  return storedLiveStatusResponse(server);
}

async function fetchLiveStatus(server: ServerConfig): Promise<ServerLiveStatusResponse> {
  const queryUrl = server.queryUrl;
  const startedAt = Date.now();
  defaultLogger.debug(`Live server query started: ${queryUrl}`);
  const [queryResult, infoResult, plugins] = await Promise.all([
    fetchJson(queryUrl),
    fetchJson(buildInfoUrl(queryUrl), AppConfig.liveQueryProxyTimeoutMs),
    fetchNativePluginList(queryUrl, AppConfig.liveQueryProxyTimeoutMs),
  ]);
  const nativeInfoResult = hasNativePluginRoute(plugins, 'oz---admin-utils')
    ? await fetchNativePluginJson(server, buildNativeAdminUtilsInfoUrl(queryUrl))
    : { ok: false as const, error: 'PLUGIN_NOT_EXPOSED' };

  const lastChecked = new Date().toISOString() as ServerLiveStatusResponse['lastChecked'];
  const response: ServerLiveStatusResponse = {
    status: queryResult.ok ? 'online' : 'offline',
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
  response.onlinePlayers = response.status === 'offline' ? [] : server.onlinePlayers;
  if (response.status === 'online') {
    response.publicPlayerCount = await refreshPublicPlayerCount({ ...server, status: 'online' });
  } else clearPublicPlayerCount(server.id);

  defaultLogger.debug('Live server query completed:', {
    queryUrl,
    status: response.status,
    durationMs: Date.now() - startedAt,
  });
  return response;
}

function playerCountFromLiveStatus(response: ServerLiveStatusResponse): number {
  if (response.status === 'offline') return 0;
  const queryCount = numberFromPayload(response.queryData, 'playercount');
  return queryCount ?? response.publicPlayerCount ?? response.onlinePlayers?.length ?? 0;
}

/** Accepts only a complete, bounded runtime player-list snapshot from the authenticated game connector. */
export async function acceptConnectorPlayerStatus(serverId: string, payload: unknown): Promise<void> {
  const players = connectorOnlinePlayers(payload);
  if (players === undefined) throw new Error('INVALID_PLAYER_STATUS');
  clearPublicPlayerCount(serverId);
  const server = await findServerById(serverId);
  if (!server) return;
  const lastChecked = new Date();
  server.onlinePlayers = players;
  server.status = 'online';
  server.lastChecked = lastChecked;
  server.errorMessage = undefined;
  await updateServer(server.id, {
    onlinePlayers: server.onlinePlayers,
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
  const value = payload as { schemaVersion?: unknown; consentVersion?: unknown; players?: unknown };
  if (value.schemaVersion !== 1 || value.consentVersion !== 1
      || !Array.isArray(value.players) || value.players.length > 500) return undefined;
  const players = value.players.filter((player): player is Record<string, unknown> => (
    !!player && typeof player === 'object' && !Array.isArray(player)
    && typeof (player as { uid?: unknown }).uid === 'string'
    && typeof (player as { dbId?: unknown }).dbId === 'number'
    && Number.isSafeInteger((player as { dbId: number }).dbId)
    && (player as { dbId: number }).dbId > 0
  ));
  if (players.length !== value.players.length) return undefined;
  return players.filter((player) => player.connected !== false)
    .map((player) => ({ ...player, slotId: player.id, id: player.dbId }));
}

export async function refreshDueServerPlayerLists(): Promise<{ checked: number; refreshed: number }> {
  // Public counts are refreshed with server status. No separate scheduler is needed.
  return { checked: 0, refreshed: 0 };
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
    const response = await getStoredServerLiveStatus(serverId);
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
        serverId: server.id,
        sampledAt: new Date(response.lastChecked),
        online: response.status === 'online',
        playerCount: playerCountFromLiveStatus(response),
        onlinePlayerUids: response.status === 'offline' ? [] : onlinePlayerUids(response.onlinePlayers),
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
}

/** Removes in-memory status for a catalog record that was pruned after a successful master-list refresh. */
export function clearServerLiveStatusCacheEntry(serverId: string): void {
  cache.delete(serverId);
  inflight.delete(serverId);
  clearPublicPlayerCount(serverId);
}
