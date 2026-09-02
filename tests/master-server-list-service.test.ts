import { jest } from '@jest/globals';

interface StoredServer {
  id: string;
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

jest.unstable_mockModule('../src/db/json.js', () => ({
  db: {
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
        json: async () => ({ players: 3 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          schemaVersion: 1,
          mapUrl: 'https://map.example.com/',
          adminUid: '76561198000000000',
          admins: [],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ players: [{ uid: 'player-1', connected: true }] }),
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
      label: 'server-f8e7fa9ca73fd4b4943db61a',
      queryUrl: 'http://127.0.0.1:4254',
      mapUrl: 'https://map.example.com/',
      status: 'online',
      onlinePlayers: [{ uid: 'player-1', connected: true }],
      knownPlayers: [
        {
          uid: 'player-1',
          platform: 'Standalone',
          firstseen: expect.any(Number),
          lastseen: expect.any(Number),
        },
      ],
      lastChecked: expect.any(Date),
      adminUid: '76561198000000000',
      data: { players: 3 },
      info: { schemaVersion: 1, mapUrl: 'https://map.example.com/', adminUid: '76561198000000000', admins: [] },
      public: true,
    });
    expect(writeMock).toHaveBeenCalledTimes(2);
    expect(state.serverStatistics).toHaveLength(1);
    expect(state.serverStatistics[0]).toMatchObject({
      serverId: 'server-f8e7fa9ca73fd4b4943db61a',
      sampleCount: 1,
      onlineSampleCount: 1,
      playerSampleTotal: 1,
      maxPlayers: 1,
      averagePlayers: 1,
      availability: 100,
      onlinePlayerUids: ['player-1'],
    });
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
      inserted: 1,
      updated: 1,
    });
    expect(state.servers).toHaveLength(1);
    expect(state.servers[0]).toMatchObject({
      id: 'server-f8e7fa9ca73fd4b4943db61a',
      steamId: '76561198000000001',
      name: 'Valid',
      label: 'server-f8e7fa9ca73fd4b4943db61a',
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
        json: async () => ({ players: 5 }),
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
        json: async () => ({ players: [{ uid: 'player-5', connected: true }] }),
      }) as typeof fetch;

    await expect(service.refreshAllServerQueryData()).resolves.toMatchObject({
      fetched: 2,
      inserted: 0,
      updated: 0,
      refreshed: 1,
    });
    expect(state.servers[0]).toMatchObject({
      data: { players: 5 },
      status: 'online',
      onlinePlayers: [{ uid: 'player-5', connected: true }],
      knownPlayers: [
        {
          uid: 'player-5',
          platform: 'Standalone',
          firstseen: expect.any(Number),
          lastseen: expect.any(Number),
        },
      ],
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
      playerSampleTotal: 1,
    });
    expect(writeMock).toHaveBeenCalled();
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
        json: async () => ({
          schemaVersion: 1,
          mapUrl: 'https://map.example.com/',
          adminUid: '76561198000000000',
          admins: [],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ players: [] }),
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
