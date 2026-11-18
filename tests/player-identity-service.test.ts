import { jest } from '@jest/globals';
import { ObjectId } from 'mongodb';

const updateOne = jest.fn(async (..._args: unknown[]) => undefined);
const ada = { uid: 'ada', _id: new ObjectId() };
const toArray = jest.fn(async () => [ada]);
const find = jest.fn((_filter: unknown) => ({ toArray }));
const findOne = jest.fn(async (_filter: unknown) => ada);
const collections = { playerMappings: { updateOne, find, findOne } };
const getMongoCollections = jest.fn((): typeof collections | undefined => collections);
jest.unstable_mockModule('../src/db/mongodb.js', () => ({
  getMongoCollections,
}));
const { attachPlayerReferences, mappingByUids, mappingForId, observePlayers, stableUid }
  = await import('../src/service/player-identity-service.js');

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
  expect(stableUid('   ')).toBeUndefined();
  expect(stableUid(47)).toBeUndefined();
});

test('maps aliases from plugin payloads and excludes local IDs, obfuscated IDs and names alone', async () => {
  const at = new Date();
  await observePlayers([{ UID: 'ada', Name: ' Ada ' }, { uid: '3', id: 3 },
    { uid: '**PRIVATE**', name: 'Private' }, { uid: 'nameless', name: '   ' }, 'names only'], at);
  expect(updateOne).toHaveBeenCalledTimes(2);
  expect(updateOne).toHaveBeenNthCalledWith(1, { uid: 'ada' }, expect.objectContaining({ $set: { name: 'Ada' } }), { upsert: true });
  expect(updateOne).toHaveBeenNthCalledWith(2, { uid: 'nameless' }, {
    $setOnInsert: { uid: 'nameless' }, $max: { globalLastSeen: at },
  }, { upsert: true });
});

test('attaches one stable reference across snapshots without inventing IDs for name-only players', async () => {
  const source = { knownPlayers: [{ uid: 'ada' }], onlinePlayers: [null, { name: 'Name only' },
    { UID: 'ada', Name: 'Ada' }, { uid: 'bob', name: 'Bob' }, { uid: '4', id: 4 }] };
  const id = ada._id.toHexString();
  await expect(attachPlayerReferences(source)).resolves.toEqual({
    knownPlayers: [{ uid: 'ada', playerMappingId: id }],
    onlinePlayers: [null, { name: 'Name only' }, { UID: 'ada', Name: 'Ada', playerMappingId: id },
      { uid: 'bob', name: 'Bob' }, { uid: '4', id: 4 }],
  });
  expect(find).toHaveBeenLastCalledWith({ uid: { $in: ['ada', 'bob'] } });
  expect(source.knownPlayers).toEqual([{ uid: 'ada' }]);
  await expect(attachPlayerReferences({})).resolves.toEqual({ knownPlayers: [], onlinePlayers: [] });
  await expect(mappingForId('ada')).resolves.toBeNull();
  await expect(mappingForId(id)).resolves.toEqual(ada);
  expect(findOne).toHaveBeenCalledWith({ _id: ada._id });
});

test('with storage unavailable returns the original snapshot and performs no upserts', async () => {
  getMongoCollections.mockReturnValueOnce(undefined).mockReturnValueOnce(undefined)
    .mockReturnValueOnce(undefined).mockReturnValueOnce(undefined);
  const snapshot = { knownPlayers: [{ uid: 'ada' }] };
  await expect(attachPlayerReferences(snapshot)).resolves.toBe(snapshot);
  await observePlayers(snapshot.knownPlayers, new Date());
  await expect(mappingByUids(['ada'])).resolves.toEqual(new Map());
  await expect(mappingForId(ada._id.toHexString())).resolves.toBeNull();
  expect(updateOne).not.toHaveBeenCalled();
});
