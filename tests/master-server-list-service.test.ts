import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

interface StoredServer {
  id: string;
  alternateIds?: string[];
  catalogIdPinned?: boolean;
  steamId?: string;
  ip?: string;
  port?: number;
  label: string;
  queryUrl: string;
  mapUrl?: string;
  backendUrl?: string;
  adminUid?: string;
  data?: unknown;
  info?: unknown;
  status?: 'online' | 'offline' | 'unknown';
  onlinePlayers?: unknown[];
  knownPlayers?: Array<{ uid: string; name?: string; platform?: string | number; firstseen?: number; lastseen?: number }>;
  lastChecked?: Date | string;
  errorMessage?: string;
  firstSeen?: Date | string;
  lastSeen?: Date | string;
  queryDataUpdatedAt?: Date | string;
  public: boolean;
  createdAt: Date | string;
}

const state = {
  servers: [] as StoredServer[],
  users: [] as Array<{ pinnedServers?: string[] }>,
  serverStatistics: [] as unknown[],
};
const writeMock = jest.fn<() => Promise<void>>().mockResolvedValue();
const errorMock = jest.fn();
const debugMock = jest.fn();
const warnMock = jest.fn();

jest.unstable_mockModule('typia', () => ({ default: { assert: (value: unknown) => value } }));

jest.unstable_mockModule('../src/db/non-storage-store.js', () => ({
  nonStorageDb: {
    data: state,
    write: writeMock,
  },
}));

jest.unstable_mockModule('../src/utils/logger.js', () => ({
  defaultLogger: {
    debug: debugMock,
    error: errorMock,
    warn: warnMock,
  },
}));

const service = await import('../src/service/master-server-list-service.js');
const { refreshMasterOnlyLive } = await import('../src/service/master-only-live-service.js');
const { listGlobalPlayerBuckets } = await import('../src/db/global-player-statistics-store.js');
const { default: storageRouter } = await import('../src/router/storage-router.js');

function restoreEnv(snapshot: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in snapshot)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, snapshot);
}

describe('master-server-list-service', () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  beforeEach(() => {
    restoreEnv(originalEnv);
    process.env.ENABLE_STORAGE = 'true';
    process.env.MASTER_SERVER_LIST_URL = 'https://master.example.com/list';
    process.env.SERVER_QUERY_REFRESH_INTERVAL_MS = '60000';
    state.servers = [];
    state.serverStatistics = [];
    service.clearMasterOnlyCache();
    writeMock.mockClear();
    errorMock.mockClear();
    debugMock.mockClear();
    warnMock.mockClear();
    global.fetch = originalFetch;
  });

  afterAll(() => {
    restoreEnv(originalEnv);
    global.fetch = originalFetch;
  });

  test('refreshMasterServerList imports master list records and query metadata', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          '{"successful":true,"data":[{"addr":"127.0.0.1:4255","steamid":90285195499304980,"version":"202605131","name":"Server","ip":"127.0.0.1","port":4255,"region":"EU","gm":0,"mods":false,"password":false,"whitelist":false}]}',
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ name: 'Live info name', contact: '76561198000000000', description: '[rw-servers]' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ players: 3 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ name: 'Live info name', contact: '76561198000000000', description: '[rw-servers]' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ plugins: [{ name: 'OZ - Admin Utils' }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          schemaVersion: 1,
          mapUrl: 'https://map.example.com/',
          adminUid: '76561198000000000',
          admins: [],
        }),
      }) as typeof fetch;
    global.fetch = fetchMock;

    await expect(
      service.refreshMasterServerList({ refreshQueryData: true }),
    ).resolves.toMatchObject({
      fetched: 1,
      inserted: 1,
      updated: 0,
      refreshed: 1,
    });

    expect(state.servers[0]).toMatchObject({
      id: 'server-f8e7fa9ca73fd4b4943db61a',
      steamId: '90285195499304980',
      name: 'Server',
      label: 'Live info name',
      queryUrl: 'http://127.0.0.1:4254',
      mapUrl: 'https://map.example.com/',
      status: 'online',
      lastChecked: expect.any(Date),
      adminUid: '76561198000000000',
      data: { players: 3 },
      info: { name: 'Live info name', contact: '76561198000000000', description: '[rw-servers]' },
      public: true,
    });
    expect(writeMock).toHaveBeenCalledTimes(2);
    expect(state.serverStatistics).toHaveLength(1);
    expect(state.serverStatistics[0]).toMatchObject({
      serverId: 'server-f8e7fa9ca73fd4b4943db61a',
      sampleCount: 1,
      onlineSampleCount: 1,
      playerSampleTotal: 3,
      maxPlayers: 3,
      averagePlayers: 3,
      availability: 100,
      onlinePlayerUids: [],
    });
  });

  test('keeps a merged canonical ID on later imports and does not reclaim a reused alias address', async () => {
    state.servers = [{
      id: 'oldest', label: 'Oldest', ip: '192.0.2.20', port: 4255,
      queryUrl: 'http://192.0.2.20:4254', public: true,
      alternateIds: ['server-f8e7fa9ca73fd4b4943db61a'], catalogIdPinned: true,
      createdAt: '2026-11-01T00:00:00Z',
    }];
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({ successful: true, data: [
        { ip: '192.0.2.20', port: 4255, name: 'Oldest' },
        { ip: '127.0.0.1', port: 4255, name: 'New occupant' },
      ] }),
    }) as typeof fetch;
    await service.refreshMasterServerList();
    expect(state.servers[0].id).toBe('oldest');
    expect(state.servers).toHaveLength(1);
    expect(service.cachedMasterServers()).toMatchObject([{ ip: '127.0.0.1', masterOnly: true }]);
  });

  test('retains contact and /info name in the transient master cache without a marker', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ successful: true, data: [
          { ip: '127.0.0.1', port: 4255, name: 'Master name' },
        ] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ name: 'Info name', contact: '76561198000000000', description: 'No marker' }),
      }) as typeof fetch;

    await expect(service.refreshMasterServerList()).resolves.toMatchObject({ inserted: 0 });
    expect(state.servers).toHaveLength(0);
    expect(service.cachedMasterServers()).toMatchObject([{
      label: 'Info name',
      info: { contact: '76561198000000000' },
      masterOnly: true,
    }]);
  });

  test('samples persisted and master-only observations without retaining live identifiers', async () => {
    const sampledAt = new Date('2026-11-27T11:15:00Z');
    jest.useFakeTimers({
      now: sampledAt,
      doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'clearImmediate',
        'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
    });
    try {
      const stored = '192.0.2.10';
      const transient = '192.0.2.20';
      const unreachable = '192.0.2.30';
      state.servers = [{
        id: 'stored', label: 'Stored', ip: stored, port: 4255, catalogIdPinned: true,
        queryUrl: `http://${stored}:4254`, createdAt: sampledAt.toISOString(), public: true,
      }];
      const fetchMock = jest.fn<typeof fetch>().mockImplementation(async input => {
        const url = new URL(String(input));
        if (url.hostname === 'master.example.com') {
          return Response.json({ successful: true, data: [stored, transient, transient, unreachable].map(ip => ({ ip, port: 4255 })) });
        }
        if (url.hostname === unreachable) throw new Error('Timed out');
        if (url.pathname === '/info') return Response.json({ name: url.hostname });
        if (url.pathname === '/playerlist') {
          return url.hostname === stored
            ? new Response('{"players":[{"uid":76561198000000001},{"uid":76561198000000001}]}')
            : Response.json({ players: [
              { uid: '76561198000000001', id: 2, name: 'Same name' },
              { uid: '76561198000000002', id: 3, name: 'Same name' },
              { id: 4, connected: true },
              { id: 5, name: 'Left', connected: false },
            ] });
        }
        return Response.json(url.pathname === '/' ? {
          playercount: url.hostname === stored ? 4 : 3,
          maxplayers: 12,
          map: 'Meadow',
          version: '0.9.3.2',
          ...(url.hostname === transient ? { steamid: '76561198000000001' } : {}),
        } : {});
      });
      global.fetch = fetchMock;

      await service.refreshMasterServerList();
      await refreshMasterOnlyLive();
      expect(service.cachedMasterServers()).toMatchObject([
        { ip: transient, status: 'online', queryData: { playercount: 3 }, masterOnlyPlayerNames: ['Same name', 'Same name'] },
        { ip: unreachable, status: 'unknown' },
      ]);
      expect(fetchMock.mock.calls.filter(([url]) => String(url).includes(`${transient}:4254`))).toHaveLength(3);
      expect(state.servers).toHaveLength(1);
      expect(state.serverStatistics).toHaveLength(0);

      const api = request(express().use('/api/storage', storageRouter));
      const catalog = await api.get('/api/storage/server?masterOnly=true').expect(200);
      expect(catalog.body.servers).toHaveLength(2);
      const discovered = catalog.body.servers.find((server: { ip: string }) => server.ip === transient);
      expect(discovered.masterOnlyPlayerNames).toEqual(['Same name', 'Same name']);
      expect(discovered.queryData).toEqual({
        playercount: 3, maxplayers: 12, map: 'Meadow', version: '0.9.3.2',
      });
      expect(discovered).not.toHaveProperty('onlinePlayers');
      expect(JSON.stringify(discovered)).not.toContain('76561198000000001');
      await api.get(`/api/storage/server/${discovered.id}/statistics`).expect(404);

      await service.refreshAllServerQueryData(true);
      expect(fetchMock.mock.calls.filter(([url]) => String(url).includes(`${stored}:4254/playerlist`))).toHaveLength(1);
      expect(state.serverStatistics).toEqual([expect.objectContaining({ serverId: 'stored', playerSampleTotal: 4 })]);
      expect(JSON.stringify(state)).not.toContain('Same name');
      expect(JSON.stringify(state)).not.toContain('76561198000000001');
      const from = new Date('2026-11-27T11:00:00Z');
      const to = new Date('2026-11-27T12:00:00Z');
      await expect(listGlobalPlayerBuckets(from, to)).resolves.toEqual([
        { hourStart: from.toISOString(), sampleCount: 1, minPlayers: 5, maxPlayers: 5, averagePlayers: 5 },
      ]);

      const history = await api.get('/api/storage/statistics').expect(200);
      expect(history.body.buckets).toEqual([expect.objectContaining({ serverId: 'stored' })]);
      expect(history.body.globalPlayerBuckets).toEqual([
        { hourStart: from.toISOString(), sampleCount: 1, minPlayers: 5, maxPlayers: 5, averagePlayers: 5 },
      ]);

      jest.setSystemTime(new Date(sampledAt.getTime() + 120_000));
      expect(service.cachedMasterServers()[0]).toMatchObject({ status: 'unknown' });
      expect(service.cachedMasterServers()[0]).not.toHaveProperty('masterOnlyPlayerNames');
      fetchMock.mockRejectedValue(new Error('All queries unavailable'));
      await service.refreshMasterServerList();
      await refreshMasterOnlyLive();
      await service.refreshAllServerQueryData(true);
      await expect(listGlobalPlayerBuckets(from, to)).resolves.toEqual([
        { hourStart: from.toISOString(), sampleCount: 1, minPlayers: 5, maxPlayers: 5, averagePlayers: 5 },
      ]);
    } finally {
      jest.useRealTimers();
    }
  });

  test('renews live rows during a slow discovery and preserves them when it completes', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-26T11:00:00Z') });
    try {
      const ip = '192.0.2.40';
      let players = [{ name: 'First player' }];
      let pauseInfo = false;
      let releaseInfo: (() => void) | undefined;
      let infoStarted: (() => void) | undefined;
      const infoPending = new Promise<void>(resolve => { infoStarted = resolve; });
      const fetchMock = jest.fn<typeof fetch>().mockImplementation(async input => {
        const url = new URL(String(input));
        if (url.hostname === 'master.example.com') return Response.json({ successful: true, data: [{ ip, port: 4255 }] });
        if (url.pathname === '/info') {
          if (pauseInfo) {
            infoStarted?.();
            await new Promise<void>(resolve => { releaseInfo = resolve; });
          }
          return Response.json({ name: 'Discovered server' });
        }
        if (url.pathname === '/playerlist') return Response.json({ players });
        return Response.json({ playercount: players.length });
      });
      global.fetch = fetchMock;
      await service.refreshMasterServerList();
      await refreshMasterOnlyLive();
      const original = service.cachedMasterServers()[0];
      expect(original.masterOnlyPlayerNames).toEqual(['First player']);

      jest.advanceTimersByTime(60_000);
      pauseInfo = true;
      const discovery = service.refreshMasterServerList();
      await infoPending;
      players = [{ name: 'Current player' }];
      await refreshMasterOnlyLive();
      const current = service.cachedMasterServers()[0];
      expect(current.status).toBe('online');
      expect(current.masterOnlyPlayerNames).toEqual(['Current player']);
      expect(Date.parse(current.masterOnlyLiveUntil!)).toBeGreaterThan(Date.parse(original.masterOnlyLiveUntil!));

      releaseInfo?.();
      await discovery;
      jest.advanceTimersByTime(30_000);
      expect(service.cachedMasterServers()[0]).toMatchObject({
        status: 'online', masterOnlyPlayerNames: ['Current player'],
      });

      players = [];
      await refreshMasterOnlyLive();
      expect(service.cachedMasterServers()[0]).toMatchObject({
        status: 'online', queryData: { playercount: 0 }, masterOnlyPlayerNames: [],
      });
    } finally {
      jest.useRealTimers();
    }
  });

  test('refreshMasterServerList merges existing servers and skips fresh query metadata', async () => {
    state.servers = [
      {
        id: '90285195499304980',
        steamId: '90285195499304980',
        ip: '127.0.0.1',
        port: 4255,
        label: 'Old',
        queryUrl: 'http://old.example.com',
        queryDataUpdatedAt: new Date().toISOString(),
        public: true,
        createdAt: new Date().toISOString(),
      },
    ];
    state.users = [{ pinnedServers: ['90285195499304980'] }];
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      text: async () =>
        '{"successful":true,"data":[{"steamid":90285195499304981,"name":"New","ip":"127.0.0.1","port":4255}]}',
    }) as typeof fetch;

    await expect(
      service.refreshMasterServerList({ refreshQueryData: true }),
    ).resolves.toMatchObject({
      fetched: 1,
      inserted: 0,
      updated: 1,
      refreshed: 0,
    });

    expect(state.servers).toHaveLength(1);
    expect(state.servers[0]).toMatchObject({
      id: 'server-f8e7fa9ca73fd4b4943db61a',
      steamId: '90285195499304981',
      name: 'New',
      label: 'Old',
      queryUrl: 'http://127.0.0.1:4254',
    });
    expect(state.users[0].pinnedServers).toEqual(['server-f8e7fa9ca73fd4b4943db61a']);
  });

  test('refreshMasterServerList preserves an explicitly configured query URL', async () => {
    state.servers = [{
      id: 'server-f8e7fa9ca73fd4b4943db61a',
      ip: '127.0.0.1',
      port: 4255,
      label: 'Proxied',
      queryUrl: 'https://query.example/dev',
      queryUrlExplicit: true,
      public: true,
      createdAt: new Date().toISOString(),
    }];
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      text: async () =>
        '{"successful":true,"data":[{"steamid":90285195499304981,"name":"Proxied","ip":"127.0.0.1","port":4255}]}',
    }) as typeof fetch;

    await service.refreshMasterServerList();

    expect(state.servers[0].queryUrl).toBe('https://query.example/dev');
    expect(state.servers[0].queryUrlExplicit).toBe(true);
  });

  test('does not prune catalog records after a failed master-list request', async () => {
    state.servers = [{
      id: 'stale-server', ip: '127.0.0.1', port: 4255, label: 'Stale', queryUrl: 'http://127.0.0.1:4254',
      public: true, createdAt: '2026-01-01T00:00:00.000Z', lastSeen: '2026-01-01T00:00:00.000Z',
    }];
    global.fetch = jest.fn().mockResolvedValue({ ok: false, text: async () => '' }) as typeof fetch;

    await expect(service.refreshMasterServerList()).resolves.toEqual({ fetched: 0, inserted: 0, updated: 0, refreshed: 0 });
    expect(state.servers).toHaveLength(1);
  });

  test('keeps a stale catalog endpoint and its historical statistics when it reappears', async () => {
    state.servers = [{
      id: 'stale-server', ip: '127.0.0.1', port: 4255, label: 'Stale', queryUrl: 'http://127.0.0.1:4254',
      public: true, createdAt: '2026-01-01T00:00:00.000Z', lastSeen: '2026-01-01T00:00:00.000Z',
    }];
    state.serverStatistics = [{ id: 'stale-server:2026-01-01T00:00:00.000Z', serverId: 'stale-server', sampleCount: 4 }];
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => '{"successful":true,"data":[{"steamid":"76561198000000001","ip":"127.0.0.1","port":4255,"name":"Returned"}]}',
    }) as typeof fetch;

    await expect(service.refreshMasterServerList()).resolves.toMatchObject({ fetched: 1, updated: 1 });
    expect(state.servers).toHaveLength(1);
    expect(state.servers[0].lastSeen).toEqual(expect.any(Date));
    expect(state.serverStatistics).toEqual([{ id: 'stale-server:2026-01-01T00:00:00.000Z', serverId: 'stale-server', sampleCount: 4 }]);
  });

  test('refreshMasterServerList tolerates invalid master responses and entries', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: false,
      text: async () => '',
    }) as typeof fetch;

    await expect(service.refreshMasterServerList()).resolves.toEqual({
      fetched: 0,
      inserted: 0,
      updated: 0,
      refreshed: 0,
    });
    expect(state.servers).toEqual([]);

    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      text: async () => '{"successful":true,"data":[{"steamid":"bad","ip":"127.0.0.1","port":4255},{"steamid":"76561198000000000","ip":"127.0.0.1","port":1},{"steamid":"76561198000000001","ip":"127.0.0.1","port":4255,"name":"Valid"}]}',
    }) as typeof fetch;

    await expect(service.refreshMasterServerList()).resolves.toMatchObject({
      fetched: 3,
      inserted: 0,
      updated: 0,
    });
    expect(state.servers).toHaveLength(0);
    expect(service.cachedMasterServers()[0]).toMatchObject({
      id: 'server-f8e7fa9ca73fd4b4943db61a',
      steamId: '76561198000000001',
      name: 'Valid',
      label: 'server-f8e7fa9ca73fd4b4943db61a',
      masterOnly: true,
    });
  });

  test('refreshMasterServerList handles malformed master JSON and query fetch failures', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      text: async () => '{not-json',
    }) as typeof fetch;

    await expect(service.refreshMasterServerList()).resolves.toEqual({
      fetched: 0,
      inserted: 0,
      updated: 0,
      refreshed: 0,
    });

    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          '{"successful":true,"data":[{"steamid":"76561198000000002","ip":"127.0.0.1","port":4255,"mods":"bad","password":"bad","whitelist":"bad","gm":"bad"}]}',
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ description: '[rw-servers]' }),
      })
      .mockRejectedValueOnce(new Error('query failed'))
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({}),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({}),
      }) as typeof fetch;

    await expect(
      service.refreshMasterServerList({ refreshQueryData: true }),
    ).resolves.toMatchObject({
      fetched: 1,
      inserted: 1,
      refreshed: 1,
    });
    expect(state.servers[0]).toMatchObject({
      id: 'server-f8e7fa9ca73fd4b4943db61a',
      steamId: '76561198000000002',
      status: 'offline',
      errorMessage: 'FETCH_FAILED',
      queryDataUpdatedAt: expect.any(Date),
    });
    expect(state.serverStatistics).toHaveLength(1);
    expect(state.serverStatistics[0]).toMatchObject({
      serverId: 'server-f8e7fa9ca73fd4b4943db61a',
      sampleCount: 1,
      onlineSampleCount: 0,
      playerSampleTotal: 0,
      availability: 0,
    });
    expect(state.servers[0].mods).toBeUndefined();
    expect(state.servers[0].password).toBeUndefined();
    expect(state.servers[0].whitelist).toBeUndefined();
    expect(state.servers[0].gm).toBeUndefined();
  });

  test('refreshMasterServerList logs and rethrows persistence failures', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      text: async () =>
        '{"successful":true,"data":[{"steamid":"76561198000000003","ip":"127.0.0.1","port":4255,"name":"Broken Save"}]}',
    }).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ description: '[rw-servers]' }),
    }) as typeof fetch;
    writeMock.mockRejectedValueOnce(new Error('write failed'));

    await expect(service.refreshMasterServerList()).rejects.toThrow('write failed');
    expect(errorMock).toHaveBeenCalledWith('Master server list refresh failed:', expect.any(Error));
  });

  test('refreshAllServerQueryData refreshes stale servers and preserves existing metadata on invalid info', async () => {
    state.servers = [
      {
        id: 'server-1',
        label: 'Server 1',
        queryUrl: 'http://server-1.example',
        adminUid: '76561198000000000',
        mapUrl: 'https://old-map.example/',
        backendUrl: 'https://old-map.example/',
        onlinePlayers: [], // Consent-filtered list may be empty while players are online.
        queryDataUpdatedAt: 'invalid-date',
        public: true,
        createdAt: new Date().toISOString(),
      },
      {
        id: 'server-2',
        label: 'Server 2',
        queryUrl: '',
        public: true,
        createdAt: new Date().toISOString(),
      },
    ];
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ playercount: 5 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          shortname: 'Short Server 1',
          contact: 'not-a-steam-id',
          description: '@mapUrl:[not-a-url]',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      }) as typeof fetch;

    await expect(service.refreshAllServerQueryData()).resolves.toMatchObject({
      fetched: 2,
      inserted: 0,
      updated: 0,
      refreshed: 1,
    });
    expect(state.servers[0]).toMatchObject({
      data: { playercount: 5 },
      status: 'online',
      label: 'Server 1',
      adminUid: '76561198000000000',
      mapUrl: 'https://old-map.example/',
      backendUrl: 'https://old-map.example/',
      queryDataUpdatedAt: expect.any(Date),
    });
    expect(state.serverStatistics).toHaveLength(1);
    expect(state.serverStatistics[0]).toMatchObject({
      serverId: 'server-1',
      sampleCount: 1,
      onlineSampleCount: 1,
      playerSampleTotal: 5,
    });
    expect(writeMock).toHaveBeenCalled();
  });

  test('an in-flight refresh cannot recreate a merged source or record an alias sample', async () => {
    state.servers = [{ id: 'merged-source', label: 'Source', queryUrl: 'http://source.example',
      public: true, createdAt: new Date('2026-11-01T00:00:00Z') }];
    global.fetch = jest.fn().mockImplementation(async () => {
      state.servers = [];
      return { ok: false };
    }) as typeof fetch;
    await expect(service.refreshAllServerQueryData()).resolves.toMatchObject({ fetched: 1, refreshed: 0 });
    expect(state.servers).toEqual([]);
    expect(state.serverStatistics).toEqual([]);
  });

  test('refreshAllServerQueryData reads map configuration from native Admin Utils info', async () => {
    state.servers = [
      {
        id: 'server-1',
        label: 'Old Shortname',
        queryUrl: 'http://server-1.example',
        queryDataUpdatedAt: 'invalid-date',
        public: true,
        createdAt: new Date().toISOString(),
      },
    ];
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ players: 5 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ shortname: 'Old Shortname' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ plugins: [{ name: 'OZ - Admin Utils' }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          schemaVersion: 1,
          mapUrl: 'https://map.example.com/',
          adminUid: '76561198000000000',
          admins: [],
        }),
      }) as typeof fetch;

    await expect(service.refreshAllServerQueryData()).resolves.toMatchObject({
      fetched: 1,
      refreshed: 1,
    });
    expect(state.servers[0]).toMatchObject({
      label: 'Old Shortname',
      mapUrl: 'https://map.example.com/',
    });
  });

  test('refreshAllServerQueryData logs and rethrows persistence failures', async () => {
    state.servers = [
      {
        id: 'server-1',
        label: 'Server 1',
        queryUrl: 'http://server-1.example',
        queryDataUpdatedAt: 'invalid-date',
        public: true,
        createdAt: new Date().toISOString(),
      },
    ];
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ players: 5 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ shortname: 'Short Server 1' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ players: [] }),
      }) as typeof fetch;
    writeMock
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('save failed'));

    await expect(service.refreshAllServerQueryData()).rejects.toThrow('save failed');
    expect(errorMock).toHaveBeenCalledWith('Server query data refresh failed:', expect.any(Error));
  });

  test('refreshMasterServerList blocks overlapping refresh runs', async () => {
    let resolveMasterResponse: (value: Response) => void = () => undefined;
    const masterResponse = new Promise<Response>((resolve) => {
      resolveMasterResponse = resolve;
    });
    const fetchMock = jest.fn().mockReturnValueOnce(masterResponse) as typeof fetch;
    global.fetch = fetchMock;

    const first = service.refreshMasterServerList();
    await expect(service.refreshMasterServerList()).resolves.toEqual({
      fetched: 0,
      inserted: 0,
      updated: 0,
      refreshed: 0,
      skipped: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(warnMock).toHaveBeenCalledWith(
      'Master server list refresh skipped because another refresh is still running',
    );

    resolveMasterResponse(new Response('{"successful":true,"data":[]}', { status: 200 }));
    await expect(first).resolves.toEqual({
      fetched: 0,
      inserted: 0,
      updated: 0,
      refreshed: 0,
    });
  });

  test('startMasterServerListSync respects storage config and can be stopped', () => {
    jest.useFakeTimers();
    process.env.ENABLE_STORAGE = 'false';
    expect(service.startMasterServerListSync()).toBeNull();

    process.env.ENABLE_STORAGE = 'true';
    process.env.MASTER_SERVER_LIST_REFRESH_INTERVAL_MS = '60000';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => '{"successful":true,"data":[]}',
    }) as typeof fetch;

    const sync = service.startMasterServerListSync();
    expect(sync).not.toBeNull();

    sync?.stop();
    jest.useRealTimers();
  });
});
