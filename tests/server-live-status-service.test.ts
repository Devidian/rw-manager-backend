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
  knownPlayers?: Array<{ id?: number; uid: string; name?: string; posx?: number; posy?: number; posz?: number; platform?: string | number; firstseen?: number; lastseen?: number }>;
  lastChecked?: Date | string;
  errorMessage?: string;
  queryDataUpdatedAt?: Date | string;
  public: boolean;
  createdAt: Date | string;
}

const state = { servers: [] as StoredServer[], serverStatistics: [] as unknown[] };
const writeMock = jest.fn<() => Promise<void>>().mockResolvedValue();
jest.unstable_mockModule('../src/db/non-storage-store.js', () => ({ nonStorageDb: { data: state, write: writeMock } }));
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
    service.clearServerLiveStatusCacheEntry('server-1');
  });

  afterAll(() => { global.fetch = originalFetch; });

  test('uses the public player list for the count without storing its identities', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(response({ name: 'Server', playercount: 9 }))
      .mockResolvedValueOnce(response({ name: 'Server overview', shortname: 'Overview', description: 'Info' }))
      .mockResolvedValueOnce(response({ plugins: [{ name: 'OZ - Admin Utils' }] }))
      .mockResolvedValueOnce(response({
        schemaVersion: 1,
        mapUrl: 'https://map.example/',
        adminUid: '76561198000000000',
        admins: [],
      }))
      .mockResolvedValueOnce(response({ players: [{ uid: 'public-only', name: 'Online' }, { name: 'Offline', connected: false }] })) as typeof fetch;
    global.fetch = fetchMock;

    await expect(service.getServerLiveStatus('server-1')).resolves.toMatchObject({
      status: 'online',
      queryData: { name: 'Server', playercount: 9 },
      infoData: { name: 'Server overview', shortname: 'Overview', description: 'Info' },
      onlinePlayers: undefined,
      publicPlayerCount: 1,
    });
    await service.getServerLiveStatus('server-1');

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fetchMock).toHaveBeenNthCalledWith(1, 'http://query.example', expect.any(Object));
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'http://query.example/info', expect.any(Object));
    expect(fetchMock).toHaveBeenNthCalledWith(3, 'http://query.example/pluginlist', expect.any(Object));
    expect(fetchMock).toHaveBeenNthCalledWith(4, 'http://query.example/plugins/oz---admin-utils/info', expect.any(Object));
    expect(String((fetchMock as jest.MockedFunction<typeof fetch>).mock.calls[4][0])).toBe('http://query.example/playerlist');
    expect(JSON.stringify(state)).not.toContain('public-only');
    expect(state.servers[0]).toMatchObject({
      mapUrl: 'https://map.example/', adminUid: '76561198000000000', status: 'online',
      onlinePlayers: undefined,
    });
  });

  test('does not use a game-owned player list when the query fails', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce(response({}, 500))
      .mockResolvedValueOnce(response({}, 404))
      .mockResolvedValueOnce(response({}, 404)) as typeof fetch;

    await expect(service.getServerLiveStatus('server-1')).resolves.toMatchObject({
      status: 'offline', errorMessage: 'HTTP 500', onlinePlayers: [],
    });
  });

  test('never refreshes player identities from game-owned routes', async () => {
    state.servers[0].status = 'online';
    state.servers[0].onlinePlayers = [{ uid: 'previous-player' }];
    state.servers[0].lastChecked = new Date(0).toISOString();
    global.fetch = jest.fn().mockResolvedValueOnce(response({
      players: [{ uid: 'current-player', name: 'Current' }],
    })) as typeof fetch;

    await expect(service.refreshDueServerPlayerLists()).resolves.toEqual({ checked: 0, refreshed: 0 });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(state.servers[0]).toMatchObject({
      onlinePlayers: [{ uid: 'previous-player' }],
      status: 'online',
    });
  });

  test('accepts a bounded connector player-status snapshot into only that server cache', async () => {
    await service.acceptConnectorPlayerStatus('server-1', {
      schemaVersion: 1,
      consentVersion: 1,
      players: [
        { uid: 'player-1', dbId: 4, name: 'Connected' },
        { uid: 'player-2', dbId: 5, name: 'Disconnected', connected: false },
      ],
    });

    await expect(service.getServerLiveStatus('server-1')).resolves.toMatchObject({
      status: 'online',
      onlinePlayers: [{ id: 4, uid: 'player-1', name: 'Connected' }],
    });
    expect(state.servers[0]).toMatchObject({
      status: 'online',
      onlinePlayers: [{ id: 4, uid: 'player-1', name: 'Connected' }],
    });
  });

  test('removes a revoked known player immediately but keeps other players', async () => {
    state.servers[0].knownPlayers = [
      { id: 4, uid: 'player-1', name: 'First' },
      { id: 5, uid: 'player-2', name: 'Second' },
    ];
    state.servers[0].onlinePlayers = [{ uid: 'player-1' }, { uid: 'player-2' }];

    await service.acceptConnectorPlayerConsentRevoked('server-1', { uid: 'player-1', dbId: 4 });

    expect(state.servers[0].knownPlayers).toEqual([{ id: 5, uid: 'player-2', name: 'Second' }]);
    expect(state.servers[0].onlinePlayers).toEqual([{ uid: 'player-2' }]);
    await expect(service.acceptConnectorPlayerConsentRevoked('server-1', { uid: 'player-2', dbId: 999 }))
      .resolves.toBeUndefined();
    expect(state.servers[0].knownPlayers).toHaveLength(1);
    await expect(service.acceptConnectorPlayerConsentRevoked('server-1', { uid: '', dbId: 4 }))
      .rejects.toThrow('INVALID_CONSENT_REVOKE');
  });

  test('removes only location fields when map consent is revoked', async () => {
    state.servers[0].knownPlayers = [
      { id: 4, uid: 'player-1', name: 'First', posx: 10, posy: 20, posz: 30 },
      { id: 5, uid: 'player-2', name: 'Second', posx: 40 },
    ];
    state.servers[0].onlinePlayers = [{ uid: 'player-1', posx: 10 }, { uid: 'player-2', posx: 40 }];

    await service.acceptConnectorPlayerConsentRevoked('server-1', { uid: 'player-1', dbId: 4, purpose: 'map' });

    expect(state.servers[0].knownPlayers).toEqual([
      { id: 4, uid: 'player-1', name: 'First' },
      { id: 5, uid: 'player-2', name: 'Second', posx: 40 },
    ]);
    expect(state.servers[0].onlinePlayers).toEqual([{ uid: 'player-1' }, { uid: 'player-2', posx: 40 }]);
  });

  test('rejects connector players without exportable identity', async () => {
    await expect(service.acceptConnectorPlayerStatus('server-1', {
      schemaVersion: 1,
      consentVersion: 1,
      players: [{ name: 'Missing UID' }],
    })).rejects.toThrow('INVALID_PLAYER_STATUS');

    expect(state.servers[0].onlinePlayers).toBeUndefined();
    expect(state.servers[0].knownPlayers).toBeUndefined();
  });

  test('rejects old connector snapshots without consent version', async () => {
    await expect(service.acceptConnectorPlayerStatus('server-1', {
      schemaVersion: 1,
      players: [{ uid: 'old-player', dbId: 4, name: 'Old' }],
    })).rejects.toThrow('INVALID_PLAYER_STATUS');
    expect(state.servers[0].onlinePlayers).toBeUndefined();
  });

  test('does not accept description markers as native configuration', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce(response({ name: 'Server', playercount: 1 }))
      .mockResolvedValueOnce(response({ description: '@mapUrl:https://bridge.example/' }))
      .mockResolvedValueOnce(response({ plugins: [] }))
      .mockResolvedValueOnce(response({ players: [] })) as typeof fetch;

    await service.getServerLiveStatus('server-1');
    expect(state.servers[0].mapUrl).toBeUndefined();
  });

  test('does not request the Admin Utils route when the exposed plugin list omits it', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(response({ name: 'Server' }))
      .mockResolvedValueOnce(response({ name: 'Overview' }))
      .mockResolvedValueOnce(response({ plugins: [{ name: 'OZ - GPS' }] }))
      .mockResolvedValueOnce(response({ players: [] })) as typeof fetch;
    global.fetch = fetchMock;

    await service.getServerLiveStatus('server-1');

    expect(fetchMock).not.toHaveBeenCalledWith(
      'http://query.example/plugins/oz---admin-utils/info', expect.any(Object),
    );
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
