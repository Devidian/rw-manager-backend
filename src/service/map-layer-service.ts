import type {
  MapClaim,
  MapGpsMarker,
  MapLayerCapabilities,
  MapMarketplaceOffer,
  MapPlayer,
} from '../interfaces/map-layer.js';
import { AppConfig } from '../utils/app-config.js';
import {
  getCachedPluginData,
  getFirstCachedPluginData,
  type PluginDataCacheEntry,
} from './plugin-data-cache-service.js';

const CHUNK_SIZE_BLOCKS = 32;
const SECTOR_SIZE_CHUNKS = 256;
const SECTOR_SIZE_BLOCKS = 8192;

interface LandClaimSettings {
  areaPermissions: Set<string>;
  colors: Record<string, { border: string; fill: string }>;
  owner: { border: string; fill: string };
  other: { border: string; fill: string };
  sale: { border: string; fill: string };
}

export async function getMapLayerCapabilities(
  rootPath: string = AppConfig.rootPath,
  serverId?: string,
): Promise<MapLayerCapabilities> {
  const entry = cachedEntry(serverId);

  return {
    schemaVersion: 1,
    worldName: cachedWorldName(entry),
    sectorSizeChunks: SECTOR_SIZE_CHUNKS,
    chunkSizeBlocks: CHUNK_SIZE_BLOCKS,
    sectorSizeBlocks: SECTOR_SIZE_BLOCKS,
    recentPlayerDays: AppConfig.mapRecentPlayerDays,
    claims: cachedMapClaims(entry) !== null,
    claimSales: cachedClaimSales(entry) !== null,
    marketplace: cachedAreaIds('ozmarketplace.zones', entry) !== null,
    shop: cachedAreaIds('ozshop.zones', entry) !== null,
    players: cachedMapPlayers(true, new Date(), entry) !== null,
    gpsGlobalMarkers: cachedGpsGlobalMarkers(entry) !== null,
  };
}

export async function getMapClaims(
  rootPath: string = AppConfig.rootPath,
  serverId?: string,
  currentUserSteamId?: string,
): Promise<MapClaim[] | null> {
  void rootPath;
  return cachedMapClaims(cachedEntry(serverId), currentUserSteamId);
}

export async function getMapMarketplaceOffers(
  areaId: number,
  rootPath: string = AppConfig.rootPath,
  serverId?: string,
): Promise<MapMarketplaceOffer[] | null> {
  void rootPath;
  return cachedMarketplaceOffers(areaId, cachedEntry(serverId));
}

export async function getMapPlayers(
  includeLongTerm: boolean,
  rootPath: string = AppConfig.rootPath,
  now: Date = new Date(),
  serverId?: string,
): Promise<MapPlayer[] | null> {
  void rootPath;
  return cachedMapPlayers(includeLongTerm, now, cachedEntry(serverId));
}

export async function getMapGpsGlobalMarkers(
  rootPath: string = AppConfig.rootPath,
  serverId?: string,
): Promise<MapGpsMarker[] | null> {
  void rootPath;
  return cachedGpsGlobalMarkers(cachedEntry(serverId));
}

function landClaimSettingsFromValues(values: Map<string, string>): LandClaimSettings {
  const get = (key: string, fallback: string) => values.get(key) ?? fallback;
  const permission = {
    rest: get('specialRestAreaPermission', 'ozlc-special-rest'),
    pvp: get('specialPvPAreaPermission', 'ozlc-special-pvp'),
    static: get('specialStaticAreaPermission', 'ozlc-special-static'),
    trap: get('specialTrapAreaPermission', 'ozlc-special-trap'),
    special: get('specialAreaPermission', 'ozlc-special'),
    default: get('defaultAreaPermission', 'ozlc-guest'),
  };
  const color = (key: string, fallback: string) => packedRgba(get(key, fallback), fallback);
  const colors = {
    rest: {
      border: color('restAreaBorderColor', '0x6fff829c'),
      fill: color('restAreaFrameColor', '0x6fff82AA'),
    },
    pvp: {
      border: color('pvpAreaBorderColor', '0xFF000010'),
      fill: color('pvpAreaFrameColor', '0xFF000050'),
    },
    static: {
      border: color('staticAreaBorderColor', '0x81D4FA10'),
      fill: color('staticAreaFrameColor', '0x81D4FA50'),
    },
    trap: {
      border: color('trapAreaBorderColor', '0xff91009c'),
      fill: color('trapAreaFrameColor', '0xff9100AA'),
    },
    special: {
      border: color('specialAreaBorderColor', '0xFFFFFF10'),
      fill: color('specialAreaFrameColor', '0xFFFFFF50'),
    },
    other: {
      border: color('otherAreaBorderColor', '0x0010E010'),
      fill: color('otherAreaFrameColor', '0x0010E050'),
    },
    owner: {
      border: color('ownerAreaBorderColor', get('otherAreaBorderColor', '0x0010E010')),
      fill: color('ownerAreaFrameColor', get('otherAreaFrameColor', '0x0010E050')),
    },
    sale: {
      border: color('forSaleAreaBorderColor', '0x00FFFF10'),
      fill: color('forSaleAreaFrameColor', '0x00FFFF50'),
    },
  };
  return {
    areaPermissions: new Set(Object.values(permission)),
    colors: {
      [permission.rest]: colors.rest,
      [permission.pvp]: colors.pvp,
      [permission.static]: colors.static,
      [permission.trap]: colors.trap,
      [permission.special]: colors.special,
      [permission.default]: colors.other,
    },
    owner: colors.owner,
    other: colors.other,
    sale: colors.sale,
  };
}

function cachedLandClaimSettings(payload: Record<string, unknown>): LandClaimSettings {
  const settings = payload.settings;
  if (!settings || typeof settings !== 'object') return landClaimSettingsFromValues(new Map());
  const values = new Map<string, string>();
  for (const [key, value] of Object.entries(settings as Record<string, unknown>)) {
    if (typeof value === 'string') values.set(key, value);
  }
  return landClaimSettingsFromValues(values);
}

function packedRgba(value: string, fallback: string): string {
  const normalized = value.trim().replace(/^0x/i, '');
  const fallbackNormalized = fallback.replace(/^0x/i, '');
  return `#${/^[0-9a-fA-F]{8}$/.test(normalized) ? normalized : fallbackNormalized}`.toUpperCase();
}

function cachedEntry(serverId?: string): PluginDataCacheEntry | undefined {
  return serverId ? getCachedPluginData(serverId) : getFirstCachedPluginData();
}

function cachedWorldName(entry?: PluginDataCacheEntry): string {
  const candidates = [
    entry?.data['ozadminutils.worldAreas'],
    entry?.data['ozlandclaim.claimSales'],
  ];
  for (const payload of candidates) {
    if (!payload || typeof payload !== 'object') continue;
    const worldName = (payload as { worldName?: unknown }).worldName;
    if (typeof worldName === 'string' && worldName.trim()) return worldName;
  }
  return 'Unknown World';
}

function cachedGpsGlobalMarkers(entry?: PluginDataCacheEntry): MapGpsMarker[] | null {
  const payload = entry?.data['ozgps.globalMarkers'];
  if (!payload || typeof payload !== 'object') return null;
  const markers = (payload as { markers?: unknown; items?: unknown }).markers
    ?? (payload as { markers?: unknown; items?: unknown }).items;
  if (!Array.isArray(markers)) return null;
  return markers.flatMap((marker): MapGpsMarker[] => {
    if (!marker || typeof marker !== 'object') return [];
    const value = marker as Record<string, unknown>;
    const { id, name, x, y, z, icon, color, createdAt } = value;
    if (
      typeof id !== 'number' ||
      !Number.isSafeInteger(id) ||
      typeof name !== 'string' ||
      typeof x !== 'number' ||
      typeof y !== 'number' ||
      typeof z !== 'number' ||
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isFinite(z) ||
      typeof icon !== 'string' ||
      typeof color !== 'string' ||
      typeof createdAt !== 'string'
    ) return [];
    return [{
      id,
      name,
      x,
      y,
      z,
      icon,
      color,
      createdAt,
    }];
  });
}

function cachedMarketplaceOffers(areaId: number, entry?: PluginDataCacheEntry): MapMarketplaceOffer[] | null {
  const payload = entry?.data[`ozmarketplace.offers.${areaId}`];
  if (!payload || typeof payload !== 'object') return null;
  const offers = (payload as { offers?: unknown; items?: unknown }).offers
    ?? (payload as { offers?: unknown; items?: unknown }).items;
  if (!Array.isArray(offers)) return null;
  return offers.flatMap((offer): MapMarketplaceOffer[] => {
    if (!offer || typeof offer !== 'object') return [];
    const value = offer as Record<string, unknown>;
    const { id, itemName, itemVariant, amount, price, currency, sellerName, createdAt } = value;
    if (
      typeof id !== 'number' ||
      !Number.isSafeInteger(id) ||
      typeof itemName !== 'string' ||
      typeof itemVariant !== 'number' ||
      !Number.isSafeInteger(itemVariant) ||
      typeof amount !== 'number' ||
      !Number.isSafeInteger(amount) ||
      typeof price !== 'number' ||
      typeof currency !== 'string' ||
      typeof sellerName !== 'string' ||
      typeof createdAt !== 'string'
    ) return [];
    return [{
      id,
      itemName,
      itemVariant,
      amount,
      price,
      currency,
      sellerName,
      createdAt,
    }];
  });
}

function cachedAreaIds(
  key: 'ozmarketplace.zones' | 'ozshop.zones',
  entry?: PluginDataCacheEntry,
): Set<number> | null {
  const payload = entry?.data[key];
  if (!payload || typeof payload !== 'object') return null;
  const zones = (payload as { zones?: unknown }).zones;
  if (!Array.isArray(zones)) return null;
  return new Set(zones.flatMap((zone): number[] => {
    if (!zone || typeof zone !== 'object') return [];
    const areaId = (zone as { areaId?: unknown }).areaId;
    return typeof areaId === 'number' && Number.isSafeInteger(areaId) && areaId > 0 ? [areaId] : [];
  }));
}

function cachedClaimSales(entry?: PluginDataCacheEntry): Map<number, number> | null {
  const payload = entry?.data['ozlandclaim.claimSales'];
  if (!payload || typeof payload !== 'object') return null;
  const listings = (payload as { listings?: unknown }).listings;
  if (!Array.isArray(listings)) return null;
  const result = new Map<number, number>();
  for (const listing of listings) {
    if (!listing || typeof listing !== 'object') continue;
    const value = listing as Record<string, unknown>;
    const { areaId, price, status } = value;
    if (
      typeof areaId === 'number' &&
      Number.isSafeInteger(areaId) &&
      areaId > 0 &&
      typeof price === 'number' &&
      status === 'ACTIVE' &&
      !result.has(areaId)
    ) {
      result.set(areaId, price);
    }
  }
  return result;
}

function cachedMapClaims(entry?: PluginDataCacheEntry, currentUserSteamId?: string): MapClaim[] | null {
  const payload = entry?.data['ozadminutils.worldAreas'];
  if (!payload || typeof payload !== 'object') return null;
  const payloadRecord = payload as Record<string, unknown>;
  const areas = (payloadRecord as { areas?: unknown }).areas;
  if (!Array.isArray(areas)) return null;

  const settings = cachedLandClaimSettings(payloadRecord);
  const sales = cachedClaimSales(entry) ?? new Map<number, number>();
  const marketplaceAreaIds = cachedAreaIds('ozmarketplace.zones', entry) ?? new Set<number>();
  const shopAreaIds = cachedAreaIds('ozshop.zones', entry) ?? new Set<number>();

  return areas.flatMap((area): MapClaim[] => {
    if (!area || typeof area !== 'object') return [];
    const value = area as Record<string, unknown>;
    const { id, name, permission, ownerUid, ownerName, startX, startZ, endX, endZ, createdAt } = value;
    if (
      typeof id !== 'number' ||
      !Number.isSafeInteger(id) ||
      id <= 0 ||
      typeof name !== 'string' ||
      typeof permission !== 'string' ||
      typeof startX !== 'number' ||
      typeof startZ !== 'number' ||
      typeof endX !== 'number' ||
      typeof endZ !== 'number'
    ) return [];
    if (!permission.startsWith('ozlc') && !settings.areaPermissions.has(permission)) return [];
    const geometry = normalizeCachedArea(startX, startZ, endX, endZ);
    if (!geometry) return [];
    const salePrice = sales.get(id);
    const isOwner = currentUserSteamId !== undefined && ownerUid === currentUserSteamId;
    const colors = salePrice !== undefined
      ? settings.sale
      : isOwner
        ? settings.owner
        : settings.colors[permission] ?? settings.other;
    return [{
      areaId: id,
      name,
      permission,
      ...geometry,
      ownerName: typeof ownerName === 'string' && ownerName ? ownerName : undefined,
      createdAt: typeof createdAt === 'string' ? createdAt : undefined,
      borderColor: colors.border,
      fillColor: colors.fill,
      forSale: salePrice !== undefined,
      salePrice,
      marketplace: marketplaceAreaIds.has(id),
      shop: shopAreaIds.has(id),
    }];
  });
}

function cachedMapPlayers(
  includeLongTerm: boolean,
  now: Date,
  entry?: PluginDataCacheEntry,
): MapPlayer[] | null {
  const payload = entry?.data['ozadminutils.playerlist'];
  if (!payload || typeof payload !== 'object') return null;
  const players = (payload as { players?: unknown }).players;
  if (!Array.isArray(players)) return null;
  const onlineUids = new Set(
    (entry?.data['__onlinePlayers'] as unknown[] | undefined ?? [])
      .flatMap((player): string[] => {
        if (!player || typeof player !== 'object') return [];
        const uid = (player as { uid?: unknown; UID?: unknown }).uid ?? (player as { UID?: unknown }).UID;
        return typeof uid === 'string' ? [uid] : [];
      }),
  );
  const threshold = Math.floor(now.getTime() / 1000) - AppConfig.mapRecentPlayerDays * 86400;
  return players.flatMap((player): MapPlayer[] => {
    if (!player || typeof player !== 'object') return [];
    const value = player as Record<string, unknown>;
    const { id, uid, name, posx, posz, lastseen } = value;
    if (
      typeof name !== 'string' ||
      typeof posx !== 'number' ||
      typeof posz !== 'number' ||
      typeof lastseen !== 'number' ||
      !Number.isFinite(posx) ||
      !Number.isFinite(posz)
    ) return [];
    const playerId = typeof uid === 'string' && uid ? uid : String(id ?? '');
    if (!playerId) return [];
    const recent = lastseen >= threshold;
    const online = onlineUids.has(playerId);
    if (!recent && !online && !includeLongTerm) return [];
    return [{
      id: playerId,
      name,
      x: posx,
      z: posz,
      state: online ? 'online' : recent ? 'recent-offline' : 'long-term-offline',
      lastSeen: epochSeconds(lastseen) ?? new Date(0).toISOString(),
    }];
  });
}

function normalizeCachedArea(
  startX: number,
  startZ: number,
  endX: number,
  endZ: number,
): Pick<MapClaim, 'minX' | 'minZ' | 'width' | 'depth'> | null {
  const minX = Math.round(startX);
  const minZ = Math.round(startZ);
  const maxX = Math.ceil(endX);
  const maxZ = Math.ceil(endZ);
  const width = maxX - minX;
  const depth = maxZ - minZ;
  if (
    ![minX, minZ, maxX, maxZ].every(Number.isSafeInteger) ||
    width <= 0 ||
    depth <= 0 ||
    width % CHUNK_SIZE_BLOCKS !== 0 ||
    depth % CHUNK_SIZE_BLOCKS !== 0
  ) return null;
  return { minX, minZ, width, depth };
}

function epochSeconds(value: number): string | undefined {
  if (!Number.isSafeInteger(value) || value <= 0) return undefined;
  return new Date(value * 1000).toISOString();
}
