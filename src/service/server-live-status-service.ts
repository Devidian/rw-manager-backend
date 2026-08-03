import { findServerById, updateServer } from '../db/manager-store.js';
import { recordServerStatisticsSample } from '../db/server-statistics-store.js';
import type { ServerLiveStatusResponse } from '../dto/server-live-status-response.js';
import type { ServerConfig } from '../interfaces/server-config.js';
import { AppConfig } from '../utils/app-config.js';
import { defaultLogger } from '../utils/logger.js';
import { mergeKnownPlayers, observedPlayersFromValues } from './observed-player-service.js';
import { publishServerLiveUpdate } from './server-live-update-service.js';

const MAP_URL_PATTERN = /@mapUrl\s*:\s*(?:\[\s*([^\]\s]+)\s*]|(\S+))/i;
const QUERY_URL_PATTERN = /@queryUrl\s*:\s*(?:\[\s*([^\]\s]+)\s*]|(\S+))/i;

interface CacheEntry {
  expiresAt: number;
  response: ServerLiveStatusResponse;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<ServerLiveStatusResponse>>();

async function fetchJson(
  url: string,
  timeoutMs: number = AppConfig.liveQueryProxyTimeoutMs,
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
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

function buildPlayerListUrl(queryUrl: string): string {
  return new URL('playerlist', `${queryUrl.replace(/\/+$/, '')}/`).toString();
}

function normalizedUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).toString();
  } catch {
    return undefined;
  }
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

function mapUrlFromInfo(info: unknown): string | undefined {
  if (!info || typeof info !== 'object') return undefined;
  const description = stringOrUndefined((info as { description?: unknown }).description);
  const match = description?.match(MAP_URL_PATTERN);
  if (!match) return undefined;
  return normalizedUrl(match[1] ?? match[2]);
}

function queryUrlFromInfo(info: unknown): string | undefined {
  if (!info || typeof info !== 'object') return undefined;
  const description = stringOrUndefined((info as { description?: unknown }).description);
  const match = description?.match(QUERY_URL_PATTERN);
  if (!match) return undefined;
  return normalizedUrl(match[1] ?? match[2]);
}

async function reachableQueryUrl(candidate: string): Promise<boolean> {
  const result = await fetchJson(candidate);
  return result.ok;
}

async function selectQueryUrl(derivedQueryUrl: string): Promise<{
  queryUrl: string;
  infoData?: unknown;
}> {
  const infoResult = await fetchJson(buildInfoUrl(derivedQueryUrl));
  if (!infoResult.ok) return { queryUrl: derivedQueryUrl };

  const override = queryUrlFromInfo(infoResult.data);
  if (!override || override === derivedQueryUrl) {
    return { queryUrl: derivedQueryUrl, infoData: infoResult.data };
  }
  if (await reachableQueryUrl(override)) {
    return { queryUrl: override, infoData: infoResult.data };
  }
  defaultLogger.warn('Ignoring unreachable query URL override:', {
    derivedQueryUrl,
    override,
  });
  return { queryUrl: derivedQueryUrl, infoData: infoResult.data };
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
    server.label = stringOrUndefined((response.infoData as { shortname?: unknown }).shortname) ?? server.label;
    server.mapUrl = mapUrlFromInfo(response.infoData) ?? server.mapUrl;
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

async function fetchLiveStatus(queryUrl: string): Promise<ServerLiveStatusResponse> {
  const startedAt = Date.now();
  const selected = await selectQueryUrl(queryUrl);
  defaultLogger.debug(`Live server query started: ${selected.queryUrl}`);
  const [queryResult, infoResult, playerlistResult] = await Promise.all([
    fetchJson(selected.queryUrl),
    selected.infoData === undefined
      ? fetchJson(buildInfoUrl(selected.queryUrl))
      : Promise.resolve({ ok: true, data: selected.infoData } as const),
    fetchJson(buildPlayerListUrl(selected.queryUrl), AppConfig.playerListTimeoutMs),
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
  if (onlinePlayers !== undefined) response.onlinePlayers = onlinePlayers;

  defaultLogger.debug('Live server query completed:', {
    queryUrl: selected.queryUrl,
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

  const request = fetchLiveStatus(server.queryUrl)
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
}
