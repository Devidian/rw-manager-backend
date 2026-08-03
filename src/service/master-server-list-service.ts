import { createHash } from 'node:crypto';
import {
  findServerByMasterEndpoint,
  listServers,
  replacePinnedServerId,
  saveMasterServer,
  saveServer,
} from '../db/manager-store.js';
import { recordServerStatisticsSample } from '../db/server-statistics-store.js';
import type { MasterServerListEntry, MasterServerListResponse } from '../interfaces/master-server-list.js';
import type { ServerConfig } from '../interfaces/server-config.js';
import { AppConfig } from '../utils/app-config.js';
import { defaultLogger } from '../utils/logger.js';
import { mergeKnownPlayers, observedPlayersFromValues } from './observed-player-service.js';
import { storedLiveStatusResponse } from './server-live-status-service.js';
import { publishServerLiveUpdate } from './server-live-update-service.js';

const STEAM_ID_PATTERN = /^\d{17}$/;
const MAP_URL_PATTERN = /@mapUrl\s*:\s*(?:\[\s*([^\]\s]+)\s*]|(\S+))/i;

export interface MasterServerListSyncResult {
  fetched: number;
  inserted: number;
  updated: number;
  refreshed: number;
  skipped?: boolean;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function booleanOrUndefined(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function steamIdOrUndefined(value: unknown): string | undefined {
  const serialized =
    typeof value === 'number' && Number.isFinite(value)
      ? String(value)
      : stringOrUndefined(value);
  return serialized && STEAM_ID_PATTERN.test(serialized) ? serialized : undefined;
}

function mapUrlFromInfo(info: unknown): string | undefined {
  if (!info || typeof info !== 'object') return undefined;
  const description = stringOrUndefined((info as { description?: unknown }).description);
  const match = description?.match(MAP_URL_PATTERN);
  if (!match) return undefined;
  try {
    return new URL(match[1] ?? match[2]).toString();
  } catch {
    return undefined;
  }
}

function adminUidFromInfo(info: unknown): string | undefined {
  if (!info || typeof info !== 'object') return undefined;
  return steamIdOrUndefined((info as { contact?: unknown }).contact);
}

function labelFromInfo(info: unknown): string | undefined {
  if (!info || typeof info !== 'object') return undefined;
  return stringOrUndefined((info as { shortname?: unknown }).shortname);
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

function playerCountFromQueryData(queryData: unknown, onlinePlayers: unknown[] | undefined): number {
  return numberFromPayload(queryData, 'playercount')
    ?? numberFromPayload(queryData, 'players')
    ?? onlinePlayers?.length
    ?? 0;
}

function queryUrlFor(entry: MasterServerListEntry): string | undefined {
  const ip = stringOrUndefined(entry.ip);
  const port = numberOrUndefined(entry.port);
  if (!ip || port === undefined || port <= 1) return undefined;
  return `http://${ip}:${port - 1}`;
}

function serverIdFor(entry: MasterServerListEntry): string | undefined {
  const ip = stringOrUndefined(entry.ip);
  const port = numberOrUndefined(entry.port);
  if (!ip || port === undefined || port <= 0) return undefined;
  const hash = createHash('sha256').update(`${ip}:${port}`).digest('hex').slice(0, 24);
  return `server-${hash}`;
}

function shouldRefreshQueryData(server: ServerConfig, now: Date): boolean {
  if (!server.queryDataUpdatedAt) return true;
  const previous = new Date(server.queryDataUpdatedAt).getTime();
  if (Number.isNaN(previous)) return true;
  return now.getTime() - previous >= AppConfig.serverQueryRefreshIntervalMs;
}

async function fetchJson(url: string): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  try {
    const response = await fetch(url);
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
    return { ok: true, data: await response.json() };
  } catch {
    return { ok: false, error: 'FETCH_FAILED' };
  }
}

async function fetchMasterServerList(): Promise<MasterServerListResponse | undefined> {
  try {
    const response = await fetch(AppConfig.masterServerListUrl, {
      signal: AbortSignal.timeout(AppConfig.masterServerListTimeoutMs),
    });
    if (!response.ok) return undefined;
    const text = await response.text();
    return JSON.parse(
      text.replace(/("steamid"\s*:\s*)(\d{15,20})/g, '$1"$2"'),
    ) as MasterServerListResponse;
  } catch {
    return undefined;
  }
}

async function refreshQueryData(server: ServerConfig, now: Date): Promise<boolean> {
  if (!server.queryUrl || !shouldRefreshQueryData(server, now)) return false;

  const [data, info, playerlist] = await Promise.all([
    fetchJson(server.queryUrl),
    fetchJson(new URL('info', `${server.queryUrl.replace(/\/+$/, '')}/`).toString()),
    fetchJson(new URL('playerlist', `${server.queryUrl.replace(/\/+$/, '')}/`).toString()),
  ]);

  server.status = data.ok ? 'online' : 'offline';
  server.lastChecked = now;
  server.errorMessage = data.ok ? undefined : data.error;
  if (data.ok) server.data = data.data;
  if (info.ok) {
    server.info = info.data;
    server.label = labelFromInfo(info.data) ?? server.label;
    server.adminUid = adminUidFromInfo(info.data) ?? server.adminUid;
    server.mapUrl = mapUrlFromInfo(info.data) ?? server.mapUrl;
  }
  server.onlinePlayers = playerlist.ok ? playersFromPayload(playerlist.data) : undefined;
  server.knownPlayers = mergeKnownPlayers(
    server.knownPlayers,
    observedPlayersFromValues(server.onlinePlayers, now),
  );
  server.queryDataUpdatedAt = now;

  await recordServerStatisticsSample({
    serverId: server.id,
    sampledAt: now,
    online: server.status === 'online',
    playerCount: playerCountFromQueryData(server.data, server.onlinePlayers),
    onlinePlayerUids: onlinePlayerUids(server.onlinePlayers),
  });

  // A completed attempt also produces a meaningful offline snapshot when all
  // three game-server endpoints fail. Persist and publish that transition.
  return true;
}

function applyMasterEntry(server: ServerConfig, entry: MasterServerListEntry, now: Date): void {
  const steamId = steamIdOrUndefined(entry.steamid);
  const queryUrl = queryUrlFor(entry);
  const name = stringOrUndefined(entry.name);

  if (steamId) server.steamId = steamId;
  server.addr = stringOrUndefined(entry.addr) ?? server.addr;
  server.version = stringOrUndefined(entry.version) ?? server.version;
  server.name = name ?? server.name;
  server.ip = stringOrUndefined(entry.ip) ?? server.ip;
  server.port = numberOrUndefined(entry.port) ?? server.port;
  server.region = stringOrUndefined(entry.region) ?? server.region;
  server.gm = numberOrUndefined(entry.gm) ?? server.gm;
  server.mods = booleanOrUndefined(entry.mods) ?? server.mods;
  server.password = booleanOrUndefined(entry.password) ?? server.password;
  server.whitelist = booleanOrUndefined(entry.whitelist) ?? server.whitelist;
  server.queryUrl = queryUrl ?? server.queryUrl;
  server.lastSeen = now;
}

let masterServerListRefreshInFlight: Promise<MasterServerListSyncResult> | null = null;

async function runMasterServerListRefresh(options: {
  refreshQueryData?: boolean;
} = {}): Promise<MasterServerListSyncResult> {
  const startedAt = Date.now();
  defaultLogger.debug('Master server list refresh started:', {
    refreshQueryData: options.refreshQueryData === true,
  });
  const now = new Date();
  try {
    const response = await fetchMasterServerList();
    const entries = Array.isArray(response?.data)
      ? response.data as MasterServerListEntry[]
      : [];

    let inserted = 0;
    let updated = 0;
    let refreshed = 0;

    for (const entry of entries) {
      const queryUrl = queryUrlFor(entry);
      const serverId = serverIdFor(entry);
      if (!serverId || !queryUrl) continue;
      const ip = stringOrUndefined(entry.ip);
      const port = numberOrUndefined(entry.port);
      if (!ip || port === undefined) continue;

      let server = await findServerByMasterEndpoint(ip, port);
      if (!server) {
        server = {
          id: serverId,
          label: serverId,
          queryUrl,
          public: true,
          createdAt: now,
          firstSeen: now,
          lastSeen: now,
        };
        inserted += 1;
      } else {
        await replacePinnedServerId(server.id, serverId);
        server.id = serverId;
        updated += 1;
      }

      applyMasterEntry(server, entry, now);
      const queryRefreshed = options.refreshQueryData && await refreshQueryData(server, now);
      if (queryRefreshed) {
        refreshed += 1;
      }
      await saveMasterServer(server);
      if (queryRefreshed) publishServerLiveUpdate(server.id, storedLiveStatusResponse(server));
    }

    const result = { fetched: entries.length, inserted, updated, refreshed };
    defaultLogger.debug('Master server list refresh completed:', {
      ...result,
      durationMs: Date.now() - startedAt,
    });
    return result;
  } catch (error) {
    defaultLogger.error('Master server list refresh failed:', error);
    throw error;
  }
}

export async function refreshMasterServerList(options: {
  refreshQueryData?: boolean;
} = {}): Promise<MasterServerListSyncResult> {
  if (masterServerListRefreshInFlight) {
    defaultLogger.warn('Master server list refresh skipped because another refresh is still running');
    return { fetched: 0, inserted: 0, updated: 0, refreshed: 0, skipped: true };
  }

  const request = runMasterServerListRefresh(options).finally(() => {
    if (masterServerListRefreshInFlight === request) {
      masterServerListRefreshInFlight = null;
    }
  });
  masterServerListRefreshInFlight = request;
  return request;
}

export async function refreshAllServerQueryData(): Promise<MasterServerListSyncResult> {
  const startedAt = Date.now();
  defaultLogger.debug('Server query data refresh started');
  const now = new Date();
  try {
    let refreshed = 0;
    const servers = await listServers();
    for (const server of servers) {
      if (await refreshQueryData(server, now)) {
        refreshed += 1;
        await saveServer(server);
        publishServerLiveUpdate(server.id, storedLiveStatusResponse(server));
      }
    }
    const result = { fetched: servers.length, inserted: 0, updated: 0, refreshed };
    defaultLogger.debug('Server query data refresh completed:', {
      ...result,
      durationMs: Date.now() - startedAt,
    });
    return result;
  } catch (error) {
    defaultLogger.error('Server query data refresh failed:', error);
    throw error;
  }
}

export function startMasterServerListSync(): { stop: () => void } | null {
  if (!AppConfig.enableStorage) return null;

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(run, AppConfig.masterServerListRefreshIntervalMs);
  };

  const run = () => {
    void refreshMasterServerList({ refreshQueryData: true })
      .catch((error) => {
        defaultLogger.error('Master server list refresh failed:', error);
      })
      .finally(schedule);
  };

  run();

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
