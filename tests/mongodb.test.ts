import { jest } from '@jest/globals';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

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

function collection(name: string, count = 0, initialDocuments: Record<string, unknown>[] = []) {
  let documents: Record<string, unknown>[] = [...initialDocuments, ...Array.from({ length: count }, (_, index) => ({ id: `${name}-${index}` }))];
  return {
    name,
    createIndex: jest.fn(async () => undefined),
    dropIndex: jest.fn(async () => undefined),
    updateOne: jest.fn(async () => undefined),
    bulkWrite: jest.fn(async (operations: Array<{ updateOne: { filter: { id: string }; update: { $setOnInsert: Record<string, unknown> } } }>) => {
      for (const operation of operations) {
        if (!documents.some((document) => document.id === operation.updateOne.filter.id)) {
          documents.push(operation.updateOne.update.$setOnInsert);
        }
      }
    }),
    find: jest.fn((filter: { id?: { $in?: string[] }; 'onlinePlayerUids.0'?: { $exists?: boolean } } = {}) => {
      const found = (filter.id?.$in ? documents.filter((document) => filter.id!.$in!.includes(document.id as string)) : documents)
        .filter((document) => !filter['onlinePlayerUids.0']?.$exists || (Array.isArray(document.onlinePlayerUids) && document.onlinePlayerUids.length > 0));
      return { toArray: async () => found, async *[Symbol.asyncIterator]() { yield* found; } };
    }),
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

  test('requires MongoDB when storage is enabled', async () => {
    process.env.ENABLE_STORAGE = 'true';
    delete process.env.MONGODB_URI;
    delete process.env.MONGO_URI;

    await expect(mongodb.bootstrapMongoDb()).rejects.toThrow(
      'MONGODB_URI is required when ENABLE_STORAGE=true',
    );
    expect(warnMock).not.toHaveBeenCalled();
  });

  test('connects, creates indexes, and caches collections without a legacy source', async () => {
    process.env.MONGODB_URI = 'mongodb://example';
    process.env.MONGODB_DATABASE = 'rw-manager-test';
    const servers = collection('servers');
    const users = collection('users');
    const statistics = collection('server_statistics');
    const mappings = collection('player_mappings');
    const suppressed = collection('suppressed_servers');
    collectionMock
      .mockReturnValueOnce(servers)
      .mockReturnValueOnce(users)
      .mockReturnValueOnce(statistics)
      .mockReturnValueOnce(mappings)
      .mockReturnValueOnce(suppressed);

    const collections = await mongodb.bootstrapMongoDb();

    expect(collections).toEqual({
      servers,
      users,
      serverStatistics: statistics,
      playerMappings: mappings,
      suppressedServers: suppressed,
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
    expect(servers.bulkWrite).not.toHaveBeenCalled();
    expect(users.bulkWrite).not.toHaveBeenCalled();
    expect(statistics.bulkWrite).not.toHaveBeenCalled();
    expect(logMock).toHaveBeenCalledWith('MongoDB connected: rw-manager-test');

    await expect(mongodb.bootstrapMongoDb()).resolves.toBe(collections);
    expect(collectionMock).toHaveBeenCalledTimes(5);
  });

  test('closes failed clients without entering a JSON fallback path', async () => {
    process.env.MONGO_URI = 'mongodb://fallback-var';
    process.env.MONGODB_CONNECT_TIMEOUT_MS = '1234';
    const servers = collection('servers', 1);
    const users = collection('users', 1);
    const statistics = collection('server_statistics', 1);
    const mappings = collection('player_mappings');
    const suppressed = collection('suppressed_servers');
    collectionMock
      .mockReturnValueOnce(servers)
      .mockReturnValueOnce(users)
      .mockReturnValueOnce(statistics)
      .mockReturnValueOnce(mappings)
      .mockReturnValueOnce(suppressed);

    await expect(mongodb.bootstrapMongoDb()).resolves.toBeDefined();
    expect(mongoClientConstructorMock).toHaveBeenCalledWith('mongodb://fallback-var', {
      serverSelectionTimeoutMS: 1234,
      connectTimeoutMS: 1234,
    });
    await mongodb.closeMongoDb();
    expect(closeMock).toHaveBeenCalled();

    connectMock.mockRejectedValueOnce(new Error('offline'));
    await expect(mongodb.bootstrapMongoDb()).resolves.toBeUndefined();
    expect(warnMock).toHaveBeenCalledWith(
      'MongoDB unavailable: offline',
    );
  });

  test('imports, verifies, marks and archives a legacy file only in storage mode', async () => {
    const dataRoot = await mkdtemp(path.join(tmpdir(), 'rw-manager-migration-'));
    process.env.ENABLE_STORAGE = 'true';
    process.env.MONGODB_URI = 'mongodb://example';
    process.env.APP_DATA_ROOT = dataRoot;
    await writeFile(path.join(dataRoot, 'data.json'), JSON.stringify(jsonState));
    const servers = collection('servers');
    const users = collection('users');
    const statistics = collection('server_statistics');
    const mappings = collection('player_mappings');
    const suppressed = collection('suppressed_servers');
    const migrations = { findOne: jest.fn(async () => null), insertOne: jest.fn(async () => undefined) };
    collectionMock
      .mockReturnValueOnce(servers)
      .mockReturnValueOnce(users)
      .mockReturnValueOnce(statistics)
      .mockReturnValueOnce(mappings)
      .mockReturnValueOnce(suppressed)
      .mockReturnValueOnce(migrations);

    try {
      await expect(mongodb.bootstrapMongoDb()).resolves.toBeDefined();
      expect(servers.bulkWrite).toHaveBeenCalledWith([expect.objectContaining({
        updateOne: expect.objectContaining({ filter: { id: 'server-1' }, upsert: true, update: { $setOnInsert: expect.objectContaining({ id: 'server-1' }) } }),
      })]);
      expect(users.bulkWrite).toHaveBeenCalledTimes(1);
      expect(statistics.bulkWrite).toHaveBeenCalledTimes(1);
      expect(migrations.insertOne).toHaveBeenCalledWith(expect.objectContaining({
        id: 'lowdb-to-mongo-v1',
        counts: { servers: 1, users: 1, serverStatistics: 1 },
      }));
      await expect(access(path.join(dataRoot, 'data.json.bak'))).resolves.toBeUndefined();
      await expect(access(path.join(dataRoot, 'data.json'))).rejects.toThrow();

      await mongodb.closeMongoDb();
      collectionMock.mockClear().mockImplementation((name: string) => ({
        servers,
        users,
        server_statistics: statistics,
        player_mappings: mappings,
        suppressed_servers: suppressed,
        migrations,
      })[name]);
      await expect(mongodb.bootstrapMongoDb()).resolves.toBeDefined();
      expect(servers.bulkWrite).toHaveBeenCalledTimes(1);
      expect(users.bulkWrite).toHaveBeenCalledTimes(1);
      expect(statistics.bulkWrite).toHaveBeenCalledTimes(1);
      expect(migrations.insertOne).toHaveBeenCalledTimes(1);
    } finally {
      await rm(dataRoot, { recursive: true, force: true });
    }
  });

  test('preserves existing Mongo documents while importing only missing legacy records', async () => {
    const dataRoot = await mkdtemp(path.join(tmpdir(), 'rw-manager-migration-existing-'));
    process.env.ENABLE_STORAGE = 'true';
    process.env.MONGODB_URI = 'mongodb://example';
    process.env.APP_DATA_ROOT = dataRoot;
    await writeFile(path.join(dataRoot, 'data.json'), JSON.stringify(jsonState));
    const servers = collection('servers', 0, [{ ...jsonState.servers![0], label: 'Current Mongo server' }]);
    const users = collection('users', 0, [{ ...jsonState.users![0], username: 'current-user' }]);
    const statistics = collection('server_statistics', 0, [{ ...jsonState.serverStatistics![0], sampleCount: 99, onlineSampleCount: 99, playerSampleTotal: 99, maxPlayers: 99 }]);
    const mappings = collection('player_mappings');
    const suppressed = collection('suppressed_servers');
    const migrations = { findOne: jest.fn(async () => null), insertOne: jest.fn(async () => undefined) };
    collectionMock
      .mockReturnValueOnce(servers)
      .mockReturnValueOnce(users)
      .mockReturnValueOnce(statistics)
      .mockReturnValueOnce(mappings)
      .mockReturnValueOnce(suppressed)
      .mockReturnValueOnce(migrations);

    try {
      await expect(mongodb.bootstrapMongoDb()).resolves.toBeDefined();
      await expect(servers.find().toArray()).resolves.toContainEqual(expect.objectContaining({ label: 'Current Mongo server' }));
      await expect(users.find().toArray()).resolves.toContainEqual(expect.objectContaining({ username: 'current-user' }));
      await expect(statistics.find().toArray()).resolves.toContainEqual(expect.objectContaining({ sampleCount: 99 }));
      expect(migrations.insertOne).toHaveBeenCalled();
      await expect(access(path.join(dataRoot, 'data.json.bak'))).resolves.toBeUndefined();
    } finally {
      await rm(dataRoot, { recursive: true, force: true });
    }
  });

  test('player reference migration resumes without name or slot matching', async () => {
    const server = { _id: 'server-document', id: 'server-1', lastChecked: '2026-06-25T01:00:00.000Z',
      knownPlayers: [{ id: 1, uid: 'uid-a', name: 'Same', lastseen: 100 }, { id: 7, uid: '7', name: 'Slot' }],
      onlinePlayers: [{ id: 2, uid: 'uid-b', name: 'Same' }, { id: 3, name: 'Same' }] };
    const bucket = { _id: 'bucket-document', hourStart: '2026-06-25T02:00:00.000Z', onlinePlayerUids: ['uid-a', 'uid-b'] };
    const mappings = new Map<string, { _id: { toHexString: () => string }; uid: string; globalLastSeen?: Date }>();
    const serverUpdate = jest.fn(async (_filter: unknown, update: { $set: Record<string, unknown> }) => Object.assign(server, update.$set));
    const bucketBulkWrite = jest.fn(async (operations: Array<{ updateOne: { update: { $set: Record<string, unknown> } } }>) => {
      for (const operation of operations) Object.assign(bucket, operation.updateOne.update.$set);
    });
    const mappingUpdate = jest.fn(async (filter: { uid: string }, update: { $setOnInsert?: { uid: string }; $max?: { globalLastSeen: Date } }) => {
      const existing = mappings.get(filter.uid);
      if (!existing && update.$setOnInsert) mappings.set(filter.uid, { _id: { toHexString: () => filter.uid === 'uid-a'
        ? 'aaaaaaaaaaaaaaaaaaaaaaaa' : 'bbbbbbbbbbbbbbbbbbbbbbbb' }, uid: filter.uid });
      if (update.$max) mappings.get(filter.uid)!.globalLastSeen = update.$max.globalLastSeen;
    });
    const next = {
      servers: { find: () => ({ async *[Symbol.asyncIterator]() { yield server; } }), updateOne: serverUpdate },
      serverStatistics: { find: () => ({ async *[Symbol.asyncIterator]() { yield bucket; } }), bulkWrite: bucketBulkWrite },
      playerMappings: { updateOne: mappingUpdate, bulkWrite: async (operations: Array<{ updateOne: { filter: { uid: string }; update: { $setOnInsert?: { uid: string }; $max?: { globalLastSeen: Date } } } }>) => {
        for (const operation of operations) await mappingUpdate(operation.updateOne.filter, operation.updateOne.update);
      }, find: (filter: { uid: { $in: string[] } }) => ({
        toArray: async () => filter.uid.$in.flatMap((uid) => mappings.has(uid) ? [mappings.get(uid)!] : []),
      }) },
    };
    await mongodb.migratePlayerReferences(next as never);
    await mongodb.migratePlayerReferences(next as never);
    expect([...mappings.keys()].sort()).toEqual(['uid-a', 'uid-b']);
    expect(mappings.get('uid-b')?.globalLastSeen).toEqual(new Date('2026-06-25T02:00:00.000Z'));
    expect(server.knownPlayers[0]).toMatchObject({ playerMappingId: 'aaaaaaaaaaaaaaaaaaaaaaaa' });
    expect(server.knownPlayers[1]).not.toHaveProperty('playerMappingId');
    expect(server.onlinePlayers[0]).toMatchObject({ playerMappingId: 'bbbbbbbbbbbbbbbbbbbbbbbb' });
    expect(server.onlinePlayers[1]).not.toHaveProperty('playerMappingId');
    expect(bucket).toMatchObject({ onlinePlayerIds: ['aaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbbb'] });
    expect(bucketBulkWrite).toHaveBeenCalledTimes(1);
  });
});
