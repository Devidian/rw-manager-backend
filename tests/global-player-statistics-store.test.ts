import { jest } from '@jest/globals';

const getMongoCollections = jest.fn();
jest.unstable_mockModule('../src/db/mongodb.js', () => ({ getMongoCollections }));

const { recordGlobalPlayerSample, listGlobalPlayerBuckets } = await import('../src/db/global-player-statistics-store.js');

test('derives UTC-hour statistics from real samples and preserves a confirmed zero', async () => {
  const first = new Date('2026-11-27T23:00:00Z');
  const next = new Date('2026-11-28T00:00:00Z');
  await recordGlobalPlayerSample(first, 0);
  await recordGlobalPlayerSample(new Date('2026-11-27T23:20:00Z'), 7);
  await recordGlobalPlayerSample(new Date('2026-11-27T23:20:00Z'), 100);
  await recordGlobalPlayerSample(new Date('2026-11-27T23:50:00Z'), 2);
  await recordGlobalPlayerSample(next, 10);

  await expect(listGlobalPlayerBuckets(first, next)).resolves.toEqual([
    { hourStart: first.toISOString(), sampleCount: 3, minPlayers: 0, maxPlayers: 7, averagePlayers: 3 },
  ]);
  await expect(listGlobalPlayerBuckets(undefined, first)).resolves.toEqual([]);
});

test('writes only anonymous samples and derives the response from the MongoDB hour', async () => {
  const at = new Date('2026-11-27T17:30:00Z');
  const hourStart = '2026-11-27T17:00:00.000Z';
  const sample = { sampledAt: at.toISOString(), playerCount: 6 };
  const updateOne = jest.fn(async () => undefined);
  const toArray = jest.fn(async () => [{ hourStart, samples: [sample] }]);
  getMongoCollections.mockReturnValue({
    globalPlayerStatistics: { updateOne, find: () => ({ sort: () => ({ toArray }) }) },
  });
  try {
    await recordGlobalPlayerSample(at, 6);
    expect(updateOne).toHaveBeenCalledWith({ hourStart }, [{ $set: {
      hourStart,
      samples: { $cond: [
        { $in: [sample.sampledAt, { $ifNull: ['$samples.sampledAt', []] }] },
        '$samples',
        { $concatArrays: [{ $ifNull: ['$samples', []] }, [sample]] },
      ] },
    } }], { upsert: true });
    await expect(listGlobalPlayerBuckets()).resolves.toEqual([
      { hourStart, sampleCount: 1, minPlayers: 6, maxPlayers: 6, averagePlayers: 6 },
    ]);
  } finally {
    getMongoCollections.mockReset();
  }
});
