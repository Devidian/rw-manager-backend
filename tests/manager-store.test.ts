import { jest } from '@jest/globals';

type ServerRecord = {
  id: string;
  label: string;
  queryUrl: string;
  public: boolean;
  userId?: string;
  steamId?: string;
  connectorCredential?: string;
  ip?: string;
  port?: number;
  lastSeen?: Date;
  createdAt: Date;
};

type UserRecord = {
  id: string;
  username: string;
  email: string;
  state: 'new' | 'verified' | 'closed';
  role: 'guest' | 'user' | 'admin';
  steamId?: string;
  pinnedServers?: string[];
  passwordHash: string;
  salt: string;
  createdAt: Date;
};

const state = {
  servers: [] as ServerRecord[],
  users: [] as UserRecord[],
};
const writeMock = jest.fn<() => Promise<void>>().mockResolvedValue();
const getMongoCollectionsMock = jest.fn();
const uuidMock = jest.fn<() => string>();
const randomBytesMock = jest.fn<(size: number) => Buffer>();
const scryptSyncMock = jest.fn<(password: string, salt: string, keylen: number) => Buffer>();
const timingSafeEqualMock = jest.fn<(a: Buffer, b: Buffer) => boolean>();

jest.unstable_mockModule('../src/db/non-storage-store.js', () => ({
  nonStorageDb: {
    data: state,
    write: writeMock,
  },
}));

jest.unstable_mockModule('../src/db/mongodb.js', () => ({
  getMongoCollections: getMongoCollectionsMock,
}));

jest.unstable_mockModule('uuid', () => ({
  v4: uuidMock,
}));

jest.unstable_mockModule('node:crypto', () => ({
  randomBytes: randomBytesMock,
  scryptSync: scryptSyncMock,
  timingSafeEqual: timingSafeEqualMock,
}));

const store = await import('../src/db/manager-store.js');

function server(overrides: Partial<ServerRecord> = {}): ServerRecord {
  return {
    id: 'server-1',
    label: 'Server',
    queryUrl: 'https://query.example',
    public: true,
    userId: 'user-1',
    createdAt: new Date('2026-06-25T00:00:00.000Z'),
    ...overrides,
  };
}

function user(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: 'user-1',
    username: 'alice',
    email: 'alice@example.com',
    state: 'verified',
    role: 'user',
    steamId: 'steam-1',
    pinnedServers: [],
    passwordHash: Buffer.from('hash').toString('hex'),
    salt: 'salt',
    createdAt: new Date('2026-06-25T00:00:00.000Z'),
    ...overrides,
  };
}

describe('manager-store', () => {
  beforeEach(() => {
    state.servers = [];
    state.users = [];
    writeMock.mockClear();
    getMongoCollectionsMock.mockReset().mockReturnValue(undefined);
    uuidMock.mockReset().mockReturnValue('generated-id');
    randomBytesMock.mockReset().mockReturnValue(Buffer.from('salt'));
    scryptSyncMock.mockReset().mockReturnValue(Buffer.from('hash'));
    timingSafeEqualMock.mockReset().mockReturnValue(true);
  });

  test('uses JSON fallback for server and user mutations', async () => {
    const createdServer = await store.addServer(
      'Created',
      'https://query.example',
      'https://backend.example',
      'user-1',
      true,
    );
    expect(createdServer).toMatchObject({ id: 'generated-id', label: 'Created' });
    expect(await store.listServers()).toHaveLength(1);

    await expect(store.updateServer('missing', { label: 'x' })).resolves.toBeNull();
    await expect(store.updateServer('generated-id', {
      label: 'Updated',
      queryUrl: undefined,
      status: 'online',
    })).resolves.toMatchObject({
      label: 'Updated',
      queryUrl: 'https://query.example',
      status: 'online',
    });

    await store.removeServer('generated-id');
    expect(state.servers).toEqual([]);

    const createdUser = await store.createUser(
      'bob',
      'bob@example.com',
      'secret',
      undefined,
      'admin',
      'verified',
    );
    expect(createdUser).toMatchObject({
      id: 'generated-id',
      username: 'bob',
      role: 'admin',
    });
    expect(await store.findUserByUsername('bob')).toMatchObject({ username: 'bob' });
    await expect(store.setUserSteamId('generated-id', '')).resolves.toMatchObject({
      steamId: undefined,
    });
    await expect(store.updateUser('missing', { username: 'x' })).resolves.toBeNull();
    await expect(store.updateUser('generated-id', { username: 'bobby' })).resolves.toMatchObject({
      username: 'bobby',
    });
    expect(writeMock).toHaveBeenCalled();
  });

  test('updates pinned ids and deletes users with owned servers in JSON fallback', async () => {
    state.users = [
      user({ id: 'user-1', pinnedServers: ['old', 'keep'] }),
      user({ id: 'user-2', pinnedServers: undefined }),
    ];
    state.servers = [
      server({ id: 'a', userId: 'user-1' }),
      server({ id: 'b', userId: 'user-2' }),
    ];

    await store.replacePinnedServerId('old', 'new');
    expect(state.users[0].pinnedServers).toEqual(['new', 'keep']);
    await store.replacePinnedServerId('new', 'new');
    await expect(store.removePinnedServer('user-1', 'keep')).resolves.toMatchObject({
      pinnedServers: ['new'],
    });

    await expect(store.deleteUserAndOwnedServers('missing')).resolves.toBe(false);
    await expect(store.deleteUserAndOwnedServers('user-1')).resolves.toBe(true);
    expect(state.users.map((entry) => entry.id)).toEqual(['user-2']);
    expect(state.servers.map((entry) => entry.id)).toEqual(['b']);
  });

  test('prunes only stale master catalog records and their pins, never user-owned records', async () => {
    state.servers = [
      server({ id: 'stale-master', ip: '127.0.0.1', port: 4255, userId: undefined, lastSeen: new Date('2026-05-01T00:00:00.000Z') }),
      server({ id: 'boundary-master', ip: '127.0.0.2', port: 4255, userId: undefined, lastSeen: new Date('2026-05-26T00:00:00.000Z') }),
      server({ id: 'manual-server', ip: '127.0.0.3', port: 4255, userId: 'user-1', lastSeen: new Date('2026-05-01T00:00:00.000Z') }),
    ];
    state.users = [user({ pinnedServers: ['stale-master', 'boundary-master'] })];

    await expect(store.removeStaleMasterServers(new Date('2026-05-26T00:00:00.000Z')))
      .resolves.toEqual(['stale-master']);
    expect(state.servers.map((entry) => entry.id)).toEqual(['boundary-master', 'manual-server']);
    expect(state.users[0].pinnedServers).toEqual(['boundary-master']);
  });

  test('maps users and verifies passwords', () => {
    const record = user({ pinnedServers: undefined });
    expect(store.toPrivateUser(record)).toMatchObject({
      id: 'user-1',
      email: 'alice@example.com',
      pinnedServers: [],
    });
    expect(store.toPublicUser(record)).toMatchObject({
      id: 'user-1',
      pinnedServers: [],
    });
    expect(store.toPublicUser(record)).not.toHaveProperty('email');

    scryptSyncMock.mockReturnValueOnce(Buffer.from('short'));
    expect(store.verifyUserPassword(record, 'secret')).toBe(false);
    scryptSyncMock.mockReturnValueOnce(Buffer.from('hash'));
    timingSafeEqualMock.mockReturnValueOnce(true);
    expect(store.verifyUserPassword(record, 'secret')).toBe(true);
  });

  test('stale status and master snapshots preserve a concurrently paired credential', async () => {
    state.servers.push(server({ id: 'paired', ip: '127.0.0.1', port: 4255 }));
    const stale = { ...state.servers[0] };
    expect(await store.claimServerConnectorCredential('paired', 'encrypted-original')).toBe(true);
    expect(await store.claimServerConnectorCredential('paired', 'replacement')).toBe(false);
    await store.saveServer({ ...stale, label: 'status refresh' });
    await store.saveMasterServer({ ...stale, label: 'master refresh', connectorCredential: 'stale' });
    expect(state.servers[0].connectorCredential).toBe('encrypted-original');
    expect(JSON.parse(JSON.stringify(state.servers))[0].connectorCredential).toBe('encrypted-original');
  });

  test('resets only the credential that was rejected', async () => {
    state.servers.push(server({ id: 'paired', connectorCredential: 'encrypted-original' }));
    expect(await store.resetServerConnectorCredential('paired', 'replacement')).toBe(false);
    expect(state.servers[0].connectorCredential).toBe('encrypted-original');
    expect(await store.resetServerConnectorCredential('paired', 'encrypted-original')).toBe(true);
    expect(state.servers[0].connectorCredential).toBeUndefined();
  });

  test('replaces a credential only for an existing server', async () => {
    state.servers.push(server({ id: 'paired', connectorCredential: 'encrypted-original' }));
    expect(await store.replaceServerConnectorCredential('missing', 'replacement')).toBe(false);
    expect(await store.replaceServerConnectorCredential('paired', 'replacement')).toBe(true);
    expect(state.servers[0].connectorCredential).toBe('replacement');
  });

  test('uses Mongo collections and strips _id fields', async () => {
    const mongoServer = { _id: 'mongo-id', ...server({ id: 'mongo-server', steamId: 'steam-server' }) };
    const mongoUser = { _id: 'mongo-id', ...user({ id: 'mongo-user' }) };
    const serversFind = jest.fn().mockReturnValue({ toArray: jest.fn(async () => [mongoServer]) });
    const usersFind = jest.fn().mockReturnValue({ toArray: jest.fn(async () => [mongoUser]) });
    const collections = {
      servers: {
        find: serversFind,
        findOne: jest.fn(async () => mongoServer),
        updateOne: jest.fn(async () => ({ modifiedCount: 1 })),
        replaceOne: jest.fn(async () => undefined),
        deleteOne: jest.fn(async () => undefined),
        deleteMany: jest.fn(async () => undefined),
      },
      users: {
        find: usersFind,
        findOne: jest.fn(async () => mongoUser),
        replaceOne: jest.fn(async () => undefined),
        deleteOne: jest.fn(async () => undefined),
      },
    };
    getMongoCollectionsMock.mockReturnValue(collections);

    await expect(store.listServers()).resolves.toEqual([
      expect.not.objectContaining({ _id: expect.anything() }),
    ]);
    await expect(store.findServerByMasterEndpoint('127.0.0.1', 4255)).resolves.toMatchObject({
      id: 'mongo-server',
    });
    await expect(store.findServerById('mongo-server')).resolves.toMatchObject({
      id: 'mongo-server',
    });
    await store.saveMasterServer(server({
      id: 'mongo-server',
      ip: '127.0.0.1',
      port: 4255,
    }));
    await store.removeServer('mongo-server');

    await expect(store.listUsers()).resolves.toEqual([
      expect.not.objectContaining({ _id: expect.anything() }),
    ]);
    await expect(store.findUserById('mongo-user')).resolves.toMatchObject({ id: 'mongo-user' });
    await expect(store.findUserByUsername('alice')).resolves.toMatchObject({ username: 'alice' });
    await expect(store.findUserBySteamId('steam-1')).resolves.toMatchObject({ steamId: 'steam-1' });
    await store.saveUser(user({ id: 'mongo-user' }));
    await expect(store.deleteUserAndOwnedServers('mongo-user')).resolves.toBe(true);

    expect(collections.servers.updateOne).toHaveBeenCalledWith(
      { ip: '127.0.0.1', port: 4255 },
      { $set: expect.objectContaining({ id: 'mongo-server' }) },
      { upsert: true },
    );
    expect(collections.users.deleteOne).toHaveBeenCalledWith({ id: 'mongo-user' });
    expect(collections.servers.deleteMany).toHaveBeenCalledWith({ userId: 'mongo-user' });
  });

  test('removes stale Mongo catalog records and pins without touching statistics', async () => {
    const stale = server({ id: 'stale-master', ip: '127.0.0.1', port: 4255, userId: undefined, lastSeen: new Date('2026-05-01T00:00:00.000Z') });
    const statisticsDeleteMany = jest.fn();
    const collections = {
      servers: {
        find: jest.fn().mockReturnValue({ toArray: jest.fn(async () => [stale]) }),
        deleteMany: jest.fn(async () => undefined),
      },
      users: { updateMany: jest.fn(async () => undefined) },
      serverStatistics: { deleteMany: statisticsDeleteMany },
    };
    getMongoCollectionsMock.mockReturnValue(collections);

    await expect(store.removeStaleMasterServers(new Date('2026-05-26T00:00:00.000Z')))
      .resolves.toEqual(['stale-master']);
    expect(collections.servers.deleteMany).toHaveBeenCalledWith({ id: { $in: ['stale-master'] } });
    expect(collections.users.updateMany).toHaveBeenCalledWith(
      { pinnedServers: { $in: ['stale-master'] } },
      { $pull: { pinnedServers: { $in: ['stale-master'] } } },
    );
    expect(statisticsDeleteMany).not.toHaveBeenCalled();
  });
});
