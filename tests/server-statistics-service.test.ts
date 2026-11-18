import { jest } from '@jest/globals';

const findServerByIdMock = jest.fn();
const listServerStatisticsBucketsMock = jest.fn();
const listGlobalStatisticsBucketsMock = jest.fn();

jest.unstable_mockModule('../src/db/manager-store.js', () => ({
  findServerById: findServerByIdMock,
}));
jest.unstable_mockModule('../src/db/server-statistics-store.js', () => ({
  listServerStatisticsBuckets: listServerStatisticsBucketsMock,
  listGlobalStatisticsBuckets: listGlobalStatisticsBucketsMock,
}));

const { getGlobalStatistics, getServerStatistics } = await import('../src/service/server-statistics-service.js');

describe('server statistics service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    findServerByIdMock.mockImplementation((serverId: string) => Promise.resolve({ id: serverId }));
    listServerStatisticsBucketsMock.mockResolvedValue([]);
    listGlobalStatisticsBucketsMock.mockResolvedValue([]);
  });

  test('global statistics contain aggregate data without player lists', async () => {
    listGlobalStatisticsBucketsMock.mockResolvedValue([
      bucket('server-1', ['uid-2', 'uid-1']),
      bucket('server-2', ['uid-3', 'uid-2']),
    ]);
    const result = await getGlobalStatistics({});
    expect(result).not.toHaveProperty('players');
    expect(result.buckets).toHaveLength(2);
    expect(result.buckets[0]).not.toHaveProperty('onlinePlayerUids');
  });

  test('server statistics reveal player references only to exported server members', async () => {
    listServerStatisticsBucketsMock.mockResolvedValue([
      bucket('server-1', ['standalone-player']),
    ]);
    findServerByIdMock.mockResolvedValue({
      id: 'server-1',
      knownPlayers: [{ uid: 'standalone-player', name: 'Observed Alice' }],
    });

    const guest = await getServerStatistics({ serverId: 'server-1' });
    expect(guest.buckets[0].onlinePlayerUids).toEqual([]);
    const member = await getServerStatistics({ serverId: 'server-1', viewerUid: 'standalone-player' });
    expect(member.buckets[0].onlinePlayerUids).toEqual(['standalone-player']);
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

  test('loads an alias history through the canonical server ID', async () => {
    findServerByIdMock.mockResolvedValueOnce({ id: 'canonical', alternateIds: ['old'] });
    await expect(getServerStatistics({ serverId: 'old' })).resolves.toMatchObject({ serverId: 'canonical' });
    expect(listServerStatisticsBucketsMock).toHaveBeenCalledWith({ serverId: 'canonical', from: undefined, to: undefined });
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
