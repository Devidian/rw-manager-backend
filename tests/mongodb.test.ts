import { jest } from '@jest/globals';

const jsonState = {
  servers: [
    {
      id: 'server-1',
      label: 'Server',
      queryUrl: 'https://query.example',
      public: true,
      createdAt: new Date('2026-06-25T00:00:00.000Z'),
    },
  ],
  users: [
    {
      id: 'user-1',
      username: 'alice',
      email: 'alice@example.com',
      state: 'verified',
      role: 'user',
      pinnedServers: [],
      passwordHash: 'hash',
      salt: 'salt',
      createdAt: new Date('2026-06-25T00:00:00.000Z'),
    },
  ],
  serverStatistics: [
    {
      id: 'server-1:2026-06-25T00:00:00.000Z',
      serverId: 'server-1',
      hourStart: '2026-06-25T00:00:00.000Z',
      sampleCount: 1,
      onlineSampleCount: 1,
      playerSampleTotal: 3,
      maxPlayers: 3,
      averagePlayers: 3,
      availability: 100,
      updatedAt: '2026-06-25T00:10:00.000Z',
    },
  ],
};

const warnMock = jest.fn();
const logMock = jest.fn();
const connectMock = jest.fn<() => Promise<void>>();
const closeMock = jest.fn<() => Promise<void>>();
const collectionMock = jest.fn();
const dbMock = jest.fn();
const mongoClientConstructorMock = jest.fn();

jest.unstable_mockModule('../src/db/json.js', () => ({
  db: {
    data: jsonState,
  },
}));

jest.unstable_mockModule('../src/utils/logger.js', () => ({
  defaultLogger: {
    warn: warnMock,
    log: logMock,
  },
}));

jest.unstable_mockModule('mongodb', () => ({
  MongoClient: class {
    constructor(uri: string, options: unknown) {
      mongoClientConstructorMock(uri, options);
    }
    connect = connectMock;
    close = closeMock;
    db = dbMock;
  },
}));

const mongodb = await import('../src/db/mongodb.js');

function collection(name: string, count = 0) {
  return {
    name,
    createIndex: jest.fn(async () => undefined),
    dropIndex: jest.fn(async () => undefined),
    estimatedDocumentCount: jest.fn(async () => count),
    bulkWrite: jest.fn(async () => undefined),
  };
}

function restoreEnv(snapshot: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in snapshot)) delete process.env[key];
  }
  Object.assign(process.env, snapshot);
}

describe('db/mongodb', () => {
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    restoreEnv(originalEnv);
    warnMock.mockReset();
    logMock.mockReset();
    connectMock.mockReset().mockResolvedValue();
    closeMock.mockReset().mockResolvedValue();
    collectionMock.mockReset();
    dbMock.mockReset().mockReturnValue({ collection: collectionMock });
    mongoClientConstructorMock.mockReset();
    await mongodb.closeMongoDb();
    closeMock.mockClear();
  });

  afterAll(async () => {
    restoreEnv(originalEnv);
    await mongodb.closeMongoDb();
  });

  test('warns and uses JSON fallback when no MongoDB URI is configured', async () => {
    delete process.env.MONGODB_URI;
    delete process.env.MONGO_URI;

    await expect(mongodb.bootstrapMongoDb()).resolves.toBeUndefined();
    expect(warnMock).toHaveBeenCalledWith(
      'MONGODB_URI is not set; using JSON database fallback',
    );
    expect(mongodb.getMongoCollections()).toBeUndefined();
  });

  test('connects, creates indexes, seeds empty collections, and caches collections', async () => {
    process.env.MONGODB_URI = 'mongodb://example';
    process.env.MONGODB_DATABASE = 'rw-manager-test';
    const servers = collection('servers');
    const users = collection('users');
    const statistics = collection('server_statistics');
    collectionMock
      .mockReturnValueOnce(servers)
      .mockReturnValueOnce(users)
      .mockReturnValueOnce(statistics);

    const collections = await mongodb.bootstrapMongoDb();

    expect(collections).toEqual({
      servers,
      users,
      serverStatistics: statistics,
    });
    expect(mongoClientConstructorMock).toHaveBeenCalledWith('mongodb://example', {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
    });
    expect(dbMock).toHaveBeenCalledWith('rw-manager-test');
    expect(servers.dropIndex).toHaveBeenCalledWith('steamId_1');
    expect(servers.createIndex).toHaveBeenCalledWith({ id: 1 }, { unique: true });
    expect(servers.createIndex).toHaveBeenCalledWith(
      { ip: 1, port: 1 },
      {
        unique: true,
        partialFilterExpression: {
          ip: { $type: 'string' },
          port: { $type: 'number' },
        },
      },
    );
    expect(users.createIndex).toHaveBeenCalledWith({ username: 1 }, { unique: true });
    expect(statistics.createIndex).toHaveBeenCalledWith(
      { serverId: 1, hourStart: 1 },
      { unique: true },
    );
    expect(servers.bulkWrite).toHaveBeenCalledWith([
      expect.objectContaining({
        replaceOne: expect.objectContaining({
          filter: { id: 'server-1' },
          upsert: true,
        }),
      }),
    ]);
    expect(users.bulkWrite).toHaveBeenCalled();
    expect(statistics.bulkWrite).toHaveBeenCalled();
    expect(logMock).toHaveBeenCalledWith('MongoDB seeded from JSON fallback data');
    expect(logMock).toHaveBeenCalledWith('MongoDB connected: rw-manager-test');

    await expect(mongodb.bootstrapMongoDb()).resolves.toBe(collections);
    expect(collectionMock).toHaveBeenCalledTimes(3);
  });

  test('skips seeding non-empty collections and closes failed clients', async () => {
    process.env.MONGO_URI = 'mongodb://fallback-var';
    process.env.MONGODB_CONNECT_TIMEOUT_MS = '1234';
    const servers = collection('servers', 1);
    const users = collection('users', 1);
    const statistics = collection('server_statistics', 1);
    collectionMock
      .mockReturnValueOnce(servers)
      .mockReturnValueOnce(users)
      .mockReturnValueOnce(statistics);

    await expect(mongodb.bootstrapMongoDb()).resolves.toBeDefined();
    expect(mongoClientConstructorMock).toHaveBeenCalledWith('mongodb://fallback-var', {
      serverSelectionTimeoutMS: 1234,
      connectTimeoutMS: 1234,
    });
    expect(servers.bulkWrite).not.toHaveBeenCalled();
    await mongodb.closeMongoDb();
    expect(closeMock).toHaveBeenCalled();

    connectMock.mockRejectedValueOnce(new Error('offline'));
    await expect(mongodb.bootstrapMongoDb()).resolves.toBeUndefined();
    expect(warnMock).toHaveBeenCalledWith(
      'MongoDB unavailable; using JSON database fallback: offline',
    );
  });
});
