import { jest } from '@jest/globals';

const updateOne = jest.fn(async (..._args: unknown[]) => undefined);
jest.unstable_mockModule('../src/db/mongodb.js', () => ({
  getMongoCollections: () => ({ playerMappings: { updateOne } }),
}));
const { observePlayers, stableUid } = await import('../src/service/player-identity-service.js');

beforeEach(() => updateOne.mockClear());

test('only plugin-exported player records create a mapping', async () => {
  const at = new Date('2026-11-16T00:00:00Z');
  await observePlayers([{ uid: '76561198000000001', name: 'Ada' }, { id: 3 }, null], at);
  expect(updateOne).toHaveBeenCalledTimes(1);
  expect(updateOne).toHaveBeenCalledWith({ uid: '76561198000000001' }, {
    $setOnInsert: { uid: '76561198000000001' },
    $max: { globalLastSeen: at },
    $set: { name: 'Ada' },
  }, { upsert: true });
});

test('private markers are never treated as stable player IDs', () => {
  expect(stableUid('**PRIVATE**')).toBeUndefined();
  expect(stableUid('  player  ')).toBe('player');
});
