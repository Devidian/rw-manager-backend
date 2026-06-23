import Database from 'better-sqlite3';
import { jest } from '@jest/globals';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  getMapClaims,
  getMapGpsGlobalMarkers,
  getMapLayerCapabilities,
  getMapMarketplaceOffers,
  getMapPlayers,
} from '../src/service/map-layer-service.js';

describe('map layer service', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    restoreEnv(originalEnv);
    jest.restoreAllMocks();
  });

  test('reports unavailable optional capabilities for a plugin-free world', async () => {
    const root = await createWorld();

    await expect(getMapLayerCapabilities(root)).resolves.toEqual({
      schemaVersion: 1,
      worldName: 'Test World',
      sectorSizeChunks: 256,
      chunkSizeBlocks: 32,
      sectorSizeBlocks: 8192,
      recentPlayerDays: 7,
      claims: false,
      claimSales: false,
      marketplace: false,
      shop: false,
      players: true,
      gpsGlobalMarkers: false,
    });
    await expect(getMapClaims(root)).resolves.toBeNull();
  });

  test('normalizes claims and enriches owners, sales, marketplace, and shop flags', async () => {
    const root = await createWorld();
    await createPlugin(root, 'LandClaimRuntime', 'OZ - Land Claim');
    await createPlugin(root, 'MarketplaceRuntime', 'OZ - Marketplace');
    await createPlugin(root, 'ShopRuntime', 'OZ - Shop');
    await writeFile(
      path.join(root, 'Plugins', 'LandClaimRuntime', 'settings.properties'),
      [
        'allowClaimSale=true',
        'ownerAreaPermission=custom-owner',
        'defaultAreaPermission=custom-guest',
        'otherAreaBorderColor=0x11223344',
        'otherAreaFrameColor=0x55667788',
        'forSaleAreaBorderColor=0xAABBCCDD',
        'forSaleAreaFrameColor=0x01020304',
      ].join('\n'),
    );

    const areas = new Database(path.join(root, 'Worlds', 'Test World', 'Areas.db'));
    areas.prepare(`
      INSERT INTO areas(
        id, shape, name, startposx, startposz, endposx, endposz, permission, creationdate
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(42, 'Rectangular', 'Claim', -64, 32, -32.01, 95.99, 'custom-guest', 1_700_000_000);
    areas.prepare('INSERT INTO rights(areaid, playerid, permission) VALUES (?, ?, ?)')
      .run(42, 7, 'custom-owner');
    areas.close();

    const landClaim = new Database(path.join(root, 'Plugins', 'LandClaimRuntime', 'Test World.db'));
    landClaim.exec(`
      CREATE TABLE claimSaleListings (
        id INTEGER PRIMARY KEY,
        world TEXT,
        area_id INTEGER,
        price INTEGER,
        listed_at INTEGER,
        status TEXT
      );
      INSERT INTO claimSaleListings VALUES (1, 'Test World', 42, 250, 1700000000000, 'ACTIVE');
    `);
    landClaim.close();

    const marketplace = new Database(path.join(root, 'Plugins', 'MarketplaceRuntime', 'Test World.db'));
    marketplace.exec(`
      CREATE TABLE marketplace_zones (id TEXT PRIMARY KEY, area_id INTEGER);
      CREATE TABLE marketplace_listings (
        id INTEGER PRIMARY KEY,
        seller_name TEXT,
        item_name TEXT,
        item_variant INTEGER,
        amount INTEGER,
        price INTEGER,
        currency_identifier TEXT,
        market_zone_id TEXT,
        global_listing INTEGER,
        created_at INTEGER,
        status TEXT
      );
      INSERT INTO marketplace_zones VALUES ('market-42', 42);
      INSERT INTO marketplace_listings VALUES
        (2, 'Seller', 'iron_ingot', 3, 4, 90, 'coins', 'market-42', 0, 1700000000000, 'ACTIVE'),
        (3, 'Seller', 'global_item', 0, 1, 10, 'coins', 'market-42', 1, 1700000000001, 'ACTIVE');
    `);
    marketplace.close();

    const shop = new Database(path.join(root, 'Plugins', 'ShopRuntime', 'Test World.db'));
    shop.exec('CREATE TABLE shop_zones (area_id INTEGER PRIMARY KEY); INSERT INTO shop_zones VALUES (42);');
    shop.close();

    await expect(getMapLayerCapabilities(root)).resolves.toEqual(
      expect.objectContaining({
        claims: true,
        claimSales: true,
        marketplace: true,
        shop: true,
      }),
    );
    await expect(getMapClaims(root)).resolves.toEqual([{
      areaId: 42,
      name: 'Claim',
      permission: 'custom-guest',
      minX: -64,
      minZ: 32,
      width: 32,
      depth: 64,
      ownerName: 'Owner',
      createdAt: '2023-11-14T22:13:20.000Z',
      borderColor: '#AABBCCDD',
      fillColor: '#01020304',
      forSale: true,
      salePrice: 250,
      marketplace: true,
      shop: true,
    }]);

    await expect(getMapMarketplaceOffers(42, root)).resolves.toEqual([
      {
        id: 3,
        itemName: 'global_item',
        itemVariant: 0,
        amount: 1,
        price: 10,
        currency: 'coins',
        sellerName: 'Seller',
        createdAt: '2023-11-14T22:13:20.001Z',
      },
      {
        id: 2,
        itemName: 'iron_ingot',
        itemVariant: 3,
        amount: 4,
        price: 90,
        currency: 'coins',
        sellerName: 'Seller',
        createdAt: '2023-11-14T22:13:20.000Z',
      },
    ]);
  });

  test('reports and returns GPS global markers when the GPS plugin schema is available', async () => {
    const root = await createWorld();
    await createPlugin(root, 'GPSRuntime', 'OZ - GPS');
    const gps = new Database(path.join(root, 'Plugins', 'GPSRuntime', 'Test World.db'));
    gps.exec(`
      CREATE TABLE marker (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        player_id INTEGER NOT NULL,
        type VARCHAR(16) NOT NULL,
        group_name TEXT,
        created_at BIGINT NOT NULL,
        pos_x REAL NOT NULL,
        pos_y REAL NOT NULL,
        pos_z REAL NOT NULL,
        name TEXT NOT NULL,
        icon TEXT NOT NULL,
        color INTEGER NOT NULL,
        cost INTEGER NOT NULL
      );
      INSERT INTO marker VALUES
        (1, 7, 'PRIVATE', NULL, 1700000000000, 1, 2, 3, 'Private', 'private-icon', -1, 0),
        (2, 7, 'GLOBAL', NULL, 1700000000001, -32.5, 64, 96.25, 'Spawn', 'global-icon', -1, 0),
        (3, 7, 'GLOBAL', NULL, 1700000000002, 10, 20, -30, 'Market', 'market-icon', 305419896, 0);
    `);
    gps.close();

    await expect(getMapLayerCapabilities(root)).resolves.toEqual(
      expect.objectContaining({ gpsGlobalMarkers: true }),
    );
    await expect(getMapGpsGlobalMarkers(root)).resolves.toEqual([
      {
        id: 3,
        name: 'Market',
        x: 10,
        y: 20,
        z: -30,
        icon: 'market-icon',
        color: '#12345678',
        createdAt: '2023-11-14T22:13:20.002Z',
      },
      {
        id: 2,
        name: 'Spawn',
        x: -32.5,
        y: 64,
        z: 96.25,
        icon: 'global-icon',
        color: '#FFFFFFFF',
        createdAt: '2023-11-14T22:13:20.001Z',
      },
    ]);
  });

  test('returns unavailable GPS markers for missing or incompatible GPS schemas', async () => {
    const missingRoot = await createWorld();
    await expect(getMapGpsGlobalMarkers(missingRoot)).resolves.toBeNull();

    const incompatibleRoot = await createWorld();
    await createPlugin(incompatibleRoot, 'GPSRuntime', 'OZ - GPS');
    const incompatible = new Database(
      path.join(incompatibleRoot, 'Plugins', 'GPSRuntime', 'Test World.db'),
    );
    incompatible.exec('CREATE TABLE marker (id INTEGER PRIMARY KEY, type TEXT)');
    incompatible.close();
    await expect(getMapGpsGlobalMarkers(incompatibleRoot)).resolves.toBeNull();
    await expect(getMapLayerCapabilities(incompatibleRoot)).resolves.toEqual(
      expect.objectContaining({ gpsGlobalMarkers: false }),
    );
  });

  test('rejects incompatible claim schemas and filters malformed areas safely', async () => {
    const incompatibleRoot = await createWorld();
    await createPlugin(incompatibleRoot, 'LandClaimRuntime', 'OZ - Land Claim');
    const incompatible = new Database(
      path.join(incompatibleRoot, 'Worlds', 'Test World', 'Areas.db'),
    );
    incompatible.exec('DROP TABLE rights');
    incompatible.close();
    await expect(getMapClaims(incompatibleRoot)).resolves.toBeNull();

    const root = await createWorld();
    await createPlugin(root, 'LandClaimRuntime', 'OZ - Land Claim');
    await rm(path.join(root, 'Worlds', 'Test World', 'Player.db'));
    await writeFile(
      path.join(root, 'Plugins', 'LandClaimRuntime', 'settings.properties'),
      'otherAreaBorderColor=invalid\n',
    );
    const areas = new Database(path.join(root, 'Worlds', 'Test World', 'Areas.db'));
    const insert = areas.prepare(`
      INSERT INTO areas(
        id, shape, name, startposx, startposz, endposx, endposz, permission, creationdate
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insert.run(1, 'Circle', 'Wrong shape', 0, 0, 31.99, 31.99, 'ozlc-guest', 1);
    insert.run(2, 'Rectangular', 'No permission', 0, 0, 31.99, 31.99, null, 1);
    insert.run(3, 'Rectangular', 'Foreign', 0, 0, 31.99, 31.99, 'foreign', 1);
    insert.run(4, 'Rectangular', 'Bad geometry', 0, 0, 30, 31.99, 'ozlc-guest', 1);
    insert.run(5, 'Rectangular', '', 0, 0, 31.99, 31.99, 'ozlc-guest', 0);
    areas.close();

    await expect(getMapClaims(root)).resolves.toEqual([expect.objectContaining({
      areaId: 5,
      name: 'Area #5',
      ownerName: undefined,
      createdAt: undefined,
      borderColor: '#0010E010',
      forSale: false,
      marketplace: false,
      shop: false,
    })]);
  });

  test('returns unavailable or empty Marketplace results for missing schemas and zones', async () => {
    const missingRoot = await createWorld();
    await expect(getMapMarketplaceOffers(1, missingRoot)).resolves.toBeNull();

    const incompatibleRoot = await createWorld();
    await createPlugin(incompatibleRoot, 'MarketplaceRuntime', 'OZ - Marketplace');
    const incompatible = new Database(
      path.join(incompatibleRoot, 'Plugins', 'MarketplaceRuntime', 'Test World.db'),
    );
    incompatible.exec('CREATE TABLE marketplace_zones (id TEXT PRIMARY KEY)');
    incompatible.close();
    await expect(getMapMarketplaceOffers(1, incompatibleRoot)).resolves.toBeNull();

    const root = await createWorld();
    await createPlugin(root, 'MarketplaceRuntime', 'OZ - Marketplace');
    const database = new Database(
      path.join(root, 'Plugins', 'MarketplaceRuntime', 'Test World.db'),
    );
    database.exec(`
      CREATE TABLE marketplace_zones (id TEXT PRIMARY KEY, area_id INTEGER);
      CREATE TABLE marketplace_listings (
        id INTEGER PRIMARY KEY, seller_name TEXT, item_name TEXT, item_variant INTEGER,
        amount INTEGER, price INTEGER, currency_identifier TEXT, market_zone_id TEXT,
        global_listing INTEGER, created_at INTEGER, status TEXT
      );
    `);
    database.close();
    await expect(getMapMarketplaceOffers(999, root)).resolves.toEqual([]);
  });

  test('filters long-term players unless explicitly authorized', async () => {
    const root = await createWorld();
    process.env.MAP_RECENT_PLAYER_DAYS = '7';
    const now = new Date('2026-06-18T12:00:00.000Z');

    const publicPlayers = await getMapPlayers(false, root, now);
    expect(publicPlayers?.map(({ id, state }) => ({ id, state }))).toEqual([
      { id: 'owner-uid', state: 'recent-offline' },
      { id: 'recent-uid', state: 'recent-offline' },
    ]);
    const adminPlayers = await getMapPlayers(true, root, now);
    expect(adminPlayers?.map(({ id, state }) => ({ id, state }))).toEqual([
      { id: 'long-uid', state: 'long-term-offline' },
      { id: 'online-uid', state: 'long-term-offline' },
      { id: 'owner-uid', state: 'recent-offline' },
      { id: 'recent-uid', state: 'recent-offline' },
    ]);
  });

  test('handles missing player schemas, invalid positions, and empty UIDs', async () => {
    const missingRoot = await createWorld();
    const missing = new Database(path.join(missingRoot, 'Worlds', 'Test World', 'Player.db'));
    missing.exec('DROP TABLE player');
    missing.close();
    await expect(getMapPlayers(false, missingRoot)).resolves.toBeNull();

    const root = await createWorld();
    const players = new Database(path.join(root, 'Worlds', 'Test World', 'Player.db'));
    players.prepare(
      'INSERT INTO player(id, uid, name, posx, posz, lastseen) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(20, '', 'No UID', 10, 20, 0);
    players.prepare(
      'INSERT INTO player(id, uid, name, posx, posz, lastseen) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(21, 'invalid-position', 'Invalid', Number.NaN, 20, 0);
    players.close();

    const result = await getMapPlayers(true, root, new Date('2026-06-18T12:00:00Z'));
    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: '20',
        state: 'long-term-offline',
        lastSeen: '1970-01-01T00:00:00.000Z',
      }),
    ]));
    expect(result?.some((player) => player.id === 'invalid-position')).toBe(false);

    await expect(getMapPlayers(false, root)).resolves.toEqual(
      expect.not.arrayContaining([expect.objectContaining({ id: 'long-uid' })]),
    );
  });
});

async function createWorld(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rw-map-layers-'));
  const world = path.join(root, 'Worlds', 'Test World');
  await mkdir(world, { recursive: true });
  await writeFile(path.join(root, 'server.properties'), 'World_Name=Test World\n');

  const areas = new Database(path.join(world, 'Areas.db'));
  areas.exec(`
    CREATE TABLE areas (
      id INTEGER PRIMARY KEY,
      shape TEXT,
      name TEXT,
      startposx REAL,
      startposz REAL,
      endposx REAL,
      endposz REAL,
      permission TEXT,
      creationdate INTEGER
    );
    CREATE TABLE rights (areaid INTEGER, playerid INTEGER, permission TEXT);
  `);
  areas.close();

  const players = new Database(path.join(world, 'Player.db'));
  players.exec(`
    CREATE TABLE player (
      id INTEGER PRIMARY KEY,
      uid TEXT,
      name TEXT,
      posx REAL,
      posz REAL,
      lastseen INTEGER
    );
  `);
  const insert = players.prepare(
    'INSERT INTO player(id, uid, name, posx, posz, lastseen) VALUES (?, ?, ?, ?, ?, ?)',
  );
  insert.run(7, 'owner-uid', 'Owner', 0, 0, epoch('2026-06-18T11:00:00Z'));
  insert.run(8, 'online-uid', 'Online', 1.5, -2.5, epoch('2026-05-01T00:00:00Z'));
  insert.run(9, 'recent-uid', 'Recent', 3.5, 4.5, epoch('2026-06-15T00:00:00Z'));
  insert.run(10, 'long-uid', 'Long', 5.5, 6.5, epoch('2026-05-01T00:00:00Z'));
  players.close();
  return root;
}

async function createPlugin(root: string, directory: string, name: string): Promise<void> {
  const pluginPath = path.join(root, 'Plugins', directory);
  await mkdir(pluginPath, { recursive: true });
  await writeFile(path.join(pluginPath, 'plugin.yml'), `name: "${name}"\nversion: "1.0.0"\n`);
}

function epoch(value: string): number {
  return Math.floor(new Date(value).getTime() / 1000);
}

function restoreEnv(snapshot: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in snapshot)) delete process.env[key];
  }
  Object.assign(process.env, snapshot);
}
