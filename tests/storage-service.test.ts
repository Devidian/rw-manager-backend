import { jest } from '@jest/globals';

interface StoredServer {
  id: string;
  label: string;
  queryUrl: string | Record<string, unknown>;
  backendUrl?: string;
  public: boolean;
  userId?: string;
  status?: 'online' | 'offline' | 'unknown';
  lastChecked?: Date | string;
  lastSeen?: Date | string;
  blocked?: boolean;
  blockedAt?: Date | string | null;
  createdAt: Date;
}

interface StoredUser {
  id: string;
  username: string;
  state: 'new' | 'verified' | 'closed';
  role: 'guest' | 'user' | 'admin';
  steamId?: string;
  pinnedServers?: string[];
  createdAt: Date;
}

const state = {
  servers: [] as StoredServer[],
  users: [] as StoredUser[],
};

const addServerMock = jest.fn();
const removeServerMock = jest.fn<() => Promise<void>>().mockResolvedValue();
const updateServerMock = jest.fn();
const findServerByIdMock = jest.fn();
const findUserByIdMock = jest.fn();
const listServersMock = jest.fn();
const listUsersMock = jest.fn();
const toPublicUserMock = jest.fn();
const updateUserMock = jest.fn();
const deleteUserAndOwnedServersMock = jest.fn();
const mapServerToDtoMock = jest.fn();
const mapPublicUserToDtoMock = jest.fn();
const canAdminServerMock = jest.fn();
const fetchBackendAdminsMock = jest.fn();
const writeMock = jest.fn<() => Promise<void>>().mockResolvedValue();

jest.unstable_mockModule('../src/db/manager-store.js', () => ({
  addServer: addServerMock,
  findServerById: findServerByIdMock,
  findUserById: findUserByIdMock,
  listServers: listServersMock,
  listUsers: listUsersMock,
  removeServer: removeServerMock,
  toPublicUser: toPublicUserMock,
  updateServer: updateServerMock,
  updateUser: updateUserMock,
  deleteUserAndOwnedServers: deleteUserAndOwnedServersMock,
}));

jest.unstable_mockModule('../src/mapper/server-mapper.js', () => ({
  mapServerToDto: mapServerToDtoMock,
}));

jest.unstable_mockModule('../src/mapper/user-mapper.js', () => ({
  mapPublicUserToDto: mapPublicUserToDtoMock,
}));

jest.unstable_mockModule('../src/service/can-admin-server-service.js', () => ({
  canAdminServer: canAdminServerMock,
  fetchBackendAdmins: fetchBackendAdminsMock,
}));

const storageService = await import('../src/service/storage-service.js');

function createServerRecord(overrides: Partial<StoredServer> = {}): StoredServer {
  return {
    id: 'server-1',
    label: 'Server',
    queryUrl: 'https://query.example.com',
    backendUrl: 'https://backend.example.com',
    public: false,
    userId: 'user-1',
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function createUserRecord(overrides: Partial<StoredUser> = {}): StoredUser {
  return {
    id: 'user-1',
    username: 'alice',
    state: 'verified',
    role: 'user',
    steamId: 'steam-1',
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function restoreEnv(snapshot: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in snapshot)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, snapshot);
}

describe('storage-service', () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  beforeEach(() => {
    restoreEnv(originalEnv);
    process.env.ENABLE_AUTH = 'false';
    process.env.SUPER_ADMIN_ID = 'steam-admin';
    state.servers = [];
    state.users = [];
    addServerMock.mockReset();
    removeServerMock.mockClear();
    updateServerMock.mockReset();
    findServerByIdMock.mockReset().mockImplementation(async (id: string) =>
      state.servers.find((server) => server.id === id),
    );
    findUserByIdMock.mockReset().mockImplementation(async (id: string) =>
      state.users.find((user) => user.id === id),
    );
    listServersMock.mockReset().mockImplementation(async () => state.servers);
    listUsersMock.mockReset().mockImplementation(async () => state.users);
    toPublicUserMock.mockReset().mockImplementation((user: StoredUser) => ({
      id: user.id,
      username: user.username,
      state: user.state,
      role: user.role,
      steamId: user.steamId,
      pinnedServers: user.pinnedServers ?? [],
      createdAt: user.createdAt,
    }));
    updateUserMock.mockReset().mockImplementation(async (id: string, patch: Partial<StoredUser>) => {
      const user = state.users.find((entry) => entry.id === id);
      if (!user) return null;
      Object.assign(user, patch);
      return user;
    });
    deleteUserAndOwnedServersMock.mockReset().mockImplementation(async (id: string) => {
      const exists = state.users.some((user) => user.id === id);
      if (!exists) return false;
      state.users = state.users.filter((user) => user.id !== id);
      state.servers = state.servers.filter((server) => server.userId !== id);
      return true;
    });
    mapServerToDtoMock.mockReset().mockImplementation((server: StoredServer) => ({
      id: server.id,
      label: server.label,
      blocked: server.blocked,
      blockedAt: server.blockedAt,
    }));
    mapPublicUserToDtoMock.mockReset().mockImplementation((user: StoredUser) => ({
      id: user.id,
      username: user.username,
      role: user.role,
      state: user.state,
      steamId: user.steamId,
      pinnedServers: user.pinnedServers ?? [],
      createdAt: user.createdAt.toISOString(),
    }));
    canAdminServerMock.mockReset();
    fetchBackendAdminsMock.mockReset();
    writeMock.mockClear();
    global.fetch = originalFetch;
  });

  afterAll(() => {
    restoreEnv(originalEnv);
    global.fetch = originalFetch;
  });

  test('listServers returns visible shared servers independent of auth ownership', async () => {
    state.servers = [
      createServerRecord({ id: 'a', public: false, userId: 'user-1' }),
      createServerRecord({ id: 'b', public: true, userId: 'user-2' }),
      createServerRecord({ id: 'c', public: false, userId: 'user-2' }),
      createServerRecord({ id: 'blocked', blocked: true }),
      createServerRecord({
        id: 'stale-offline',
        status: 'offline',
        lastChecked: new Date('2026-06-01T00:00:00.000Z'),
      }),
    ];

    process.env.ENABLE_AUTH = 'true';
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-10T00:00:00.000Z'));
    await expect(storageService.listServers({ userId: 'user-1' })).resolves.toEqual([
      { id: 'a', label: 'Server', blocked: undefined, blockedAt: undefined },
      { id: 'b', label: 'Server', blocked: undefined, blockedAt: undefined },
      { id: 'c', label: 'Server', blocked: undefined, blockedAt: undefined },
    ]);
    await expect(storageService.listServers({ userId: 'user-1', userSteamId: 'steam-admin' })).resolves.toHaveLength(5);
    jest.useRealTimers();
  });

  test('setServerBlocked is restricted to the super admin', async () => {
    state.servers = [createServerRecord({ id: 'server-1' })];
    updateServerMock.mockImplementation(async (id: string, patch: Partial<StoredServer>) => {
      const server = state.servers.find((entry) => entry.id === id);
      if (!server) return null;
      Object.assign(server, patch);
      return server;
    });

    await expect(storageService.setServerBlocked('server-1', true, 'steam-user')).rejects.toThrow('FORBIDDEN');

    await expect(storageService.setServerBlocked('server-1', true, 'steam-admin')).resolves.toMatchObject({
      id: 'server-1',
      blocked: true,
      blockedAt: expect.any(Date),
    });
    expect(updateServerMock).toHaveBeenLastCalledWith('server-1', {
      blocked: true,
      blockedAt: expect.any(Date),
    });

    await expect(storageService.setServerBlocked('server-1', false, 'steam-admin')).resolves.toMatchObject({
      id: 'server-1',
      blocked: false,
      blockedAt: null,
    });
    expect(updateServerMock).toHaveBeenLastCalledWith('server-1', {
      blocked: false,
      blockedAt: null,
    });
  });

  test('createServer validates required fields and duplicate query urls', async () => {
    await expect(
      storageService.createServer(
        { label: '', queryUrl: '' },
        { userId: 'user-1', userSteamId: 'steam-1' },
      ),
    ).rejects.toThrow('LABEL_QUERY_URL_REQUIRED');

    state.servers = [createServerRecord()];
    await expect(
      storageService.createServer(
        { label: 'Server', queryUrl: 'https://query.example.com' },
        { userId: 'user-1', userSteamId: 'steam-1' },
      ),
    ).rejects.toThrow('QUERY_URL_EXISTS');
  });

  test('pinServer and unpinServer update the current user pinned server list', async () => {
    state.servers = [createServerRecord({ id: 'server-1' })];
    state.users = [createUserRecord({ id: 'user-1' })];

    await expect(
      storageService.pinServer('server-1', {
        userId: 'user-1',
        userSteamId: 'steam-1',
      }),
    ).resolves.toMatchObject({
      id: 'user-1',
      pinnedServers: ['server-1'],
    });
    expect(state.users[0].pinnedServers).toEqual(['server-1']);

    await storageService.pinServer('server-1', {
      userId: 'user-1',
      userSteamId: 'steam-1',
    });
    expect(state.users[0].pinnedServers).toEqual(['server-1']);

    await expect(
      storageService.unpinServer('server-1', {
        userId: 'user-1',
        userSteamId: 'steam-1',
      }),
    ).resolves.toMatchObject({
      id: 'user-1',
      pinnedServers: [],
    });
    expect(state.users[0].pinnedServers).toEqual([]);
  });

  test('pinServer rejects new favorites at the configured limit but keeps idempotent pins', async () => {
    process.env.MAX_PINNED_SERVERS = '1';
    state.servers = [
      createServerRecord({ id: 'server-1' }),
      createServerRecord({ id: 'server-2' }),
    ];
    state.users = [createUserRecord({ id: 'user-1', pinnedServers: ['server-1'] })];

    await expect(storageService.pinServer('server-1', { userId: 'user-1' }))
      .resolves.toMatchObject({ pinnedServers: ['server-1'] });
    await expect(storageService.pinServer('server-2', { userId: 'user-1' }))
      .rejects.toThrow('PINNED_SERVER_LIMIT_REACHED');
    expect(state.users[0].pinnedServers).toEqual(['server-1']);
  });

  test('pinServer validates auth, server existence, and user existence', async () => {
    await expect(
      storageService.pinServer('server-1', {}),
    ).rejects.toThrow('UNAUTHORIZED');

    await expect(
      storageService.pinServer('server-1', { userId: 'user-1' }),
    ).rejects.toThrow('SERVER_NOT_FOUND');

    state.servers = [createServerRecord({ id: 'server-1' })];
    await expect(
      storageService.pinServer('server-1', { userId: 'user-1' }),
    ).rejects.toThrow('USER_NOT_FOUND');
  });

  test('createServer handles backend verification branches and returns mapped servers', async () => {
    process.env.ENABLE_AUTH = 'true';

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ name: 'Query Name' }),
    }) as typeof fetch;
    fetchBackendAdminsMock.mockResolvedValueOnce(null);
    await expect(
      storageService.createServer(
        {
          label: 'Server',
          queryUrl: 'https://query.example.com',
          backendUrl: 'https://backend.example.com/',
        },
        { userId: 'user-1', userSteamId: 'steam-1' },
      ),
    ).rejects.toThrow('FAILED_VERIFY_BACKEND_ADMINS');

    fetchBackendAdminsMock.mockResolvedValueOnce(['other-steam']);
    await expect(
      storageService.createServer(
        {
          label: 'Server',
          queryUrl: 'https://query.example.com',
          backendUrl: 'https://backend.example.com/',
        },
        { userId: 'user-1', userSteamId: 'steam-1' },
      ),
    ).rejects.toThrow('NOT_BACKEND_ADMIN');

    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => ({}),
    }) as typeof fetch;
    fetchBackendAdminsMock.mockResolvedValueOnce([]);
    await expect(
      storageService.createServer(
        {
          label: 'Server',
          queryUrl: 'https://query.example.com',
          backendUrl: 'https://backend.example.com/',
        },
        { userId: 'user-1', userSteamId: 'steam-1' },
      ),
    ).rejects.toThrow('QUERY_URL_NAME_REQUIRED');

    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ name: 'Query Name' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({}),
      }) as typeof fetch;
    fetchBackendAdminsMock.mockResolvedValueOnce([]);
    await expect(
      storageService.createServer(
        {
          label: 'Server',
          queryUrl: 'https://query.example.com',
          backendUrl: 'https://backend.example.com/',
        },
        { userId: 'user-1', userSteamId: 'steam-1' },
      ),
    ).rejects.toThrow('FAILED_VERIFY_BACKEND_CONFIG');

    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ name: 'Query Name' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ name: 'Different Name' }),
      }) as typeof fetch;
    fetchBackendAdminsMock.mockResolvedValueOnce([]);
    await expect(
      storageService.createServer(
        {
          label: 'Server',
          queryUrl: 'https://query.example.com',
          backendUrl: 'https://backend.example.com/',
        },
        { userId: 'user-1', userSteamId: 'steam-1' },
      ),
    ).rejects.toThrow('QUERY_URL_NAME_MISMATCH');

    const created = createServerRecord({ id: 'server-9' });
    addServerMock.mockResolvedValueOnce(created);
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ name: 'Query Name' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ name: 'Query Name' }),
      }) as typeof fetch;
    fetchBackendAdminsMock.mockResolvedValueOnce([]);

    await expect(
      storageService.createServer(
        {
          label: 'Server',
          queryUrl: 'https://query.example.com',
          backendUrl: ' https://backend.example.com/ ',
          public: true,
        },
        { userId: 'user-1', userSteamId: 'steam-1' },
      ),
    ).resolves.toEqual({ id: 'server-9', label: 'Server' });

    expect(addServerMock).toHaveBeenCalledWith(
      'Server',
      'https://query.example.com',
      'https://backend.example.com/',
      'user-1',
      true,
    );

    const circular: { self?: unknown } = {};
    circular.self = circular;
    addServerMock.mockResolvedValueOnce(createServerRecord({ id: 'server-10' }));
    await expect(
      storageService.createServer(
        {
          label: 'Server',
          queryUrl: circular as Record<string, unknown>,
        },
        { userId: 'user-1', userSteamId: 'steam-1' },
      ),
    ).resolves.toEqual({ id: 'server-10', label: 'Server' });

    process.env.ENABLE_AUTH = 'true';
    global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as typeof fetch;
    fetchBackendAdminsMock.mockResolvedValueOnce([]);
    await expect(
      storageService.createServer(
        {
          label: 'Server',
          queryUrl: 'https://query.example.com',
          backendUrl: 'https://backend.example.com/',
        },
        { userId: 'user-1', userSteamId: 'steam-1' },
      ),
    ).rejects.toThrow('QUERY_URL_NAME_REQUIRED');
  });

  test('patchServer validates ownership, duplicates, backend checks, and missing updates', async () => {
    process.env.ENABLE_AUTH = 'true';
    await expect(
      storageService.patchServer(
        'missing',
        {},
        { userId: 'user-1', userSteamId: 'steam-1' },
      ),
    ).rejects.toThrow('SERVER_NOT_FOUND');

    state.servers = [
      createServerRecord({ id: 'server-1', userId: 'user-1', queryUrl: 'https://one' }),
      createServerRecord({ id: 'server-2', userId: 'user-1', queryUrl: 'https://two' }),
    ];
    canAdminServerMock.mockResolvedValueOnce(false);
    await expect(
      storageService.patchServer(
        'server-2',
        {},
        { userId: 'other-user', userSteamId: 'steam-2' },
      ),
    ).rejects.toThrow('SERVER_NOT_FOUND');

    await expect(
      storageService.patchServer(
        'server-1',
        { queryUrl: 'https://two' },
        { userId: 'user-1', userSteamId: 'steam-1' },
      ),
    ).rejects.toThrow('QUERY_URL_EXISTS');

    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ name: 'Query Name' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ name: 'Query Name' }),
      }) as typeof fetch;
    fetchBackendAdminsMock.mockResolvedValueOnce([]);
    updateServerMock.mockResolvedValueOnce(null);
    await expect(
      storageService.patchServer(
        'server-1',
        { backendUrl: 'https://backend.example.com/' },
        { userId: 'user-1', userSteamId: 'steam-1' },
      ),
    ).rejects.toThrow('SERVER_NOT_FOUND');

    const updated = createServerRecord({ id: 'server-1', label: 'Updated' });
    updateServerMock.mockResolvedValueOnce(updated);
    await expect(
      storageService.patchServer(
        'server-1',
        { label: 'Updated' },
        { userId: 'user-1', userSteamId: 'steam-1' },
      ),
    ).resolves.toEqual({ id: 'server-1', label: 'Updated' });

    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ name: 'Query Name' }),
      })
      .mockRejectedValueOnce(new Error('offline')) as typeof fetch;
    fetchBackendAdminsMock.mockResolvedValueOnce([]);
    await expect(
      storageService.patchServer(
        'server-1',
        { queryUrl: 'https://query.example.com', backendUrl: 'https://backend.example.com/' },
        { userId: 'user-1', userSteamId: 'steam-1' },
      ),
    ).rejects.toThrow('FAILED_VERIFY_BACKEND_CONFIG');
  });

  test('deleteServer requires access and deletes matching servers', async () => {
    await expect(
      storageService.deleteServer('missing', { userId: 'user-1', userSteamId: 'steam-1' }),
    ).rejects.toThrow('SERVER_NOT_FOUND');

    state.servers = [createServerRecord({ id: 'server-1', userId: 'user-2' })];
    canAdminServerMock.mockResolvedValueOnce(true);
    await expect(
      storageService.deleteServer('server-1', {
        userId: 'user-1',
        userSteamId: 'steam-1',
      }),
    ).resolves.toBeUndefined();
    expect(removeServerMock).toHaveBeenCalledWith('server-1');
  });

  test('user management helpers enforce super admin permissions and validate patch values', async () => {
    state.users = [
      createUserRecord({ id: 'user-1', steamId: 'steam-admin' }),
      createUserRecord({ id: 'user-2', username: 'bob', role: 'guest' }),
    ];

    await expect(storageService.listUsers('wrong')).rejects.toThrow('FORBIDDEN');
    await expect(storageService.listUsers('steam-admin')).resolves.toHaveLength(2);

    await expect(
      storageService.patchUser('wrong', 'user-2', {}),
    ).rejects.toThrow('FORBIDDEN');
    await expect(
      storageService.patchUser('steam-admin', 'user-2', {
        state: 'bad' as 'new',
      }),
    ).rejects.toThrow('STATE_INVALID');
    await expect(
      storageService.patchUser('steam-admin', 'user-2', {
        role: 'bad' as 'user',
      }),
    ).rejects.toThrow('ROLE_INVALID');
    await expect(
      storageService.patchUser('steam-admin', 'missing', { role: 'admin' }),
    ).rejects.toThrow('USER_NOT_FOUND');

    await expect(
      storageService.patchUser('steam-admin', 'user-2', {
        role: 'admin',
        state: 'closed',
      }),
    ).resolves.toMatchObject({
      id: 'user-2',
      username: 'bob',
      role: 'admin',
      state: 'closed',
    });

    await expect(
      storageService.deleteStorageUser('wrong', 'user-1', 'user-2'),
    ).rejects.toThrow('FORBIDDEN');
    await expect(
      storageService.deleteStorageUser('steam-admin', 'user-1', 'user-1'),
    ).rejects.toThrow('CANNOT_DELETE_SELF');
    await expect(
      storageService.deleteStorageUser('steam-admin', 'user-1', 'missing'),
    ).rejects.toThrow('USER_NOT_FOUND');

    state.servers = [{ ...createServerRecord({ userId: 'user-2' }) }];
    await expect(
      storageService.deleteStorageUser('steam-admin', 'user-1', 'user-2'),
    ).resolves.toBeUndefined();
    expect(state.users.map((user) => user.id)).toEqual(['user-1']);
    expect(state.servers).toEqual([]);
  });
});
