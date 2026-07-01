import type { ServerConfig } from '../interfaces/server-config.js';
import { AppConfig } from '../utils/app-config.js';
import { defaultLogger } from '../utils/logger.js';
import { listServers } from '../db/manager-store.js';

export interface QueryPluginInfo {
  directory?: string;
  name?: string;
  version?: string;
  valid: boolean;
}

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

interface PluginListResponse {
  plugins?: unknown;
}

interface RouteSpec {
  key: string;
  pluginNames: string[];
  path: string;
}

const routeSpecs: RouteSpec[] = [
  {
    key: 'ozadminutils.worldAreas',
    pluginNames: ['ozadminutils'],
    path: 'plugins/ozadminutils/world-areas',
  },
  {
    key: 'ozadminutils.playerlist',
    pluginNames: ['ozadminutils'],
    path: 'plugins/ozadminutils/playerlist',
  },
  {
    key: 'ozadminutils.serverConfig',
    pluginNames: ['ozadminutils'],
    path: 'plugins/ozadminutils/server-config',
  },
  {
    key: 'ozgps.globalMarkers',
    pluginNames: ['ozgps'],
    path: 'plugins/ozgps/marker?type=global',
  },
  {
    key: 'ozmarketplace.zones',
    pluginNames: ['ozmarketplace'],
    path: 'plugins/ozmarketplace/zones',
  },
  {
    key: 'ozshop.zones',
    pluginNames: ['ozshop'],
    path: 'plugins/ozshop/zones',
  },
  {
    key: 'ozlandclaim.claimSales',
    pluginNames: ['ozlandclaim'],
    path: 'plugins/ozlandclaim/claim-sales',
  },
];

const QUERY_URL_PATTERN = /@queryUrl\s*:\s*(?:\[\s*([^\]\s]+)\s*]|(\S+))/i;

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
  const pluginQueryUrl = pluginQueryUrlForServer(server);
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
      .flatMap((plugin) => [plugin.name, plugin.directory])
      .filter((value): value is string => typeof value === 'string')
      .map(normalizePluginName),
  );
  const data = Object.fromEntries(
    (await Promise.all(
      routeSpecs
        .filter((spec) => spec.pluginNames.some((name) => availablePlugins.has(name)))
        .map(async (spec) => [spec.key, await fetchPluginRoute(pluginQueryUrl, spec.path)] as const),
    )).filter((entry): entry is readonly [string, unknown] => entry[1] !== undefined),
  );
  Object.assign(data, await fetchMarketplaceOffersByArea(pluginQueryUrl, data['ozmarketplace.zones']));
  data.__onlinePlayers = server.onlinePlayers;

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

function pluginQueryUrlForServer(server: ServerConfig): string | undefined {
  return queryUrlFromInfo(server.info)
    ?? normalizedUrl(server.queryUrl);
}

function queryUrlFromInfo(info: unknown): string | undefined {
  if (!info || typeof info !== 'object') return undefined;
  const description = stringOrUndefined((info as { description?: unknown }).description);
  const match = description?.match(QUERY_URL_PATTERN);
  return normalizedUrl(match?.[1] ?? match?.[2]);
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
): Promise<PluginDataCacheEntry | undefined> {
  const cached = getCachedPluginData(server.id);
  if (cached) return cached;
  return (await refreshPluginDataForServer(server)).entry;
}

async function fetchMarketplaceOffersByArea(
  queryUrl: string,
  zonesPayload: unknown,
): Promise<Record<string, unknown>> {
  const areaIds = areaIdsFromZonesPayload(zonesPayload);
  const entries = await Promise.all(areaIds.map(async (areaId): Promise<[string, unknown] | null> => {
    const payload = await fetchPluginRoute(queryUrl, `plugins/ozmarketplace/offers?areaId=${areaId}`);
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
  const result = await fetchJson(buildRouteUrl(queryUrl, 'plugins/ozadminutils/plugins'));
  if (!result.ok) return undefined;
  const plugins = (result.data as PluginListResponse).plugins;
  if (!Array.isArray(plugins)) return undefined;
  return plugins.flatMap((plugin): QueryPluginInfo[] => {
    if (!plugin || typeof plugin !== 'object') return [];
    const value = plugin as Record<string, unknown>;
    if (typeof value.valid !== 'boolean') return [];
    return [{
      directory: stringOrUndefined(value.directory),
      name: stringOrUndefined(value.name),
      version: stringOrUndefined(value.version),
      valid: value.valid,
    }];
  });
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

function normalizePluginName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
