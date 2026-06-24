import { jest } from '@jest/globals';

interface StoredServer {
  id: string;
  steamId?: string;
  label: string;
  queryUrl: string;
  mapUrl?: string;
  backendUrl?: string;
  adminUid?: string;
  data?: unknown;
  info?: unknown;
  firstSeen?: Date | string;
  lastSeen?: Date | string;
  queryDataUpdatedAt?: Date | string;
  public: boolean;
  createdAt: Date | string;
}

const state = {
  servers: [] as StoredServer[],
  users: [],
};
const writeMock = jest.fn<() => Promise<void>>().mockResolvedValue();
const errorMock = jest.fn();

jest.unstable_mockModule('../src/db/json.js', () => ({
  db: {
    data: state,
    write: writeMock,
  },
}));

jest.unstable_mockModule('../src/utils/logger.js', () => ({
  defaultLogger: {
    error: errorMock,
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
    writeMock.mockClear();
    errorMock.mockClear();
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
          contact: '76561198000000000',
          description: '@mapUrl:[https://map.example.com/]',
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
      id: '90285195499304980',
      steamId: '90285195499304980',
      label: 'Server',
      queryUrl: 'http://127.0.0.1:4254',
      mapUrl: 'https://map.example.com/',
      backendUrl: 'https://map.example.com/',
      adminUid: '76561198000000000',
      data: { players: 3 },
      info: {
        contact: '76561198000000000',
        description: '@mapUrl:[https://map.example.com/]',
      },
      public: true,
    });
    expect(writeMock).toHaveBeenCalledTimes(1);
  });

  test('refreshMasterServerList merges existing servers and skips fresh query metadata', async () => {
    state.servers = [
      {
        id: '90285195499304980',
        steamId: '90285195499304980',
        label: 'Old',
        queryUrl: 'http://old.example.com',
        queryDataUpdatedAt: new Date().toISOString(),
        public: true,
        createdAt: new Date().toISOString(),
      },
    ];
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      text: async () =>
        '{"successful":true,"data":[{"steamid":90285195499304980,"name":"New","ip":"127.0.0.1","port":4255}]}',
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
      label: 'New',
      queryUrl: 'http://127.0.0.1:4254',
    });
  });
});
