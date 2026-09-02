import { jest } from '@jest/globals';
import {
  clearPluginDataCache,
  ensurePluginDataForServer,
  getFirstCachedPluginData,
  getCachedPluginData,
  onlinePlayersFromEntry,
  refreshPluginDataForServer,
} from '../src/service/plugin-data-cache-service.js';
import type { ServerConfig } from '../src/interfaces/server-config.js';
import { getCachedServerPlayers } from '../src/service/server-plugin-data-service.js';

function server(input: Partial<ServerConfig> = {}): ServerConfig {
  return {
    id: 'server-1',
    label: 'Server',
    queryUrl: 'https://query.example/',
    public: true,
    createdAt: new Date(),
    ...input,
  };
}

describe('plugin data cache service', () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    clearPluginDataCache();
    process.env.PLUGIN_DATA_CACHE_TTL_MS = '60000';
    global.fetch = originalFetch;
  });

  afterEach(() => {
    clearPluginDataCache();
    global.fetch = originalFetch;
    restoreEnv(originalEnv);
  });

  test('discovers plugins even when no online players are known', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(response({ schemaVersion: 1, plugins: [
        { directory: 'OZAdminUtils', name: 'OZ - Admin Utils', version: '1', valid: true },
      ] }))
      .mockResolvedValueOnce(response({ players: [] })) as typeof fetch;
    global.fetch = fetchMock;

    const result = await refreshPluginDataForServer(server({ onlinePlayers: [] }));

    expect(result.refreshed).toBe(true);
    expect(result.entry?.plugins).toHaveLength(1);
    expect(result.entry?.data.__onlinePlayers).toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://query.example/pluginlist',
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenCalledWith('https://query.example/playerlist', expect.any(Object));
  });

  test('discovers plugins and caches available plugin route data', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(response({
        schemaVersion: 1,
        plugins: [
          { directory: 'OZAdminUtils', name: 'OZ - Admin Utils', version: '1', valid: true },
          { directory: 'OZGPS', name: 'OZ - GPS', version: '1', valid: true },
          { directory: 'OZMarketplace', name: 'OZ - Marketplace', version: '1', valid: true },
          { directory: 'OZShop', name: 'OZ - Shop', version: '1', valid: true },
          { directory: 'Broken', valid: false },
        ],
      }))
      .mockResolvedValueOnce(response({ players: [{ uid: 'online-p1', name: 'Online Player' }] }))
      .mockResolvedValueOnce(response({ areas: [{ id: 42, name: 'Spawn Claim' }] }))
      .mockResolvedValueOnce(response({ players: [{ uid: 'p1', name: 'Player', posx: 1, posz: 2, lastseen: 1000, online: true }] }))
      .mockResolvedValueOnce(response({ config: { Server_Admins: 'steam-admin' } }))
      .mockResolvedValueOnce(response({ markers: [{ id: 1, name: 'Spawn' }] }))
      .mockResolvedValueOnce(response({ zones: [{ areaId: 42 }] }))
      .mockResolvedValueOnce(response({ zones: [{ areaId: 42 }] }))
      .mockResolvedValueOnce(response({
        schemaVersion: 1,
        mapUrl: 'https://map.example.com/',
        adminUid: '76561198000000000',
        admins: ['76561198000000001'],
      }))
      .mockResolvedValueOnce(response({ offers: [{ id: 7, itemName: 'Stone' }] })) as typeof fetch;
    global.fetch = fetchMock;

    const result = await refreshPluginDataForServer(server({ onlinePlayers: [{ uid: 'p1' }] }));

    expect(result.refreshed).toBe(true);
    expect(result.entry?.plugins).toHaveLength(4);
    expect(result.entry?.data).toEqual({
      'ozadminutils.worldAreas': { areas: [{ id: 42, name: 'Spawn Claim' }] },
      'ozadminutils.playerlist': { players: [{ uid: 'p1', name: 'Player', posx: 1, posz: 2, lastseen: 1000, online: true }] },
      'ozadminutils.serverConfig': { config: { Server_Admins: 'steam-admin' } },
      'ozadminutils.info': {
        schemaVersion: 1,
        mapUrl: 'https://map.example.com/',
        adminUid: '76561198000000000',
        admins: ['76561198000000001'],
      },
      'ozgps.globalMarkers': { markers: [{ id: 1, name: 'Spawn' }] },
      'ozmarketplace.zones': { zones: [{ areaId: 42 }] },
      'ozshop.zones': { zones: [{ areaId: 42 }] },
      'ozmarketplace.offers.42': { offers: [{ id: 7, itemName: 'Stone' }] },
      __onlinePlayers: [{ uid: 'online-p1', name: 'Online Player' }],
    });
    expect(getCachedPluginData('server-1')?.data).toEqual(result.entry?.data);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://query.example/pluginlist',
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://query.example/playerlist',
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://query.example/plugins/oz---admin-utils/world-areas',
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      'https://query.example/plugins/oz---admin-utils/playerlist',
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      'https://query.example/plugins/oz---admin-utils/server-config',
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      6,
      'https://query.example/plugins/oz---gps/marker?type=global',
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      7,
      'https://query.example/plugins/oz---marketplace/zones',
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      8,
      'https://query.example/plugins/oz---shop/zones',
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      9,
      'https://query.example/plugins/oz---admin-utils/info',
      expect.any(Object),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      10,
      'https://query.example/plugins/oz---marketplace/offers?areaId=42',
      expect.any(Object),
    );
  });

  test('uses the game-owned player list instead of persisted plugin players', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(response({
        schemaVersion: 1,
        plugins: [{ directory: 'OZAdminUtils', name: 'OZ - Admin Utils', version: '1', valid: true }],
      }))
      .mockResolvedValueOnce(response({ players: [{ uid: 'live-player', name: 'Live' }] }))
      .mockResolvedValueOnce(response({ areas: [] }))
      .mockResolvedValueOnce(response({
        players: [
          { uid: 'offline-player', name: 'Offline' },
          { uid: 'live-player', name: 'Live', online: true },
        ],
      }))
      .mockResolvedValueOnce(response({ config: {} })) as typeof fetch;
    global.fetch = fetchMock;

    const result = await refreshPluginDataForServer(server({ onlinePlayers: [{ uid: 'stale-player' }] }));

    expect(result.entry?.data.__onlinePlayers).toEqual([{ uid: 'live-player', name: 'Live' }]);
    expect(onlinePlayersFromEntry(result.entry!)).toEqual([{ uid: 'live-player', name: 'Live' }]);
  });

  test('reads only the cached game player list', () => {
    const entry = (data: Record<string, unknown>) => ({
      serverId: 'server-1',
      refreshedAtMs: 0,
      expiresAtMs: 0,
      plugins: [],
      data,
    });

    expect(onlinePlayersFromEntry(entry({}))).toBeUndefined();
    expect(onlinePlayersFromEntry(entry({ 'ozadminutils.playerlist': { players: [{ uid: 'persisted' }] } }))).toBeUndefined();
    expect(onlinePlayersFromEntry(entry({ __onlinePlayers: 'invalid' }))).toBeUndefined();
    expect(onlinePlayersFromEntry(entry({ __onlinePlayers: [{ uid: 'live-player' }] }))).toEqual([{ uid: 'live-player' }]);
  });

  test('reports unavailable plugin list without caching partial data', async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce(response({}, 404)) as typeof fetch;
    global.fetch = fetchMock;

    await expect(refreshPluginDataForServer(server({ onlinePlayers: [{ uid: 'p1' }] }))).resolves.toEqual({
      refreshed: false,
      skippedReason: 'pluginListUnavailable',
    });
    expect(getCachedPluginData('server-1')).toBeUndefined();
  });

  test('skips refresh when no valid plugin query URL is available', async () => {
    const fetchMock = jest.fn() as typeof fetch;
    global.fetch = fetchMock;

    await expect(refreshPluginDataForServer(server({
      queryUrl: 'not a url',
      info: { description: '@queryUrl:not-a-url' },
    }))).resolves.toEqual({
      refreshed: false,
      skippedReason: 'queryUrlMissing',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('expires cached entries and ignores malformed plugin payloads', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_000);
    global.fetch = jest.fn().mockResolvedValueOnce(response({
      schemaVersion: 1,
      plugins: [
        null,
        { valid: 'yes' },
        { directory: 'OZGPS', name: 'OZ - GPS', version: 1, valid: true },
      ],
    })) as typeof fetch;

    await refreshPluginDataForServer(server({ onlinePlayers: [] }));
    expect(getFirstCachedPluginData()?.plugins).toEqual([{
      name: 'OZ - GPS',
      version: undefined,
      valid: true,
    }]);

    nowSpy.mockReturnValue(301_001);
    expect(getCachedPluginData('server-1')).toBeUndefined();
    expect(getFirstCachedPluginData()).toBeUndefined();
  });

  test('drops invalid optional spawn points from cached server players', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(response({
        schemaVersion: 1,
        plugins: [
          { directory: 'OZAdminUtils', name: 'OZ - Admin Utils', version: '1', valid: true },
        ],
      }))
      .mockResolvedValueOnce(response({ players: [{ uid: 'player-55', name: 'Player 55' }] }))
      .mockResolvedValueOnce(response({ areas: [] }))
      .mockResolvedValueOnce(response({
        players: [{
          id: 55,
          uid: 'player-55',
          name: 'Player 55',
          posx: 1,
          posy: 2,
          posz: 3,
          rotx: 0,
          roty: 0,
          rotz: 0,
          rotw: 1,
          platform: 'Steam',
          permissiongroup: 'default',
          health: 100,
          hunger: 100,
          thirst: 100,
          brokenbones: 0,
          temperature: 37,
          dead: 0,
          flying: 0,
          secondaryspawn: { x: null, y: 2, z: 3 },
          lastspawn: 0,
          lastusedmount: 0,
          lastusedvehicle: 0,
          playtime: 10,
          firstseen: 1000,
          lastseen: 2000,
        }],
      }))
      .mockResolvedValueOnce(response({ config: {} })) as typeof fetch;
    global.fetch = fetchMock;

    await refreshPluginDataForServer(server({ onlinePlayers: [{ uid: 'player-55' }] }));

    const players = getCachedServerPlayers('server-1');
    expect(players).toEqual([
      expect.objectContaining({
        id: 55,
        uid: 'player-55',
        name: 'Player 55',
      }),
    ]);
    expect(players[0].secondaryspawn).toBeUndefined();
  });

  test('uses the configured queryUrl and ignores legacy server-info markers', async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce(response({
      schemaVersion: 1,
      plugins: [],
    })) as typeof fetch;
    global.fetch = fetchMock;

    await refreshPluginDataForServer(server({
      info: {
        description: '@queryUrl:https://bridge.example/dev/',
      },
      onlinePlayers: [],
    }));

    expect(fetchMock).toHaveBeenCalledWith(
      'https://query.example/pluginlist',
      expect.any(Object),
    );
  });

  test('returns cached plugin data without refreshing when available', async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce(response({
      schemaVersion: 1,
      plugins: [],
    })) as typeof fetch;
    global.fetch = fetchMock;

    await refreshPluginDataForServer(server({ onlinePlayers: [] }));
    await expect(ensurePluginDataForServer(server({ onlinePlayers: [] })))
      .resolves.toBe(getCachedPluginData('server-1'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('does not derive native plugin URL from legacy backend map URL', async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce(response({
      schemaVersion: 1,
      plugins: [],
    })) as typeof fetch;
    global.fetch = fetchMock;

    await refreshPluginDataForServer(server({
      mapUrl: 'https://gs1.omega-zirkel.de/main.backend/',
      onlinePlayers: [],
    }));

    expect(fetchMock).toHaveBeenCalledWith(
      'https://query.example/pluginlist',
      expect.any(Object),
    );
  });

});

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function restoreEnv(snapshot: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in snapshot)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, snapshot);
}
