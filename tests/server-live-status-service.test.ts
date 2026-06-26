import { jest } from '@jest/globals';

interface StoredServer {
  id: string;
  label: string;
  queryUrl: string;
  mapUrl?: string;
  backendUrl?: string;
  data?: unknown;
  info?: unknown;
  status?: 'online' | 'offline' | 'unknown';
  onlinePlayers?: unknown[];
  lastChecked?: Date | string;
  errorMessage?: string;
  queryDataUpdatedAt?: Date | string;
  public: boolean;
  createdAt: Date | string;
}

const state = {
  servers: [] as StoredServer[],
  serverStatistics: [] as unknown[],
};
const writeMock = jest.fn<() => Promise<void>>().mockResolvedValue();

jest.unstable_mockModule('../src/db/json.js', () => ({
  db: {
    data: state,
    write: writeMock,
  },
}));

const service = await import('../src/service/server-live-status-service.js');

function restoreEnv(snapshot: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in snapshot)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, snapshot);
}

describe('server-live-status-service', () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  beforeEach(() => {
    restoreEnv(originalEnv);
    process.env.LIVE_QUERY_PROXY_CACHE_TTL_MS = '1000';
    process.env.LIVE_QUERY_PROXY_TIMEOUT_MS = '1000';
    process.env.SERVER_QUERY_REFRESH_INTERVAL_MS = '60000';
    state.servers = [
      {
        id: 'server-1',
        label: 'Server',
        queryUrl: 'http://query.example',
        public: true,
        createdAt: new Date().toISOString(),
      },
    ];
    state.serverStatistics = [];
    writeMock.mockClear();
    service.clearServerLiveStatusCache();
    global.fetch = originalFetch;
  });

  afterAll(() => {
    restoreEnv(originalEnv);
    global.fetch = originalFetch;
  });

  test('fetches live status and caches repeated calls briefly', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(response({ name: 'Server', playercount: 1 }))
      .mockResolvedValueOnce(response({
        shortname: 'Updated Shortname',
        contact: 'admin',
        description: '@mapUrl:https://gs1.omega-zirkel.de/main.backend/',
      }))
      .mockResolvedValueOnce(response({ players: [{ uid: 'player-1' }] })) as typeof fetch;
    global.fetch = fetchMock;

    await expect(service.getServerLiveStatus('server-1')).resolves.toMatchObject({
      status: 'online',
      queryData: { name: 'Server', playercount: 1 },
      infoData: {
        shortname: 'Updated Shortname',
        contact: 'admin',
        description: '@mapUrl:https://gs1.omega-zirkel.de/main.backend/',
      },
      onlinePlayers: [{ uid: 'player-1' }],
      lastChecked: expect.any(String),
    });
    await service.getServerLiveStatus('server-1');

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenNthCalledWith(1, 'http://query.example', expect.any(Object));
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'http://query.example/info', expect.any(Object));
    expect(fetchMock).toHaveBeenNthCalledWith(3, 'http://query.example/playerlist', expect.any(Object));
    expect(state.servers[0]).toMatchObject({
      label: 'Updated Shortname',
      mapUrl: 'https://gs1.omega-zirkel.de/main.backend/',
      backendUrl: 'https://gs1.omega-zirkel.de/main.backend/',
      status: 'online',
      onlinePlayers: [{ uid: 'player-1' }],
      lastChecked: expect.any(Date),
      data: { name: 'Server', playercount: 1 },
      info: {
        shortname: 'Updated Shortname',
        contact: 'admin',
        description: '@mapUrl:https://gs1.omega-zirkel.de/main.backend/',
      },
      queryDataUpdatedAt: expect.any(Date),
    });
    expect(writeMock).toHaveBeenCalledTimes(2);
    expect(state.serverStatistics).toHaveLength(1);
    expect(state.serverStatistics[0]).toMatchObject({
      serverId: 'server-1',
      sampleCount: 1,
      onlineSampleCount: 1,
      playerSampleTotal: 1,
      maxPlayers: 1,
      averagePlayers: 1,
      availability: 100,
    });
  });

  test('coalesces concurrent requests for the same server', async () => {
    let resolveQuery: (value: Response) => void = () => undefined;
    const queryPromise = new Promise<Response>((resolve) => {
      resolveQuery = resolve;
    });
    const fetchMock = jest
      .fn()
      .mockReturnValueOnce(queryPromise)
      .mockResolvedValueOnce(response({ contact: 'admin' }))
      .mockResolvedValueOnce(response({ players: [] })) as typeof fetch;
    global.fetch = fetchMock;

    const first = service.getServerLiveStatus('server-1');
    const second = service.getServerLiveStatus('server-1');
    resolveQuery(response({ name: 'Server' }));

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test('returns stored live status after cache expiry while server query data is still fresh', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-24T12:00:00.000Z'));

    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(response({ name: 'Server', playercount: 2 }))
      .mockResolvedValueOnce(response({ shortname: 'Server' }))
      .mockResolvedValueOnce(response({ players: [{ uid: 'player-1' }, { uid: 'player-2' }] })) as typeof fetch;
    global.fetch = fetchMock;

    await expect(service.getServerLiveStatus('server-1')).resolves.toMatchObject({
      status: 'online',
      queryData: { name: 'Server', playercount: 2 },
    });
    jest.setSystemTime(new Date('2026-06-24T12:00:02.000Z'));
    await expect(service.getServerLiveStatus('server-1')).resolves.toMatchObject({
      status: 'online',
      queryData: { name: 'Server', playercount: 2 },
      onlinePlayers: [{ uid: 'player-1' }, { uid: 'player-2' }],
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    jest.useRealTimers();
  });

  test('normalizes invalid stored live status fields while query data is fresh', async () => {
    state.servers = [
      {
        id: 'server-1',
        label: 'Server',
        queryUrl: 'http://query.example',
        data: { playercount: 0 },
        status: 'offline',
        onlinePlayers: { players: [] } as unknown as unknown[],
        errorMessage: { message: 'stored error' } as unknown as string,
        queryDataUpdatedAt: new Date().toISOString(),
        public: true,
        createdAt: new Date().toISOString(),
      },
    ];
    const fetchMock = jest.fn() as typeof fetch;
    global.fetch = fetchMock;

    await expect(service.getServerLiveStatus('server-1')).resolves.toMatchObject({
      status: 'offline',
      queryData: { playercount: 0 },
      onlinePlayers: undefined,
      errorMessage: undefined,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('refreshes after cache expiry and reports offline main query failures', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-24T12:00:00.000Z'));

    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(response({ name: 'Server' }))
      .mockResolvedValueOnce(response({ contact: 'admin' }))
      .mockResolvedValueOnce(response({ players: [] }))
      .mockResolvedValueOnce(response({}, 500))
      .mockResolvedValueOnce(response({ contact: 'admin' }))
      .mockResolvedValueOnce(response({ players: 'bad' })) as typeof fetch;
    global.fetch = fetchMock;

    await expect(service.getServerLiveStatus('server-1')).resolves.toMatchObject({
      status: 'online',
    });
    jest.setSystemTime(new Date('2026-06-24T12:01:01.000Z'));
    await expect(service.getServerLiveStatus('server-1')).resolves.toMatchObject({
      status: 'offline',
      errorMessage: 'HTTP 500',
      onlinePlayers: undefined,
    });
    expect(fetchMock).toHaveBeenCalledTimes(6);

    jest.useRealTimers();
  });

  test('reports unknown fetch errors when the thrown value is not an Error', async () => {
    const fetchMock = jest
      .fn()
      .mockRejectedValueOnce('network failed')
      .mockResolvedValueOnce(response({ contact: 'admin' }))
      .mockResolvedValueOnce(response({ players: [] })) as typeof fetch;
    global.fetch = fetchMock;

    await expect(service.getServerLiveStatus('server-1')).resolves.toMatchObject({
      status: 'offline',
      errorMessage: 'UNKNOWN_ERROR',
    });
  });

  test('validates missing servers and missing query urls', async () => {
    await expect(service.getServerLiveStatus('missing')).rejects.toThrow('SERVER_NOT_FOUND');

    state.servers = [{
      id: 'server-2',
      label: 'Server',
      queryUrl: '',
      public: true,
      createdAt: new Date().toISOString(),
    }];
    await expect(service.getServerLiveStatus('server-2')).rejects.toThrow('QUERY_URL_MISSING');
  });
});

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
