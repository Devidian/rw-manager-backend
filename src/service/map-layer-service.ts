import Database from 'better-sqlite3';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { propertiesReader } from 'properties-reader';
import type {
  MapClaim,
  MapLayerCapabilities,
  MapMarketplaceOffer,
  MapPlayer,
} from '../interfaces/map-layer.js';
import type { PluginInfo } from '../interfaces/plugin-info.js';
import { AppConfig } from '../utils/app-config.js';
import { ServerConfig } from '../utils/server-config.js';
import { listInstalledPlugins } from './plugin-inventory-service.js';

const LAND_CLAIM_NAME = 'OZ - Land Claim';
const MARKETPLACE_NAME = 'OZ - Marketplace';
const SHOP_NAME = 'OZ - Shop';
const CHUNK_SIZE_BLOCKS = 32;
const SECTOR_SIZE_CHUNKS = 256;
const SECTOR_SIZE_BLOCKS = 8192;

interface LayerContext {
  rootPath: string;
  worldName: string;
  plugins: PluginInfo[];
  landClaim?: PluginSource;
  marketplace?: PluginSource;
  shop?: PluginSource;
}

interface PluginSource {
  directory: string;
  path: string;
  databasePath: string;
}

interface LandClaimSettings {
  allowClaimSale: boolean;
  ownerPermission: string;
  areaPermissions: Set<string>;
  colors: Record<string, { border: string; fill: string }>;
  other: { border: string; fill: string };
  sale: { border: string; fill: string };
}

interface AreaRow {
  id: number;
  name: string | null;
  shape: string | null;
  permission: string | null;
  startposx: number;
  startposz: number;
  endposx: number;
  endposz: number;
  creationdate: number;
}

interface PlayerRow {
  id: number;
  uid: string;
  name: string;
  posx: number;
  posz: number;
  lastseen: number;
}

export async function getMapLayerCapabilities(
  rootPath: string = AppConfig.rootPath,
): Promise<MapLayerCapabilities> {
  const context = await createContext(rootPath);
  const areasPath = worldDatabasePath(context, 'Areas.db');
  const playersPath = worldDatabasePath(context, 'Player.db');
  const claims = Boolean(context.landClaim) && hasColumns(areasPath, 'areas', [
    'id', 'shape', 'name', 'startposx', 'startposz', 'endposx', 'endposz',
    'permission', 'creationdate',
  ]) && hasColumns(areasPath, 'rights', ['areaid', 'playerid', 'permission']);
  const players = hasColumns(playersPath, 'player', [
    'id', 'uid', 'name', 'posx', 'posz', 'lastseen',
  ]);
  const claimSales = Boolean(
    claims &&
    context.landClaim &&
    hasColumns(context.landClaim.databasePath, 'claimSaleListings', [
      'world', 'area_id', 'price', 'listed_at', 'status',
    ]),
  );
  const marketplace = Boolean(
    context.marketplace &&
    hasColumns(context.marketplace.databasePath, 'marketplace_zones', ['id', 'area_id']) &&
    hasColumns(context.marketplace.databasePath, 'marketplace_listings', [
      'id', 'seller_name', 'item_name', 'item_variant', 'amount', 'price',
      'currency_identifier', 'market_zone_id', 'global_listing', 'created_at', 'status',
    ]),
  );
  const shop = Boolean(
    context.shop &&
    hasColumns(context.shop.databasePath, 'shop_zones', ['area_id']),
  );

  return {
    schemaVersion: 1,
    worldName: context.worldName,
    sectorSizeChunks: SECTOR_SIZE_CHUNKS,
    chunkSizeBlocks: CHUNK_SIZE_BLOCKS,
    sectorSizeBlocks: SECTOR_SIZE_BLOCKS,
    recentPlayerDays: AppConfig.mapRecentPlayerDays,
    claims,
    claimSales,
    marketplace,
    shop,
    players,
  };
}

export async function getMapClaims(
  rootPath: string = AppConfig.rootPath,
): Promise<MapClaim[] | null> {
  const context = await createContext(rootPath);
  if (!context.landClaim) return null;
  const areasPath = worldDatabasePath(context, 'Areas.db');
  const playersPath = worldDatabasePath(context, 'Player.db');
  if (
    !hasColumns(areasPath, 'areas', [
      'id', 'shape', 'name', 'startposx', 'startposz', 'endposx', 'endposz',
      'permission', 'creationdate',
    ]) ||
    !hasColumns(areasPath, 'rights', ['areaid', 'playerid', 'permission'])
  ) return null;

  const settings = readLandClaimSettings(context.landClaim?.path);
  const areasDb = openReadonly(areasPath);
  const playersDb = hasColumns(playersPath, 'player', ['id', 'name'])
    ? openReadonly(playersPath)
    : undefined;
  const pluginDb = context.landClaim && existsSync(context.landClaim.databasePath)
    ? openReadonly(context.landClaim.databasePath)
    : undefined;
  const marketplaceDb = context.marketplace && existsSync(context.marketplace.databasePath)
    ? openReadonly(context.marketplace.databasePath)
    : undefined;
  const shopDb = context.shop && existsSync(context.shop.databasePath)
    ? openReadonly(context.shop.databasePath)
    : undefined;

  try {
    const ownerNames = readOwnerNames(areasDb, playersDb, settings.ownerPermission);
    const sales = settings.allowClaimSale
      ? readClaimSales(pluginDb, context.worldName)
      : new Map<number, number>();
    const marketplaceAreaIds = readAreaIds(marketplaceDb, 'marketplace_zones');
    const shopAreaIds = readAreaIds(shopDb, 'shop_zones');
    const rows = areasDb.prepare(`
      SELECT id, name, shape, permission, startposx, startposz,
             endposx, endposz, creationdate
      FROM areas
      ORDER BY id
    `).all() as AreaRow[];

    return rows.flatMap((row): MapClaim[] => {
      if (row.shape !== 'Rectangular' || !row.permission) return [];
      if (!row.permission.startsWith('ozlc') && !settings.areaPermissions.has(row.permission)) return [];
      const geometry = normalizeArea(row);
      if (!geometry) return [];
      const salePrice = sales.get(row.id);
      const colors = salePrice === undefined
        ? settings.colors[row.permission] ?? settings.other
        : settings.sale;
      return [{
        areaId: row.id,
        name: row.name?.trim() || `Area #${row.id}`,
        permission: row.permission,
        ...geometry,
        ownerName: ownerNames.get(row.id),
        createdAt: epochSeconds(row.creationdate),
        borderColor: colors.border,
        fillColor: colors.fill,
        forSale: salePrice !== undefined,
        salePrice,
        marketplace: marketplaceAreaIds.has(row.id),
        shop: shopAreaIds.has(row.id),
      }];
    });
  } finally {
    areasDb.close();
    playersDb?.close();
    pluginDb?.close();
    marketplaceDb?.close();
    shopDb?.close();
  }
}

export async function getMapMarketplaceOffers(
  areaId: number,
  rootPath: string = AppConfig.rootPath,
): Promise<MapMarketplaceOffer[] | null> {
  const context = await createContext(rootPath);
  if (!context.marketplace || !existsSync(context.marketplace.databasePath)) return null;
  const database = openReadonly(context.marketplace.databasePath);
  try {
    if (
      !tableHasColumns(database, 'marketplace_zones', ['id', 'area_id']) ||
      !tableHasColumns(database, 'marketplace_listings', [
        'id', 'seller_name', 'item_name', 'item_variant', 'amount', 'price',
        'currency_identifier', 'market_zone_id', 'global_listing', 'created_at', 'status',
      ])
    ) return null;
    const zone = database.prepare(
      'SELECT id FROM marketplace_zones WHERE area_id = ? LIMIT 1',
    ).get(areaId) as { id: string } | undefined;
    if (!zone) return [];
    const rows = database.prepare(`
      SELECT id, seller_name, item_name, item_variant, amount, price,
             currency_identifier, created_at
      FROM marketplace_listings
      WHERE status = 'ACTIVE' AND market_zone_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 30
    `).all(zone.id) as Array<{
      id: number;
      seller_name: string;
      item_name: string;
      item_variant: number;
      amount: number;
      price: number;
      currency_identifier: string;
      created_at: number;
    }>;
    return rows.map((row) => ({
      id: row.id,
      itemName: row.item_name,
      itemVariant: row.item_variant,
      amount: row.amount,
      price: row.price,
      currency: row.currency_identifier,
      sellerName: row.seller_name,
      createdAt: epochMillis(row.created_at),
    }));
  } finally {
    database.close();
  }
}

export async function getMapPlayers(
  includeLongTerm: boolean,
  rootPath: string = AppConfig.rootPath,
  now: Date = new Date(),
): Promise<MapPlayer[] | null> {
  const worldName = ServerConfig.getWorldName(rootPath);
  const playerPath = path.join(rootPath, 'Worlds', worldName, 'Player.db');
  if (!hasColumns(playerPath, 'player', ['id', 'uid', 'name', 'posx', 'posz', 'lastseen'])) {
    return null;
  }
  const threshold = Math.floor(now.getTime() / 1000) - AppConfig.mapRecentPlayerDays * 86400;
  const database = openReadonly(playerPath);
  try {
    const rows = database.prepare(`
      SELECT id, uid, name, posx, posz, lastseen
      FROM player
      ORDER BY name COLLATE NOCASE, id
    `).all() as PlayerRow[];
    return rows.flatMap((row): MapPlayer[] => {
      if (!Number.isFinite(row.posx) || !Number.isFinite(row.posz)) return [];
      const recent = row.lastseen >= threshold;
      if (!recent && !includeLongTerm) return [];
      return [{
        id: row.uid || String(row.id),
        name: row.name,
        x: row.posx,
        z: row.posz,
        state: recent ? 'recent-offline' : 'long-term-offline',
        lastSeen: epochSeconds(row.lastseen) ?? new Date(0).toISOString(),
      }];
    });
  } finally {
    database.close();
  }
}

async function createContext(rootPath: string): Promise<LayerContext> {
  const worldName = ServerConfig.getWorldName(rootPath);
  const plugins = await listInstalledPlugins(rootPath);
  return {
    rootPath,
    worldName,
    plugins,
    landClaim: pluginSource(rootPath, worldName, plugins, LAND_CLAIM_NAME),
    marketplace: pluginSource(rootPath, worldName, plugins, MARKETPLACE_NAME),
    shop: pluginSource(rootPath, worldName, plugins, SHOP_NAME),
  };
}

function pluginSource(
  rootPath: string,
  worldName: string,
  plugins: PluginInfo[],
  name: string,
): PluginSource | undefined {
  const plugin = plugins.find((item) => item.valid && item.name === name);
  if (!plugin) return undefined;
  const pluginPath = path.join(rootPath, 'Plugins', plugin.directory);
  return {
    directory: plugin.directory,
    path: pluginPath,
    databasePath: path.join(pluginPath, `${worldName}.db`),
  };
}

function worldDatabasePath(context: LayerContext, fileName: string): string {
  return path.join(context.rootPath, 'Worlds', context.worldName, fileName);
}

function openReadonly(databasePath: string): Database.Database {
  return new Database(databasePath, { readonly: true, fileMustExist: true });
}

function hasColumns(databasePath: string, table: string, columns: string[]): boolean {
  if (!existsSync(databasePath)) return false;
  const database = openReadonly(databasePath);
  try {
    return tableHasColumns(database, table, columns);
  } catch {
    return false;
  } finally {
    database.close();
  }
}

function tableHasColumns(
  database: Database.Database,
  table: string,
  columns: string[],
): boolean {
  const actual = new Set(
    (database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
      .map((column) => column.name),
  );
  return columns.every((column) => actual.has(column));
}

function readLandClaimSettings(pluginPath?: string): LandClaimSettings {
  const values = new Map<string, string>();
  const settingsPath = pluginPath ? path.join(pluginPath, 'settings.properties') : undefined;
  if (settingsPath && existsSync(settingsPath)) {
    const properties = propertiesReader({ sourceFile: settingsPath });
    for (const [key, value] of properties.entries({ parsed: false })) {
      values.set(key, String(value));
    }
  }
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
    sale: {
      border: color('forSaleAreaBorderColor', '0x00FFFF10'),
      fill: color('forSaleAreaFrameColor', '0x00FFFF50'),
    },
  };
  return {
    allowClaimSale: get('allowClaimSale', 'false') === 'true',
    ownerPermission: get('ownerAreaPermission', 'ozlc-owner'),
    areaPermissions: new Set(Object.values(permission)),
    colors: {
      [permission.rest]: colors.rest,
      [permission.pvp]: colors.pvp,
      [permission.static]: colors.static,
      [permission.trap]: colors.trap,
      [permission.special]: colors.special,
      [permission.default]: colors.other,
    },
    other: colors.other,
    sale: colors.sale,
  };
}

function packedRgba(value: string, fallback: string): string {
  const normalized = value.trim().replace(/^0x/i, '');
  const fallbackNormalized = fallback.replace(/^0x/i, '');
  return `#${/^[0-9a-fA-F]{8}$/.test(normalized) ? normalized : fallbackNormalized}`.toUpperCase();
}

function readOwnerNames(
  areasDb: Database.Database,
  playersDb: Database.Database | undefined,
  ownerPermission: string,
): Map<number, string> {
  if (!playersDb) return new Map();
  const rights = areasDb.prepare(`
    SELECT areaid AS area_id, playerid AS player_id
    FROM rights
    WHERE permission = ?
    ORDER BY areaid
  `).all(ownerPermission) as Array<{ area_id: number; player_id: number }>;
  const players = playersDb.prepare('SELECT id, name FROM player').all() as Array<{
    id: number;
    name: string;
  }>;
  const names = new Map(players.map((player) => [player.id, player.name]));
  return new Map(rights.flatMap((right): Array<[number, string]> => {
    const name = names.get(right.player_id);
    return name ? [[right.area_id, name]] : [];
  }));
}

function readClaimSales(
  database: Database.Database | undefined,
  worldName: string,
): Map<number, number> {
  if (!database || !tableHasColumns(database, 'claimSaleListings', [
    'world', 'area_id', 'price', 'status',
  ])) return new Map();
  const rows = database.prepare(`
    SELECT area_id, price
    FROM claimSaleListings
    WHERE world = ? AND status = 'ACTIVE'
    ORDER BY listed_at DESC, id DESC
  `).all(worldName) as Array<{ area_id: number; price: number }>;
  const result = new Map<number, number>();
  for (const row of rows) if (!result.has(row.area_id)) result.set(row.area_id, row.price);
  return result;
}

function readAreaIds(
  database: Database.Database | undefined,
  table: 'marketplace_zones' | 'shop_zones',
): Set<number> {
  if (!database || !tableHasColumns(database, table, ['area_id'])) return new Set();
  const rows = database.prepare(
    `SELECT area_id FROM ${table} WHERE area_id > 0`,
  ).all() as Array<{ area_id: number }>;
  return new Set(rows.map((row) => row.area_id));
}

function normalizeArea(row: AreaRow): Pick<MapClaim, 'minX' | 'minZ' | 'width' | 'depth'> | null {
  if (!Number.isSafeInteger(row.id) || row.id <= 0) return null;
  const minX = Math.round(row.startposx);
  const minZ = Math.round(row.startposz);
  const maxX = Math.ceil(row.endposx);
  const maxZ = Math.ceil(row.endposz);
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

function epochMillis(value: number): string {
  return new Date(value).toISOString();
}
