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
      renewZones: false,
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

  test('uses default root arguments for cache-only layer reads', async () => {
    await expect(getMapLayerCapabilities()).resolves.toMatchObject({
      schemaVersion: 1,
      claims: false,
      players: false,
    });
    await expect(getMapClaims()).resolves.toBeNull();
    await expect(getMapPlayers(false)).resolves.toBeNull();
    await expect(getMapGpsGlobalMarkers()).resolves.toBeNull();
    await expect(getMapMarketplaceOffers(42)).resolves.toBeNull();
  });

  test('maps configured city and leasehold colors from Land Claim settings', async () => {
    const root = await createWorld();
    mockPluginRouteResponses(true);

    await refreshPluginDataForServer({
      id: 'server-1',
      label: 'Server',
      queryUrl: 'https://query.example',
      onlinePlayers: [{ uid: 'player-1' }],
      public: true,
      createdAt: new Date(),
    });

    await expect(getMapClaims(root, 'server-1', 'player-1')).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        areaId: 45,
        borderColor: '#7B61FF10',
        fillColor: '#7B61FF50',
      }),
      expect.objectContaining({
        areaId: 46,
        borderColor: '#00BFA510',
        fillColor: '#00BFA550',
      }),
      expect.objectContaining({
        areaId: 47,
        borderColor: '#FF980010',
        fillColor: '#FF980050',
      }),
    ]));
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
        renewZones: true,
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
        renewZone: true,
        nextRenewalAt: '2026-01-02T00:00:00.000Z',
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
        renewZone: false,
        nextRenewalAt: undefined,
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
        renewZone: false,
        nextRenewalAt: undefined,
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
          { directory: 'OZShop', name: 'OZ - Shop', valid: true },
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
      .mockResolvedValueOnce(response({ zones: [{ areaId: 'bad' }, { areaId: 4 }] }))
      .mockResolvedValueOnce(response({ zones: [{ areaId: 3 }] }))
      .mockResolvedValueOnce(response({ listings: [{ areaId: 3, price: 5, status: 'INACTIVE' }] }))
      .mockResolvedValueOnce(response({ zones: [{ areaId: 'bad' }, { areaId: 3, nextRenewalAt: 0 }] }))
      .mockResolvedValueOnce(response({
        schemaVersion: 1,
        mapUrl: 'https://map.example.com/',
        adminUid: '76561198000000000',
        admins: [],
      }))
      .mockResolvedValueOnce(response({
        offers: [
          { id: 'bad' },
          {
            id: 7,
            itemName: 'Valid Offer',
            itemVariant: 0,
            amount: 1,
            price: 2,
            currency: 'coins',
            sellerName: 'Seller',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      })) as typeof fetch;

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
      renewZone: true,
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
    await expect(getMapMarketplaceOffers(4, root, 'server-1')).resolves.toEqual([{
      id: 7,
      itemName: 'Valid Offer',
      itemVariant: 0,
      amount: 1,
      price: 2,
      currency: 'coins',
      sellerName: 'Seller',
      createdAt: '2026-01-01T00:00:00.000Z',
    }]);
  });
});

async function createWorld(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rw-map-layers-'));
  await mkdir(root, { recursive: true });
  return root;
}

function mockPluginRouteResponses(includeCityAreas = false): void {
  global.fetch = jest
    .fn()
    .mockResolvedValueOnce(response({
      plugins: [
        { directory: 'OZAdminUtils', name: 'OZ - Admin Utils', valid: true },
        { directory: 'OZGPS', name: 'OZ - GPS', valid: true },
        { directory: 'OZMarketplace', name: 'OZ - Marketplace', valid: true },
        { directory: 'OZShop', name: 'OZ - Shop', valid: true },
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
        specialCityCorePermission: 'custom-city-core',
        specialCityLeaseholdPermission: 'custom-city-leasehold',
        cityCoreBorderColor: '0x7B61FF10',
        cityCoreFrameColor: '0x7B61FF50',
        cityLeaseholdAvailableBorderColor: '0x00BFA510',
        cityLeaseholdAvailableFrameColor: '0x00BFA550',
        cityLeaseholdOccupiedBorderColor: '0xFF980010',
        cityLeaseholdOccupiedFrameColor: '0xFF980050',
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
        ...(includeCityAreas ? [
          {
            id: 45,
            name: 'City Core',
            permission: 'custom-city-core',
            priority: 0,
            startX: 128,
            startY: 0,
            startZ: 0,
            endX: 159.99,
            endY: 64,
            endZ: 31.99,
            createdAt: '2026-01-01T00:00:05.000Z',
          },
          {
            id: 46,
            name: 'Available Leasehold',
            permission: 'custom-city-leasehold',
            priority: 0,
            startX: 160,
            startY: 0,
            startZ: 0,
            endX: 191.99,
            endY: 64,
            endZ: 31.99,
            createdAt: '2026-01-01T00:00:06.000Z',
          },
          {
            id: 47,
            name: 'Occupied Leasehold',
            permission: 'custom-city-leasehold',
            priority: 0,
            startX: 192,
            startY: 0,
            startZ: 0,
            endX: 223.99,
            endY: 64,
            endZ: 31.99,
            ownerUid: 'player-1',
            ownerName: 'Cached Player',
            createdAt: '2026-01-01T00:00:07.000Z',
          },
        ] : []),
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
        online: true,
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
      zones: [{
        areaId: 42,
        nextRenewalAt: Date.parse('2026-01-02T00:00:00.000Z'),
        borderColor: '#00C2A89C',
        frameColor: '#00C2A8AA',
      }],
    }))
    .mockResolvedValueOnce(response({
      schemaVersion: 1,
      mapUrl: 'https://map.example.com/',
      adminUid: '76561198000000000',
      admins: ['76561198000000001'],
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
