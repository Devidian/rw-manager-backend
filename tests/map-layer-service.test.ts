import { jest } from '@jest/globals';
import { mkdtemp, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  getMapClaims,
  getMapGpsGlobalMarkers,
  getMapLayerCapabilities,
  getMapMarketplaceOffers,
  getMapPlayers,
} from '../src/service/map-layer-service.js';
import {
  clearPluginDataCache,
  refreshPluginDataForServer,
} from '../src/service/plugin-data-cache-service.js';

describe('map layer service', () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  afterEach(() => {
    clearPluginDataCache();
    restoreEnv(originalEnv);
    jest.restoreAllMocks();
    global.fetch = originalFetch;
  });

  test('reports unavailable optional capabilities when no plugin cache exists', async () => {
    const root = await createWorld();

    await expect(getMapLayerCapabilities(root)).resolves.toEqual({
      schemaVersion: 1,
      worldName: 'Unknown World',
      sectorSizeChunks: 256,
      chunkSizeBlocks: 32,
      sectorSizeBlocks: 8192,
      recentPlayerDays: 7,
      claims: false,
      claimSales: false,
      marketplace: false,
      shop: false,
      players: false,
      gpsGlobalMarkers: false,
    });
    await expect(getMapClaims(root)).resolves.toBeNull();
    await expect(getMapPlayers(false, root)).resolves.toBeNull();
    await expect(getMapGpsGlobalMarkers(root)).resolves.toBeNull();
    await expect(getMapMarketplaceOffers(42, root)).resolves.toBeNull();
  });

  test('normalizes cached plugin route data for map layers', async () => {
    process.env.MAP_RECENT_PLAYER_DAYS = '7';
    const root = await createWorld();
    mockPluginRouteResponses();

    await refreshPluginDataForServer({
      id: 'server-1',
      label: 'Server',
      queryUrl: 'https://query.example',
      onlinePlayers: [{ uid: 'player-1' }],
      public: true,
      createdAt: new Date(),
    });

    await expect(getMapLayerCapabilities(root, 'server-1')).resolves.toEqual(
      expect.objectContaining({
        claims: true,
        claimSales: true,
        marketplace: true,
        shop: true,
        players: true,
        gpsGlobalMarkers: true,
      }),
    );
    await expect(getMapGpsGlobalMarkers(root, 'server-1')).resolves.toEqual([{
      id: 5,
      name: 'Cached GPS',
      x: 1,
      y: 2,
      z: 3,
      icon: 'cached-icon',
      color: '#01020304',
      createdAt: '2026-01-01T00:00:00.000Z',
    }]);
    await expect(getMapMarketplaceOffers(42, root, 'server-1')).resolves.toEqual([{
      id: 9,
      itemName: 'Cached Stone',
      itemVariant: 0,
      amount: 12,
      price: 33,
      currency: 'coins',
      sellerName: 'Alice',
      createdAt: '2026-01-01T00:00:01.000Z',
    }]);
    await expect(getMapClaims(root, 'server-1', 'player-1')).resolves.toEqual([
      {
        areaId: 42,
        name: 'Cached Claim',
        permission: 'custom-guest',
        minX: -64,
        minZ: 32,
        width: 32,
        depth: 64,
        ownerName: 'Cached Player',
        createdAt: '2026-01-01T00:00:02.000Z',
        borderColor: '#00FFFF10',
        fillColor: '#00FFFF50',
        forSale: true,
        salePrice: 1000,
        marketplace: true,
        shop: true,
      },
      {
        areaId: 44,
        name: 'Cached Own Claim',
        permission: 'custom-guest',
        minX: 64,
        minZ: 0,
        width: 32,
        depth: 32,
        ownerName: 'Cached Player',
        createdAt: '2026-01-01T00:00:04.000Z',
        borderColor: '#99AABBCC',
        fillColor: '#DDEEFF00',
        forSale: false,
        salePrice: undefined,
        marketplace: false,
        shop: false,
      },
      {
        areaId: 43,
        name: 'Cached Other Claim',
        permission: 'custom-guest',
        minX: 0,
        minZ: 0,
        width: 32,
        depth: 32,
        ownerName: 'Other Player',
        createdAt: '2026-01-01T00:00:03.000Z',
        borderColor: '#11223344',
        fillColor: '#55667788',
        forSale: false,
        salePrice: undefined,
        marketplace: false,
        shop: false,
      },
    ]);
    await expect(getMapPlayers(false, root, new Date('2026-01-02T00:00:00.000Z'), 'server-1'))
      .resolves.toEqual([{
        id: 'player-1',
        name: 'Cached Player',
        x: 11,
        z: 22,
        state: 'online',
        lastSeen: '2026-01-01T00:00:00.000Z',
      }]);
  });

  test('filters malformed cached map payloads safely', async () => {
    const root = await createWorld();
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(response({
        plugins: [
          { directory: 'OZAdminUtils', name: 'OZ - Admin Utils', valid: true },
          { directory: 'OZGPS', name: 'OZ - GPS', valid: true },
          { directory: 'OZMarketplace', name: 'OZ - Marketplace', valid: true },
          { directory: 'OZShop', name: 'OZShop', valid: true },
          { directory: 'OZLandClaim', name: 'OZ - Land Claim', valid: true },
        ],
      }))
      .mockResolvedValueOnce(response({
        settings: {
          defaultAreaPermission: 'custom-guest',
          otherAreaBorderColor: 'invalid',
        },
        worldName: 'Test World',
        areas: [
          { id: 0, name: 'Bad ID', permission: 'custom-guest', startX: 0, startZ: 0, endX: 32, endZ: 32 },
          { id: 1, name: 'Foreign', permission: 'foreign', startX: 0, startZ: 0, endX: 32, endZ: 32 },
          { id: 2, name: 'Bad Geometry', permission: 'custom-guest', startX: 0, startZ: 0, endX: 30, endZ: 32 },
          { id: 3, name: 'Valid', permission: 'custom-guest', startX: 0, startZ: 0, endX: 32, endZ: 32 },
        ],
      }))
      .mockResolvedValueOnce(response({
        players: [
          { id: 1, uid: '', name: 'No UID', posx: 10, posz: 20, lastseen: 0 },
          { id: 2, uid: 'bad-pos', name: 'Bad Position', posx: Number.NaN, posz: 20, lastseen: 0 },
          { id: 3, uid: 'old', name: 'Old', posx: 1, posz: 2, lastseen: 1 },
        ],
      }))
      .mockResolvedValueOnce(response({ config: { Server_Admins: '' } }))
      .mockResolvedValueOnce(response({ markers: [{ id: 'bad' }, { id: 1, name: 'Valid', x: 1, y: 2, z: 3, icon: 'i', color: '#fff', createdAt: 'x' }] }))
      .mockResolvedValueOnce(response({ zones: [{ areaId: 'bad' }] }))
      .mockResolvedValueOnce(response({ zones: [{ areaId: 3 }] }))
      .mockResolvedValueOnce(response({ listings: [{ areaId: 3, price: 5, status: 'INACTIVE' }] })) as typeof fetch;

    await refreshPluginDataForServer({
      id: 'server-1',
      label: 'Server',
      queryUrl: 'https://query.example',
      onlinePlayers: [{ uid: 'online' }],
      public: true,
      createdAt: new Date(),
    });

    await expect(getMapClaims(root, 'server-1')).resolves.toEqual([expect.objectContaining({
      areaId: 3,
      borderColor: '#0010E010',
      forSale: false,
      marketplace: false,
      shop: true,
    })]);
    await expect(getMapPlayers(false, root, new Date('2026-01-01T00:00:00.000Z'), 'server-1'))
      .resolves.toEqual([]);
    await expect(getMapPlayers(true, root, new Date('2026-01-01T00:00:00.000Z'), 'server-1'))
      .resolves.toEqual(expect.arrayContaining([expect.objectContaining({
        id: '1',
        state: 'long-term-offline',
        lastSeen: '1970-01-01T00:00:00.000Z',
      })]));
    await expect(getMapGpsGlobalMarkers(root, 'server-1')).resolves.toEqual([
      { id: 1, name: 'Valid', x: 1, y: 2, z: 3, icon: 'i', color: '#fff', createdAt: 'x' },
    ]);
  });
});

async function createWorld(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rw-map-layers-'));
  await mkdir(root, { recursive: true });
  return root;
}

function mockPluginRouteResponses(): void {
  global.fetch = jest
    .fn()
    .mockResolvedValueOnce(response({
      plugins: [
        { directory: 'OZAdminUtils', name: 'OZ - Admin Utils', valid: true },
        { directory: 'OZGPS', name: 'OZ - GPS', valid: true },
        { directory: 'OZMarketplace', name: 'OZ - Marketplace', valid: true },
        { directory: 'OZShop', name: 'OZShop', valid: true },
        { directory: 'OZLandClaim', name: 'OZ - Land Claim', valid: true },
      ],
    }))
    .mockResolvedValueOnce(response({
      settings: {
        allowClaimSale: 'true',
        ownerAreaPermission: 'ozlc-owner',
        defaultAreaPermission: 'custom-guest',
        otherAreaBorderColor: '0x11223344',
        otherAreaFrameColor: '0x55667788',
        ownerAreaBorderColor: '0x99AABBCC',
        ownerAreaFrameColor: '0xDDEEFF00',
      },
      worldName: 'Test World',
      areas: [
        {
          id: 42,
          name: 'Cached Claim',
          permission: 'custom-guest',
          priority: 0,
          startX: -64,
          startY: 0,
          startZ: 32,
          endX: -32.01,
          endY: 64,
          endZ: 95.99,
          ownerUid: 'player-1',
          ownerName: 'Cached Player',
          createdAt: '2026-01-01T00:00:02.000Z',
        },
        {
          id: 44,
          name: 'Cached Own Claim',
          permission: 'custom-guest',
          priority: 0,
          startX: 64,
          startY: 0,
          startZ: 0,
          endX: 95.99,
          endY: 64,
          endZ: 31.99,
          ownerUid: 'player-1',
          ownerName: 'Cached Player',
          createdAt: '2026-01-01T00:00:04.000Z',
        },
        {
          id: 43,
          name: 'Cached Other Claim',
          permission: 'custom-guest',
          priority: 0,
          startX: 0,
          startY: 0,
          startZ: 0,
          endX: 31.99,
          endY: 64,
          endZ: 31.99,
          ownerUid: 'player-2',
          ownerName: 'Other Player',
          createdAt: '2026-01-01T00:00:03.000Z',
        },
      ],
    }))
    .mockResolvedValueOnce(response({
      players: [{
        id: 5,
        uid: 'player-1',
        name: 'Cached Player',
        posx: 11,
        posz: 22,
        lastseen: 1767225600,
      }],
    }))
    .mockResolvedValueOnce(response({ config: { Server_Admins: 'steam-admin' } }))
    .mockResolvedValueOnce(response({
      markers: [{
        id: 5,
        name: 'Cached GPS',
        x: 1,
        y: 2,
        z: 3,
        icon: 'cached-icon',
        color: '#01020304',
        createdAt: '2026-01-01T00:00:00.000Z',
      }],
    }))
    .mockResolvedValueOnce(response({ zones: [{ areaId: 42 }] }))
    .mockResolvedValueOnce(response({ zones: [{ areaId: 42 }] }))
    .mockResolvedValueOnce(response({
      listings: [{
        id: 1,
        areaId: 42,
        price: 1000,
        status: 'ACTIVE',
      }],
    }))
    .mockResolvedValueOnce(response({
      offers: [{
        id: 9,
        itemName: 'Cached Stone',
        itemVariant: 0,
        amount: 12,
        price: 33,
        currency: 'coins',
        sellerName: 'Alice',
        createdAt: '2026-01-01T00:00:01.000Z',
      }],
    })) as typeof fetch;
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function restoreEnv(snapshot: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in snapshot)) delete process.env[key];
  }
  Object.assign(process.env, snapshot);
}
