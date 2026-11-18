import type { PluginDataCacheEntry } from './plugin-data-cache-service.js';
import type { MapLayerCapabilities } from '../interfaces/map-layer.js';

export function mapLayerAccess(entry: PluginDataCacheEntry | undefined, verifiedSteamId: string | undefined) {
  const payload = entry?.data?.['ozadminutils.playerlist'] as {
    consentVersion?: unknown;
    players?: unknown;
    mapViewerUids?: unknown;
  } | undefined;
  if (!verifiedSteamId || payload?.consentVersion !== 1) return { manager: false, players: false };
  return {
    manager: Array.isArray(payload.players) && payload.players.some(
      (player) => player?.uid === verifiedSteamId,
    ),
    players: Array.isArray(payload.mapViewerUids) && payload.mapViewerUids.includes(verifiedSteamId),
  };
}

export function restrictMapLayerCapabilities(
  capabilities: MapLayerCapabilities,
  access: ReturnType<typeof mapLayerAccess>,
): MapLayerCapabilities {
  const result = { ...capabilities, players: capabilities.players && access.players };
  if (!access.manager) {
    for (const key of ['claims', 'claimSales', 'renewZones', 'marketplace', 'shop',
      'gpsGlobalMarkers', 'playerHistory', 'marketCriers', 'shopTraders'] as const) result[key] = false;
  }
  return result;
}
