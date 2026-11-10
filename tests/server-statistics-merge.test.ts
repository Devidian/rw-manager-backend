import { mergeServerStatisticsBuckets } from '../src/service/server-statistics-merge.js';
import type { ServerStatisticsBucket } from '../src/interfaces/server-statistics.js';

function bucket(serverId: string, values: Partial<ServerStatisticsBucket>): ServerStatisticsBucket {
  return {
    id: `${serverId}:2026-11-10T08:00:00.000Z`, serverId, hourStart: '2026-11-10T08:00:00.000Z',
    sampleCount: 1, onlineSampleCount: 0, playerSampleTotal: 0, maxPlayers: 0,
    averagePlayers: 0, availability: 0, onlinePlayerUids: [], updatedAt: '2026-11-10T08:30:00.000Z',
    ...values,
  };
}

test('prefers online evidence over numerous offline polls and retains player observations', () => {
  const merged = mergeServerStatisticsBuckets('old', [
    bucket('old', { sampleCount: 8, updatedAt: '2026-11-10T08:55:00.000Z' }),
    bucket('new', { onlineSampleCount: 1, playerSampleTotal: 2, maxPlayers: 2, onlinePlayerUids: ['alice'] }),
    bucket('other', { onlineSampleCount: 1, playerSampleTotal: 1, maxPlayers: 1, onlinePlayerUids: ['bob'] }),
  ]);
  expect(merged).toEqual([expect.objectContaining({
    id: 'old:2026-11-10T08:00:00.000Z', serverId: 'old', sampleCount: 1,
    onlineSampleCount: 1, availability: 100, maxPlayers: 2, averagePlayers: 2,
    onlinePlayerUids: ['alice', 'bob'],
  })]);
});

test('uses player evidence and then freshness when availability ties', () => {
  const merged = mergeServerStatisticsBuckets('old', [
    bucket('older', { onlineSampleCount: 1, updatedAt: '2026-11-10T08:20:00.000Z' }),
    bucket('with-player', { onlineSampleCount: 1, maxPlayers: 2, playerSampleTotal: 2 }),
    bucket('later', { onlineSampleCount: 1, maxPlayers: 2, playerSampleTotal: 2, updatedAt: '2026-11-10T08:45:00.000Z' }),
  ]);
  expect(merged[0].updatedAt).toBe('2026-11-10T08:45:00.000Z');
  expect(merged[0].maxPlayers).toBe(2);
});

test('keeps zero-sample legacy hours without dividing by zero', () => {
  const merged = mergeServerStatisticsBuckets('old', [
    bucket('new', { sampleCount: 0, updatedAt: '2026-11-10T08:20:00.000Z' }),
  ]);
  expect(merged[0]).toMatchObject({ sampleCount: 0, averagePlayers: 0, availability: 0 });
});
