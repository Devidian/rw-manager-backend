import type { ServerConfig } from '../interfaces/server-config.js';
import { AppConfig } from '../utils/app-config.js';
import { defaultLogger } from '../utils/logger.js';
import { listServers, updateServer } from '../db/manager-store.js';
import { parseNativeAdminUtilsInfo } from './native-admin-utils-info.js';
import {
  nativePluginRouteId,
  parseNativePluginList,
  type QueryPluginInfo,
} from './native-plugin-list.js';

export type { QueryPluginInfo } from './native-plugin-list.js';

export interface PluginDataCacheEntry {
  serverId: string;
  refreshedAtMs: number;
  expiresAtMs: number;
  plugins: QueryPluginInfo[];
  data: Record<string, unknown>;
}

export interface PluginDataRefreshResult {
  refreshed: boolean;
  skippedReason?: 'queryUrlMissing' | 'pluginListUnavailable';
  entry?: PluginDataCacheEntry;
}

export interface PluginDataRefreshAllResult {
  checked: number;
  refreshed: number;
  skipped: number;
}

/**
 * The bridge marks only fresh Admin Utils samples as online.  This is more
 * current than the game query endpoint's player list and becomes an empty
 * array immediately after a disconnect.
 */
export function liveOnlinePlayersFromEntry(entry: PluginDataCacheEntry): unknown[] | undefined {
  const payload = entry.data['ozadminutils.playerlist'];
  if (!payload || typeof payload !== 'object') return undefined;
  const players = (payload as { players?: unknown }).players;
  if (!Array.isArray(players)) return undefined;
  return players.filter((player) =>
    !!player && typeof player === 'object' && (player as { online?: unknown }).online === true,
  );
}

interface RouteSpec {
  key: string;
  pluginRouteId: string;
  path: string;
}

const routeSpecs: RouteSpec[] = [
  {
    key: 'ozadminutils.worldAreas',
    pluginRouteId: 'oz---admin-utils',
    path: 'world-areas',
  },
  {
    key: 'ozadminutils.playerlist',
    pluginRouteId: 'oz---admin-utils',
    path: 'playerlist',
  },
  {
    key: 'ozadminutils.serverConfig',
    pluginRouteId: 'oz---admin-utils',
    path: 'server-config',
  },
  {
    key: 'ozgps.globalMarkers',
    pluginRouteId: 'oz---gps',
    path: 'marker?type=global',
  },
  {
    key: 'ozmarketplace.zones',
    pluginRouteId: 'oz---marketplace',
    path: 'zones',
  },
  {
    key: 'ozshop.zones',
    pluginRouteId: 'oz---shop',
    path: 'zones',
  },
  {
    key: 'ozlandclaim.claimSales',
    pluginRouteId: 'oz---land-claim',
    path: 'claim-sales',
  },
  {
    key: 'ozlandclaim.renewZones',
    pluginRouteId: 'oz---land-claim',
    path: 'renew-zones',
  },
  {
    key: 'ozadminutils.info',
    pluginRouteId: 'oz---admin-utils',
    path: 'info',
  },
];

const cache = new Map<string, PluginDataCacheEntry>();

export function getCachedPluginData(serverId: string): PluginDataCacheEntry | undefined {
  const entry = cache.get(serverId);
  if (!entry || entry.expiresAtMs <= Date.now()) {
    if (entry) cache.delete(serverId);
    return undefined;
  }
  return entry;
}

export function getFirstCachedPluginData(): PluginDataCacheEntry | undefined {
  return [...cache.values()]
    .filter((entry) => entry.expiresAtMs > Date.now())
    .sort((a, b) => b.refreshedAtMs - a.refreshedAtMs)[0];
}

export function clearPluginDataCache(): void {
  cache.clear();
}

export async function refreshPluginDataForServer(
  server: ServerConfig,
): Promise<PluginDataRefreshResult> {
  const pluginQueryUrl = normalizedUrl(server.queryUrl);
  if (!pluginQueryUrl) {
    return { refreshed: false, skippedReason: 'queryUrlMissing' };
  }

  const plugins = await fetchPluginList(pluginQueryUrl);
  if (!plugins) {
    return { refreshed: false, skippedReason: 'pluginListUnavailable' };
  }

  const availablePlugins = new Set(
    plugins
      .filter((plugin) => plugin.valid)
      .flatMap((plugin) => plugin.name ? [nativePluginRouteId(plugin.name)] : []),
  );
  const data = Object.fromEntries(
    (await Promise.all(
      routeSpecs
        .filter((spec) => availablePlugins.has(spec.pluginRouteId))
        .map(async (spec) => [
          spec.key,
          await fetchPluginRoute(pluginQueryUrl, `plugins/${spec.pluginRouteId}/${spec.path}`),
        ] as const),
    )).filter((entry): entry is readonly [string, unknown] => entry[1] !== undefined),
  );
  Object.assign(data, await fetchMarketplaceOffersByArea(pluginQueryUrl, data['ozmarketplace.zones']));
  const nativeInfo = parseNativeAdminUtilsInfo(data['ozadminutils.info']);
  if (nativeInfo && (server.mapUrl !== nativeInfo.mapUrl || server.adminUid !== nativeInfo.adminUid)) {
    await updateServer(server.id, { mapUrl: nativeInfo.mapUrl, adminUid: nativeInfo.adminUid });
  }
  const liveOnlinePlayers = liveOnlinePlayersFromEntry({
    serverId: server.id,
    refreshedAtMs: 0,
    expiresAtMs: 0,
    plugins,
    data,
  });
  data.__onlinePlayers = liveOnlinePlayers ?? server.onlinePlayers;

  const now = Date.now();
  const entry: PluginDataCacheEntry = {
    serverId: server.id,
    refreshedAtMs: now,
    expiresAtMs: now + AppConfig.pluginDataCacheTtlMs,
    plugins,
    data,
  };
  cache.set(server.id, entry);
  return { refreshed: true, entry };
}

function normalizedUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).toString();
  } catch {
    return undefined;
  }
}

export async function ensurePluginDataForServer(
  server: ServerConfig,
  maximumAgeMs?: number,
): Promise<PluginDataCacheEntry | undefined> {
  const cached = getCachedPluginData(server.id);
  if (cached && (maximumAgeMs === undefined || Date.now() - cached.refreshedAtMs < maximumAgeMs)) return cached;
  return (await refreshPluginDataForServer(server)).entry;
}

async function fetchMarketplaceOffersByArea(
  queryUrl: string,
  zonesPayload: unknown,
): Promise<Record<string, unknown>> {
  const areaIds = areaIdsFromZonesPayload(zonesPayload);
  const entries = await Promise.all(areaIds.map(async (areaId): Promise<[string, unknown] | null> => {
    const payload = await fetchPluginRoute(queryUrl, `plugins/oz---marketplace/offers?areaId=${areaId}`);
    return payload === undefined ? null : [`ozmarketplace.offers.${areaId}`, payload];
  }));
  return Object.fromEntries(entries.filter((entry): entry is [string, unknown] => entry !== null));
}

function areaIdsFromZonesPayload(payload: unknown): number[] {
  if (!payload || typeof payload !== 'object') return [];
  const zones = (payload as { zones?: unknown }).zones;
  if (!Array.isArray(zones)) return [];
  return [...new Set(zones.flatMap((zone): number[] => {
    if (!zone || typeof zone !== 'object') return [];
    const areaId = (zone as { areaId?: unknown }).areaId;
    return typeof areaId === 'number' && Number.isSafeInteger(areaId) && areaId > 0 ? [areaId] : [];
  }))];
}

export async function refreshPluginDataForOnlineServers(): Promise<PluginDataRefreshAllResult> {
  const servers = await listServers();
  const results = await Promise.all(servers.map(refreshPluginDataForServer));
  return {
    checked: servers.length,
    refreshed: results.filter((result) => result.refreshed).length,
    skipped: results.filter((result) => !result.refreshed).length,
  };
}

async function fetchPluginList(queryUrl: string): Promise<QueryPluginInfo[] | undefined> {
  try {
    const response = await fetch(buildRouteUrl(queryUrl, 'pluginlist'), {
      signal: AbortSignal.timeout(AppConfig.liveQueryProxyTimeoutMs),
    });
    if (!response.ok) return undefined;
    return parseNativePluginList(await response.text());
  } catch {
    return undefined;
  }
}

async function fetchPluginRoute(queryUrl: string, routePath: string): Promise<unknown | undefined> {
  const result = await fetchJson(buildRouteUrl(queryUrl, routePath));
  if (!result.ok) {
    defaultLogger.warn('Plugin data route refresh failed:', {
      routePath,
      error: result.error,
    });
    return undefined;
  }
  return result.data;
}

async function fetchJson(url: string): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(AppConfig.liveQueryProxyTimeoutMs),
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

function buildRouteUrl(queryUrl: string, routePath: string): string {
  return new URL(routePath, `${queryUrl.replace(/\/+$/, '')}/`).toString();
}
