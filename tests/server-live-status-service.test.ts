import { jest } from '@jest/globals';

interface StoredServer {
  id: string;
  label: string;
  queryUrl: string;
  mapUrl?: string;
  adminUid?: string;
  data?: unknown;
  info?: unknown;
  status?: 'online' | 'offline' | 'unknown';
  onlinePlayers?: unknown[];
  knownPlayers?: Array<{ uid: string; name?: string; platform?: string | number; firstseen?: number; lastseen?: number }>;
  lastChecked?: Date | string;
  errorMessage?: string;
  queryDataUpdatedAt?: Date | string;
  public: boolean;
  createdAt: Date | string;
}

const state = { servers: [] as StoredServer[], serverStatistics: [] as unknown[] };
const writeMock = jest.fn<() => Promise<void>>().mockResolvedValue();
jest.unstable_mockModule('../src/db/json.js', () => ({ db: { data: state, write: writeMock } }));
const service = await import('../src/service/server-live-status-service.js');

describe('server-live-status-service', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.LIVE_QUERY_PROXY_CACHE_TTL_MS = '1000';
    process.env.LIVE_QUERY_PROXY_TIMEOUT_MS = '1000';
    process.env.SERVER_QUERY_REFRESH_INTERVAL_MS = '60000';
    state.servers = [{
      id: 'server-1', label: 'Server', queryUrl: 'http://query.example', public: true,
      createdAt: new Date().toISOString(),
    }];
    state.serverStatistics = [];
    writeMock.mockClear();
    service.clearServerLiveStatusCache();
  });

  afterAll(() => { global.fetch = originalFetch; });

  test('fetches game status, game-server overview metadata, native metadata, and game-owned online players', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(response({ name: 'Server', playercount: 9 }))
      .mockResolvedValueOnce(response({ name: 'Server overview', shortname: 'Overview', description: 'Info' }))
      .mockResolvedValueOnce(response({
        schemaVersion: 1,
        mapUrl: 'https://map.example/',
        adminUid: '76561198000000000',
        admins: [],
      }))
      .mockResolvedValueOnce(response({ players: [{ uid: '76561198000000000', name: 'Alice' }] })) as typeof fetch;
    global.fetch = fetchMock;

    await expect(service.getServerLiveStatus('server-1')).resolves.toMatchObject({
      status: 'online',
      queryData: { name: 'Server', playercount: 9 },
      infoData: { name: 'Server overview', shortname: 'Overview', description: 'Info' },
      onlinePlayers: [{ uid: '76561198000000000', name: 'Alice' }],
    });
    await service.getServerLiveStatus('server-1');

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock).toHaveBeenNthCalledWith(1, 'http://query.example', expect.any(Object));
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'http://query.example/info', expect.any(Object));
    expect(fetchMock).toHaveBeenNthCalledWith(3, 'http://query.example/plugins/oz---admin-utils/info', expect.any(Object));
    expect(fetchMock).toHaveBeenNthCalledWith(4, 'http://query.example/playerlist', expect.any(Object));
    expect(state.servers[0]).toMatchObject({
      mapUrl: 'https://map.example/', adminUid: '76561198000000000', status: 'online',
      onlinePlayers: [{ uid: '76561198000000000', name: 'Alice' }],
    });
  });

  test('uses the game player list as the online signal when the game query fails', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce(response({}, 500))
      .mockResolvedValueOnce(response({}, 404))
      .mockResolvedValueOnce(response({}, 404))
      .mockResolvedValueOnce(response({ players: [{ uid: 'player-1' }] })) as typeof fetch;

    await expect(service.getServerLiveStatus('server-1')).resolves.toMatchObject({
      status: 'online', errorMessage: 'HTTP 500', onlinePlayers: [{ uid: 'player-1' }],
    });
  });

  test('refreshes active server player lists independently of the full query interval', async () => {
    state.servers[0].status = 'online';
    state.servers[0].onlinePlayers = [{ uid: 'previous-player' }];
    state.servers[0].lastChecked = new Date(0).toISOString();
    global.fetch = jest.fn().mockResolvedValueOnce(response({
      players: [{ uid: 'current-player', name: 'Current' }],
    })) as typeof fetch;

    await expect(service.refreshDueServerPlayerLists()).resolves.toEqual({ checked: 1, refreshed: 1 });

    expect(global.fetch).toHaveBeenCalledWith('http://query.example/playerlist', expect.any(Object));
    expect(state.servers[0]).toMatchObject({
      onlinePlayers: [{ uid: 'current-player', name: 'Current' }],
      status: 'online',
    });
  });

  test('does not accept description markers as native configuration', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce(response({ name: 'Server', playercount: 1 }))
      .mockResolvedValueOnce(response({ description: '@mapUrl:https://bridge.example/' }))
      .mockResolvedValueOnce(response({ players: [] })) as typeof fetch;

    await service.getServerLiveStatus('server-1');
    expect(state.servers[0].mapUrl).toBeUndefined();
  });

  test('validates missing server and query URL', async () => {
    await expect(service.getServerLiveStatus('missing')).rejects.toThrow('SERVER_NOT_FOUND');
    state.servers[0].queryUrl = '';
    await expect(service.getServerLiveStatus('server-1')).rejects.toThrow('QUERY_URL_MISSING');
  });
});

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
