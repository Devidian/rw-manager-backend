import { jest } from '@jest/globals';

const state = {
  serverStatistics: undefined as unknown,
};
const writeMock = jest.fn<() => Promise<void>>().mockResolvedValue();
const getMongoCollectionsMock = jest.fn();

jest.unstable_mockModule('../src/db/json.js', () => ({
  db: {
    data: state,
    write: writeMock,
  },
}));

jest.unstable_mockModule('../src/db/mongodb.js', () => ({
  getMongoCollections: getMongoCollectionsMock,
}));

const store = await import('../src/db/server-statistics-store.js');

describe('server-statistics-store', () => {
  beforeEach(() => {
    state.serverStatistics = [];
    writeMock.mockClear();
    getMongoCollectionsMock.mockReset().mockReturnValue(undefined);
  });

  test('records and lists hourly JSON fallback buckets', async () => {
    await expect(
      store.recordServerStatisticsSample({
        serverId: 'server-1',
        sampledAt: new Date('2026-06-25T12:34:56.000Z'),
        online: true,
        playerCount: 2.8,
        onlinePlayerUids: [' player-1 ', 'player-1', '', 'player-2'],
      }),
    ).resolves.toMatchObject({
      id: 'server-1:2026-06-25T12:00:00.000Z',
      serverId: 'server-1',
      hourStart: '2026-06-25T12:00:00.000Z',
      sampleCount: 1,
      onlineSampleCount: 1,
      playerSampleTotal: 2,
      maxPlayers: 2,
      averagePlayers: 2,
      availability: 100,
      onlinePlayerUids: ['player-1', 'player-2'],
    });

    await store.recordServerStatisticsSample({
      serverId: 'server-1',
      sampledAt: new Date('2026-06-25T12:55:00.000Z'),
      online: false,
      playerCount: -1,
      onlinePlayerUids: ['player-2', 'player-3'],
    });
    await store.recordServerStatisticsSample({
      serverId: 'server-2',
      sampledAt: new Date('2026-06-25T12:30:00.000Z'),
      online: true,
      playerCount: 9,
    });

    await expect(
      store.listServerStatisticsBuckets({
        serverId: 'server-1',
        from: new Date('2026-06-25T12:00:00.000Z'),
        to: new Date('2026-06-25T13:00:00.000Z'),
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        serverId: 'server-1',
        sampleCount: 2,
        onlineSampleCount: 1,
        playerSampleTotal: 2,
        maxPlayers: 2,
        averagePlayers: 1,
        availability: 50,
        onlinePlayerUids: ['player-1', 'player-2', 'player-3'],
      }),
    ]);
    expect(writeMock).toHaveBeenCalledTimes(3);
  });

  test('initializes missing JSON statistics arrays and filters ranges', async () => {
    state.serverStatistics = undefined;
    await store.recordServerStatisticsSample({
      serverId: 'server-1',
      sampledAt: new Date('2026-06-25T10:00:00.000Z'),
      online: true,
      playerCount: 1,
    });
    await store.recordServerStatisticsSample({
      serverId: 'server-1',
      sampledAt: new Date('2026-06-25T11:00:00.000Z'),
      online: true,
      playerCount: 3,
    });
    await expect(
      store.listServerStatisticsBuckets({
        serverId: 'server-1',
        from: new Date('2026-06-25T10:30:00.000Z'),
      }),
    ).resolves.toEqual([
      expect.objectContaining({ hourStart: '2026-06-25T11:00:00.000Z' }),
    ]);
  });

  test('uses Mongo update and query paths', async () => {
    const mongoBucket = {
      _id: 'mongo-id',
      id: 'server-1:2026-06-25T12:00:00.000Z',
      serverId: 'server-1',
      hourStart: '2026-06-25T12:00:00.000Z',
      sampleCount: 4,
      onlineSampleCount: 3,
        playerSampleTotal: 10,
        maxPlayers: 5,
        onlinePlayerUids: undefined,
        updatedAt: '2026-06-25T12:10:00.000Z',
    };
    const sortMock = jest.fn().mockReturnValue({
      toArray: jest.fn(async () => [mongoBucket]),
    });
    const collections = {
      serverStatistics: {
        updateOne: jest.fn(async () => undefined),
        findOne: jest.fn(async () => mongoBucket),
        find: jest.fn().mockReturnValue({ sort: sortMock }),
      },
    };
    getMongoCollectionsMock.mockReturnValue(collections);

    await expect(
      store.recordServerStatisticsSample({
        serverId: 'server-1',
        sampledAt: new Date('2026-06-25T12:10:00.000Z'),
        online: true,
        playerCount: 4,
        onlinePlayerUids: ['player-9', 'player-9'],
      }),
    ).resolves.toMatchObject({
      averagePlayers: 2.5,
      availability: 75,
      onlinePlayerUids: [],
    });

    await expect(
      store.listServerStatisticsBuckets({
        serverId: 'server-1',
        from: new Date('2026-06-25T12:00:00.000Z'),
        to: new Date('2026-06-25T13:00:00.000Z'),
      }),
    ).resolves.toEqual([
      expect.not.objectContaining({ _id: expect.anything() }),
    ]);

    expect(collections.serverStatistics.updateOne).toHaveBeenCalledWith(
      { id: 'server-1:2026-06-25T12:00:00.000Z' },
      expect.objectContaining({
        $setOnInsert: {
          id: 'server-1:2026-06-25T12:00:00.000Z',
          serverId: 'server-1',
          hourStart: '2026-06-25T12:00:00.000Z',
        },
        $inc: expect.objectContaining({ sampleCount: 1 }),
        $max: { maxPlayers: 4 },
        $addToSet: { onlinePlayerUids: { $each: ['player-9'] } },
      }),
      { upsert: true },
    );
    const update = collections.serverStatistics.updateOne.mock.calls[0][1] as {
      $setOnInsert?: Record<string, unknown>;
      $inc?: Record<string, unknown>;
      $max?: Record<string, unknown>;
    };
    const insertedPaths = Object.keys(update.$setOnInsert ?? {});
    const incrementedPaths = Object.keys(update.$inc ?? {});
    const maxPaths = Object.keys(update.$max ?? {});
    expect(insertedPaths).not.toContainEqual(expect.stringMatching(/sampleCount|playerSampleTotal|maxPlayers/));
    expect(insertedPaths.filter((path) => incrementedPaths.includes(path) || maxPaths.includes(path))).toEqual([]);
    expect(collections.serverStatistics.find).toHaveBeenCalledWith(
      {
        serverId: 'server-1',
        hourStart: {
          $gte: '2026-06-25T12:00:00.000Z',
          $lt: '2026-06-25T13:00:00.000Z',
        },
      },
      { projection: { _id: 0 } },
    );
  });

  test('uses Mongo global query path without date filters', async () => {
    const mongoBucket = {
      _id: 'mongo-id',
      id: 'server-1:2026-06-25T12:00:00.000Z',
      serverId: 'server-1',
      hourStart: '2026-06-25T12:00:00.000Z',
      sampleCount: 0,
      onlineSampleCount: 0,
      playerSampleTotal: 0,
      maxPlayers: 0,
      onlinePlayerUids: ['player-1', 'player-1'],
      updatedAt: '2026-06-25T12:10:00.000Z',
    };
    const toArrayMock = jest.fn(async () => [mongoBucket]);
    const sortMock = jest.fn().mockReturnValue({ toArray: toArrayMock });
    const collections = {
      serverStatistics: {
        find: jest.fn().mockReturnValue({ sort: sortMock }),
      },
    };
    getMongoCollectionsMock.mockReturnValue(collections);

    await expect(store.listGlobalStatisticsBuckets({})).resolves.toEqual([
      {
        id: 'server-1:2026-06-25T12:00:00.000Z',
        serverId: 'server-1',
        hourStart: '2026-06-25T12:00:00.000Z',
        sampleCount: 0,
        onlineSampleCount: 0,
        playerSampleTotal: 0,
        maxPlayers: 0,
        averagePlayers: 0,
        availability: 0,
        onlinePlayerUids: ['player-1'],
        updatedAt: '2026-06-25T12:10:00.000Z',
      },
    ]);
    expect(collections.serverStatistics.find).toHaveBeenCalledWith({}, { projection: { _id: 0 } });
    expect(sortMock).toHaveBeenCalledWith({ hourStart: 1, serverId: 1 });
  });

  test('lists global buckets sorted by hour and server with player union', async () => {
    await store.recordServerStatisticsSample({
      serverId: 'server-b',
      sampledAt: new Date('2026-06-25T12:10:00.000Z'),
      online: true,
      playerCount: 1,
      onlinePlayerUids: ['b'],
    });
    await store.recordServerStatisticsSample({
      serverId: 'server-a',
      sampledAt: new Date('2026-06-25T12:20:00.000Z'),
      online: true,
      playerCount: 2,
      onlinePlayerUids: ['a'],
    });
    await store.recordServerStatisticsSample({
      serverId: 'server-a',
      sampledAt: new Date('2026-06-25T13:00:00.000Z'),
      online: true,
      playerCount: 3,
      onlinePlayerUids: ['c'],
    });

    await expect(store.listGlobalStatisticsBuckets({
      from: new Date('2026-06-25T12:00:00.000Z'),
      to: new Date('2026-06-25T13:00:00.000Z'),
    })).resolves.toMatchObject([
      { serverId: 'server-a', onlinePlayerUids: ['a'] },
      { serverId: 'server-b', onlinePlayerUids: ['b'] },
    ]);
  });
});
