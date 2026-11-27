import { cachedPublicPlayerCount, clearPublicPlayerCount, readPublicOnlinePlayers, refreshPublicPlayerCount } from './public-online-player-service.js';
import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import {
  findServerByMasterEndpoint,
  findServerById,
  isReservedServerId,
  listServers,
  removeStaleMasterServers,
  replacePinnedServerId,
  saveMasterServer,
  saveServer,
} from '../db/manager-store.js';
import { recordServerStatisticsSample } from '../db/server-statistics-store.js';
import { recordGlobalPlayerSample } from '../db/global-player-statistics-store.js';
import type { MasterServerListEntry, MasterServerListResponse } from '../interfaces/master-server-list.js';
import type { ServerConfig } from '../interfaces/server-config.js';
import { AppConfig } from '../utils/app-config.js';
import { defaultLogger } from '../utils/logger.js';
import { parseNativeAdminUtilsInfo } from './native-admin-utils-info.js';
import { fetchNativePluginJson } from './native-plugin-request-service.js';
import { fetchNativePluginList, hasNativePluginRoute } from './native-plugin-list.js';
import { clearServerLiveStatusCacheEntry, storedLiveStatusResponse } from './server-live-status-service.js';
import { closeGameConnectorSession } from './game-connector-websocket-service.js';
import { cachedMasterObservations, replaceMasterOnlyCache } from './master-only-cache-service.js';
import { isServerSuppressed } from './server-suppression-service.js';
export { cachedMasterServers, clearMasterOnlyCache } from './master-only-cache-service.js';
import { publishServerLiveUpdate } from './server-live-update-service.js';
import { observedPlayerCount, playerObservation, serverObservationKeys, totalObservedPlayers, type PlayerObservation } from './global-player-observation.js';
import { refreshMasterOnlyLive } from './master-only-live-service.js';

const STEAM_ID_PATTERN = /^\d{17}$/;
const NATIVE_ADMIN_UTILS_ROUTE = 'plugins/oz---admin-utils';

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

function playerCountFromQueryData(queryData: unknown, onlinePlayers: unknown[] | undefined, publicCount?: number): number {
  return numberFromPayload(queryData, 'playercount')
    ?? numberFromPayload(queryData, 'players')
    ?? publicCount
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

async function fetchJson(url: string, authorization?: string): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  try {
    const response = await fetch(url, {
      headers: authorization ? { Authorization: authorization } : undefined,
      signal: AbortSignal.timeout(AppConfig.liveQueryProxyTimeoutMs),
    });
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

async function refreshQueryData(server: ServerConfig, now: Date, requireExisting = false, collectGlobal = false): Promise<false | { observation?: PlayerObservation }> {
  if (!server.queryUrl || !shouldRefreshQueryData(server, now)) return false;

  const [data, info, plugins] = await Promise.all([
    fetchJson(server.queryUrl),
    fetchJson(new URL('info', `${server.queryUrl.replace(/\/+$/, '')}/`).toString()),
    fetchNativePluginList(server.queryUrl, AppConfig.liveQueryProxyTimeoutMs),
  ]);
  const nativeInfo = hasNativePluginRoute(plugins, 'oz---admin-utils')
    ? await fetchNativePluginJson(server, new URL(`${NATIVE_ADMIN_UTILS_ROUTE}/info`, `${server.queryUrl.replace(/\/+$/, '')}/`).toString())
    : { ok: false as const, error: 'PLUGIN_NOT_EXPOSED' };

  // A merge may remove this source while its network requests are in flight.
  if (requireExisting && (await findServerById(server.id))?.id !== server.id) return false;

  server.status = data.ok ? 'online' : 'offline';
  server.lastChecked = now;
  server.errorMessage = data.ok ? undefined : data.error;
  if (data.ok) server.data = data.data;
  if (info.ok) {
    server.info = info.data;
    const name = info.data && typeof info.data === 'object'
      ? stringOrUndefined((info.data as { name?: unknown }).name) : undefined;
    if (name) server.label = name;
  }
  if (nativeInfo.ok) {
    const parsedNativeInfo = parseNativeAdminUtilsInfo(nativeInfo.data);
    server.adminUid = parsedNativeInfo?.adminUid ?? server.adminUid;
    server.mapUrl = parsedNativeInfo?.mapUrl ?? server.mapUrl;
  }
  let observation: PlayerObservation | undefined;
  if (server.status === 'offline') {
    server.onlinePlayers = [];
    clearPublicPlayerCount(server.id);
  } else {
    const payload = data.ok ? data.data : undefined;
    const count = observedPlayerCount(payload);
    const roster = collectGlobal && count !== 0 ? readPublicOnlinePlayers(server) : undefined;
    await refreshPublicPlayerCount(server, roster);
    if (collectGlobal) observation = playerObservation(count, await roster ?? null);
  }
  server.queryDataUpdatedAt = now;

  await recordServerStatisticsSample({
    serverId: server.id,
    sampledAt: now,
    online: server.status === 'online',
    playerCount: server.status === 'offline' ? 0 : playerCountFromQueryData(server.data, server.onlinePlayers, cachedPublicPlayerCount(server)),
    onlinePlayerUids: server.status === 'offline' ? [] : onlinePlayerUids(server.onlinePlayers),
  });

  // A completed attempt also produces a meaningful offline snapshot when all
  // three game-server endpoints fail. Persist and publish that transition.
  return { observation };
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
  // The master list supplies a useful default only. A query URL deliberately
  // configured by an administrator may point at a reverse-proxy prefix.
  if (!server.queryUrlExplicit) server.queryUrl = queryUrl ?? server.queryUrl;
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
    if (!response?.successful) {
      return { fetched: 0, inserted: 0, updated: 0, refreshed: 0 };
    }
    const entries = Array.isArray(response?.data)
      ? response.data as MasterServerListEntry[]
      : [];
    const infoByQueryUrl = new Map<string, Awaited<ReturnType<typeof fetchJson>>>();
    const queryUrls = [...new Set(entries.map(queryUrlFor).filter((url): url is string => !!url))];
    for (let offset = 0; offset < queryUrls.length; offset += 8) {
      await Promise.all(queryUrls.slice(offset, offset + 8).map(async (queryUrl) => {
        infoByQueryUrl.set(queryUrl,
          await fetchJson(new URL('info', `${queryUrl.replace(/\/+$/, '')}/`).toString()));
      }));
    }

    let inserted = 0;
    let updated = 0;
    let refreshed = 0;
    const nextCache = new Map<string, ServerConfig>();

    const entriesById = new Map<string, MasterServerListEntry>();
    for (const entry of entries) {
      const id = serverIdFor(entry);
      if (id && queryUrlFor(entry)) entriesById.set(id, entry);
    }
    for (const [serverId, entry] of entriesById) {
      const queryUrl = queryUrlFor(entry);
      if (!queryUrl) continue;
      const ip = stringOrUndefined(entry.ip);
      const port = numberOrUndefined(entry.port);
      if (!ip || port === undefined) continue;
      if (await isServerSuppressed(ip, port, queryUrl)) continue;

      let server = await findServerByMasterEndpoint(ip, port);
      const allowCreate = !server;
      if (!server) {
        const id = await isReservedServerId(serverId) ? randomUUID() : serverId;
        server = {
          id,
          label: id,
          catalogIdPinned: id !== serverId,
          queryUrl,
          public: true,
          createdAt: now,
          firstSeen: now,
          lastSeen: now,
        };
      } else {
        // A merged catalog record retains its oldest identity across refreshes.
        // Migrate only legacy IDs that have not been deliberately aliased.
        if (server.id !== serverId && !server.catalogIdPinned) {
          await replacePinnedServerId(server.id, serverId);
          server.id = serverId;
        }
        updated += 1;
      }

      applyMasterEntry(server, entry, now);
      // Keep the current /info contact in memory for every master-list entry,
      // including servers that have not opted in yet.
      const info = infoByQueryUrl.get(queryUrl) ?? { ok: false as const, error: 'FETCH_FAILED' };
      if (info.ok && info.data && typeof info.data === 'object') {
        server.info = info.data;
        const name = stringOrUndefined((info.data as { name?: unknown }).name);
        if (name) server.label = name;
      }
      if (allowCreate) {
        // The public master list is a display source, not permission to retain
        // server data. The description marker is one independent opt-in path.
        if (!info.ok || typeof info.data !== 'object' || !info.data ||
            typeof (info.data as { description?: unknown }).description !== 'string' ||
            !(info.data as { description: string }).description.includes('[rw-servers]')) {
          nextCache.set(server.id, server);
          continue;
        }
        inserted += 1;
      }
      const queryRefreshed = options.refreshQueryData && await refreshQueryData(server, now, !allowCreate);
      if (queryRefreshed) {
        refreshed += 1;
      }
      await saveMasterServer(server, allowCreate);
      if (queryRefreshed) publishServerLiveUpdate(server.id, storedLiveStatusResponse(server));
    }
    replaceMasterOnlyCache(nextCache);

    // A successful fetch is authoritative for catalog presence. Failed fetches
    // never reach this point, so transient master-list outages cannot prune data.
    const staleIds = await removeStaleMasterServers(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000));
    for (const serverId of staleIds) {
      clearServerLiveStatusCacheEntry(serverId);
      closeGameConnectorSession(serverId);
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

export async function refreshAllServerQueryData(collectGlobal = false): Promise<MasterServerListSyncResult> {
  const startedAt = Date.now();
  defaultLogger.debug('Server query data refresh started');
  try {
    let refreshed = 0;
    if (collectGlobal && masterServerListRefreshInFlight && cachedMasterObservations().length === 0) {
      // Let initial discovery contribute to the first scheduled sample.
      await masterServerListRefreshInFlight.catch(() => undefined);
      await refreshMasterOnlyLive();
    }
    const servers = await listServers();
    const now = new Date();
    const transient = collectGlobal ? cachedMasterObservations(servers) : [];
    const observed: Array<{ server: ServerConfig; value: PlayerObservation }> = [];
    for (const server of servers) {
      const didRefresh = await refreshQueryData(server, now, true, collectGlobal);
      let value = didRefresh ? didRefresh.observation : undefined;
      if (didRefresh) {
        refreshed += 1;
        await saveServer(server);
        publishServerLiveUpdate(server.id, storedLiveStatusResponse(server));
      } else if (collectGlobal && server.status === 'online' && !server.errorMessage &&
        server.lastChecked && server.queryDataUpdatedAt &&
        new Date(server.lastChecked).getTime() === new Date(server.queryDataUpdatedAt).getTime() &&
        !shouldRefreshQueryData(server, now)) {
        // An on-demand check may already have refreshed this server for this interval.
        const count = observedPlayerCount(server.data);
        value = playerObservation(count, count === 0 ? null : await readPublicOnlinePlayers(server));
      }
      if (value) observed.push({ server, value });
    }
    if (collectGlobal) {
      for (const { server, live } of transient) {
        if (live?.observation) observed.push({ server, value: live.observation });
      }
      const keys = new Set<string>();
      const observations = observed.flatMap(({ server, value }) => {
        const candidateKeys = serverObservationKeys(server);
        const duplicate = candidateKeys.some(key => keys.has(key));
        candidateKeys.forEach(key => keys.add(key));
        return duplicate ? [] : [value];
      });
      const total = totalObservedPlayers(observations);
      if (total !== undefined) await recordGlobalPlayerSample(now, total);
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
