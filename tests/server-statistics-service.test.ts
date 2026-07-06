import { jest } from '@jest/globals';

const findServerByIdMock = jest.fn();
const listServerStatisticsBucketsMock = jest.fn();
const listGlobalStatisticsBucketsMock = jest.fn();
const getCachedServerPlayersMock = jest.fn();

jest.unstable_mockModule('../src/db/manager-store.js', () => ({
  findServerById: findServerByIdMock,
}));
jest.unstable_mockModule('../src/db/server-statistics-store.js', () => ({
  listServerStatisticsBuckets: listServerStatisticsBucketsMock,
  listGlobalStatisticsBuckets: listGlobalStatisticsBucketsMock,
}));
jest.unstable_mockModule('../src/service/server-plugin-data-service.js', () => ({
  getCachedServerPlayers: getCachedServerPlayersMock,
}));

const { getGlobalStatistics, getServerStatistics } = await import('../src/service/server-statistics-service.js');

describe('server statistics service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    findServerByIdMock.mockImplementation((serverId: string) => Promise.resolve({ id: serverId }));
    listServerStatisticsBucketsMock.mockResolvedValue([]);
    listGlobalStatisticsBucketsMock.mockResolvedValue([]);
    getCachedServerPlayersMock.mockReturnValue([]);
  });

  test('enriches global statistic player uids with names from cached backend player data', async () => {
    listGlobalStatisticsBucketsMock.mockResolvedValue([
      bucket('server-1', ['uid-2', 'uid-1']),
      bucket('server-2', ['uid-3', 'uid-2']),
    ]);
    getCachedServerPlayersMock.mockImplementation((serverId: string) => {
      if (serverId === 'server-1') return [{ uid: 'uid-1', name: 'Alice' }];
      if (serverId === 'server-2') return [{ uid: 'uid-3', name: 'Zed' }];
      return [];
    });

    await expect(getGlobalStatistics({})).resolves.toMatchObject({
      players: [
        { uid: 'uid-1', name: 'Alice' },
        { uid: 'uid-2' },
        { uid: 'uid-3', name: 'Zed' },
      ],
    });
    expect(getCachedServerPlayersMock).toHaveBeenCalledWith('server-1');
    expect(getCachedServerPlayersMock).toHaveBeenCalledWith('server-2');
  });

  test('enriches global statistic player names from observed server players', async () => {
    listGlobalStatisticsBucketsMock.mockResolvedValue([
      bucket('server-1', ['standalone-player']),
    ]);
    findServerByIdMock.mockResolvedValue({
      id: 'server-1',
      knownPlayers: [{ uid: 'standalone-player', name: 'Observed Alice' }],
    });

    await expect(getGlobalStatistics({})).resolves.toMatchObject({
      players: [{ uid: 'standalone-player', name: 'Observed Alice' }],
    });
  });

  test('validates server existence and date ranges', async () => {
    await expect(getServerStatistics({
      serverId: 'server-1',
      from: '2026-06-01T00:00:00.000Z',
      to: '2026-06-02T00:00:00.000Z',
    })).resolves.toEqual({
      serverId: 'server-1',
      from: '2026-06-01T00:00:00.000Z',
      to: '2026-06-02T00:00:00.000Z',
      buckets: [],
    });

    findServerByIdMock.mockResolvedValueOnce(undefined);
    await expect(getServerStatistics({ serverId: 'missing' })).rejects.toThrow('SERVER_NOT_FOUND');
    await expect(getGlobalStatistics({
      from: '2026-06-02T00:00:00.000Z',
      to: '2026-06-01T00:00:00.000Z',
    })).rejects.toThrow('DATE_RANGE_INVALID');
    await expect(getServerStatistics({
      serverId: 'server-1',
      from: '',
    })).rejects.toThrow('FROM_INVALID');
    await expect(getGlobalStatistics({
      to: 42,
    })).rejects.toThrow('TO_INVALID');
    await expect(getGlobalStatistics({
      from: 'not-a-date',
    })).rejects.toThrow('FROM_INVALID');
  });
});

function bucket(serverId: string, onlinePlayerUids: string[]) {
  return {
    id: `${serverId}:2026-06-25T12:00:00.000Z`,
    serverId,
    hourStart: '2026-06-25T12:00:00.000Z',
    sampleCount: 1,
    onlineSampleCount: 1,
    playerSampleTotal: onlinePlayerUids.length,
    maxPlayers: onlinePlayerUids.length,
    averagePlayers: onlinePlayerUids.length,
    availability: 100,
    onlinePlayerUids,
    updatedAt: '2026-06-25T12:10:00.000Z',
  };
}
