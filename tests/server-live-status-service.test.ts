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

  test('fetches game status plus native Admin Utils metadata and persisted players', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(response({ name: 'Server', playercount: 9 }))
      .mockResolvedValueOnce(response({
        schemaVersion: 1,
        mapUrl: 'https://map.example/',
        adminUid: '76561198000000000',
        admins: [],
      }))
      .mockResolvedValueOnce(response({ players: [{ uid: '76561198000000000', name: 'Alice', connected: true }] })) as typeof fetch;
    global.fetch = fetchMock;

    await expect(service.getServerLiveStatus('server-1')).resolves.toMatchObject({
      status: 'online',
      queryData: { name: 'Server', playercount: 9 },
      infoData: { schemaVersion: 1, mapUrl: 'https://map.example/' },
      onlinePlayers: [{ uid: '76561198000000000', name: 'Alice', connected: true }],
    });
    await service.getServerLiveStatus('server-1');

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenNthCalledWith(1, 'http://query.example', expect.any(Object));
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'http://query.example/plugins/oz---admin-utils/info', expect.any(Object));
    expect(fetchMock).toHaveBeenNthCalledWith(3, 'http://query.example/plugins/oz---admin-utils/playerlist', expect.any(Object));
    expect(state.servers[0]).toMatchObject({
      mapUrl: 'https://map.example/', adminUid: '76561198000000000', status: 'online',
      onlinePlayers: [{ uid: '76561198000000000', name: 'Alice', connected: true }],
    });
  });

  test('uses native player data as the online signal when the game query fails', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce(response({}, 500))
      .mockResolvedValueOnce(response({}, 404))
      .mockResolvedValueOnce(response({ players: [{ uid: 'player-1' }] })) as typeof fetch;

    await expect(service.getServerLiveStatus('server-1')).resolves.toMatchObject({
      status: 'online', errorMessage: 'HTTP 500', onlinePlayers: [{ uid: 'player-1' }],
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
