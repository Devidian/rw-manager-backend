import type { ServerConfig } from '../interfaces/server-config.js';
import { AppConfig } from '../utils/app-config.js';
import { listServers, updateServer } from '../db/manager-store.js';
import { parseNativeAdminUtilsInfo } from './native-admin-utils-info.js';
import { fetchNativePluginJson } from './native-plugin-request-service.js';
import { playersFromPluginPayload } from './server-plugin-data-service.js';
import { observePlayers } from './player-identity-service.js';
import { forgetPlayerFromServer } from './forgotten-player-service.js';
import { serializePlayerDataWrite } from './player-data-write-queue.js';
import {
  fetchNativePluginList,
  nativePluginRouteId,
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

/** Only the consent-filtered plugin export is a source of online player identities. */
export function onlinePlayersFromEntry(entry: PluginDataCacheEntry): unknown[] | undefined {
  const players = entry.data.__onlinePlayers;
  return Array.isArray(players) ? players : undefined;
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
  { key: 'ozmarketplace.criers', pluginRouteId: 'oz---marketplace', path: 'criers' },
  { key: 'ozshop.traders', pluginRouteId: 'oz---shop', path: 'traders' },
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

export function clearPluginDataCacheEntry(serverId: string): void {
  cache.delete(serverId);
}

export async function refreshPluginDataForServer(
  server: ServerConfig,
): Promise<PluginDataRefreshResult> {
  return serializePlayerDataWrite(server.id, async () => {
    const { findServerById } = await import('../db/manager-store.js');
    return fetchPluginDataForServer(await findServerById(server.id) ?? server);
  });
}

async function fetchPluginDataForServer(
  server: ServerConfig,
): Promise<PluginDataRefreshResult> {
  const pluginQueryUrl = normalizedUrl(server.queryUrl);
  if (!pluginQueryUrl) {
    return { refreshed: false, skippedReason: 'queryUrlMissing' };
  }

  const plugins = await fetchNativePluginList(pluginQueryUrl, AppConfig.liveQueryProxyTimeoutMs);
  if (!plugins) {
    return { refreshed: false, skippedReason: 'pluginListUnavailable' };
  }

  const availablePlugins = new Set(
    plugins
      .filter((plugin) => plugin.valid)
      .flatMap((plugin) => plugin.name ? [nativePluginRouteId(plugin.name)] : []),
  );
  const { hasActiveGameConnectorFeature } = await import('./game-connector-websocket-service.js');
  const consentExportAvailable = hasActiveGameConnectorFeature(server.id, 'playerConsentRevoked');
  const data = Object.fromEntries(
    (await Promise.all(
      routeSpecs
        .filter((spec) => availablePlugins.has(spec.pluginRouteId)
          && (spec.key !== 'ozadminutils.playerlist' || consentExportAvailable))
        .map(async (spec) => [
          spec.key,
          await fetchPluginRoute(pluginQueryUrl, `plugins/${spec.pluginRouteId}/${spec.path}`, server),
        ] as const),
    )).filter((entry): entry is readonly [string, unknown] => entry[1] !== undefined),
  );
  Object.assign(data, await fetchMarketplaceOffersByArea(pluginQueryUrl, data['ozmarketplace.zones'], server));
  if (availablePlugins.has('oz---marketplace')) {
    const globalMarketplaceOffers = await fetchPluginRoute(
      pluginQueryUrl,
      'plugins/oz---marketplace/offers?global=true',
      server,
    );
    if (globalMarketplaceOffers !== undefined) data['ozmarketplace.offers.global'] = globalMarketplaceOffers;
  }
  const nativeInfo = parseNativeAdminUtilsInfo(data['ozadminutils.info']);
  if (nativeInfo && (server.mapUrl !== nativeInfo.mapUrl || server.adminUid !== nativeInfo.adminUid)) {
    await updateServer(server.id, { mapUrl: nativeInfo.mapUrl, adminUid: nativeInfo.adminUid });
  }
  const playerlist = data['ozadminutils.playerlist'];
  if (!playerlist || typeof playerlist !== 'object' || (playerlist as { consentVersion?: unknown }).consentVersion !== 1) {
    delete data['ozadminutils.playerlist'];
  }
  if (data['ozadminutils.playerlist'] !== undefined) {
    const raw = (data['ozadminutils.playerlist'] as { players?: unknown }).players;
    if (Array.isArray(raw)) {
      const players = playersFromPluginPayload(data['ozadminutils.playerlist']);
      const onlinePlayers = raw.filter((player) =>
        !!player && typeof player === 'object' && (player as { connected?: unknown }).connected === true);
      if (players.length) await observePlayers(players, new Date());
      const nextUids = new Set(players.map((player) => player.uid));
      const removedUids = [...new Set([
        ...(server.privacyPendingDeletes ?? []),
        ...(server.knownPlayers ?? []).map((player) => player.uid).filter((uid) => !nextUids.has(uid)),
      ])];
      await updateServer(server.id, { knownPlayers: players, onlinePlayers, privacyPendingDeletes: removedUids });
      for (const uid of removedUids) await forgetPlayerFromServer(server.id, uid);
      if (removedUids.length) await updateServer(server.id, { privacyPendingDeletes: [] });
      data.__onlinePlayers = onlinePlayers;
    }
  }

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
  server: ServerConfig,
): Promise<Record<string, unknown>> {
  const areaIds = areaIdsFromZonesPayload(zonesPayload);
  const entries = await Promise.all(areaIds.map(async (areaId): Promise<[string, unknown] | null> => {
    const payload = await fetchPluginRoute(queryUrl, `plugins/oz---marketplace/offers?areaId=${areaId}`, server);
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

async function fetchPluginRoute(queryUrl: string, routePath: string, server: ServerConfig): Promise<unknown | undefined> {
  const result = await fetchNativePluginJson(server, buildRouteUrl(queryUrl, routePath));
  if (!result.ok) return undefined;
  return result.data;
}

function buildRouteUrl(queryUrl: string, routePath: string): string {
  return new URL(routePath, `${queryUrl.replace(/\/+$/, '')}/`).toString();
}
