import { jest } from '@jest/globals';

const listServers = jest.fn<() => Promise<Array<{ knownPlayers?: Array<{ uid: string }> }>>>();
const deleteOne = jest.fn(async () => ({ deletedCount: 1 }));
const forgetPlayerStatistics = jest.fn<() => Promise<void>>().mockResolvedValue();
jest.unstable_mockModule('../src/db/manager-store.js', () => ({ listServers }));
jest.unstable_mockModule('../src/db/mongodb.js', () => ({
  getMongoCollections: () => ({ playerMappings: { deleteOne } }),
}));
jest.unstable_mockModule('../src/db/server-statistics-store.js', () => ({ forgetPlayerStatistics }));
jest.unstable_mockModule('../src/service/player-identity-service.js', () => ({
  mappingByUids: async () => new Map([['steam-uid', { _id: { toHexString: () => 'aaaaaaaaaaaaaaaaaaaaaaaa' } }]]),
}));
const { forgetPlayerFromServer } = await import('../src/service/forgotten-player-service.js');

beforeEach(() => {
  jest.clearAllMocks();
  listServers.mockResolvedValue([]);
});

test('removes statistics references and the last global mapping after consent withdrawal', async () => {
  await forgetPlayerFromServer('server-a', 'steam-uid');
  expect(forgetPlayerStatistics).toHaveBeenCalledWith('server-a', 'steam-uid', 'aaaaaaaaaaaaaaaaaaaaaaaa');
  expect(deleteOne).toHaveBeenCalledWith({ uid: 'steam-uid' });
});

test('keeps the shared mapping while another consenting server exports the player', async () => {
  listServers.mockResolvedValue([{ knownPlayers: [{ uid: 'steam-uid' }] }]);
  await forgetPlayerFromServer('server-a', 'steam-uid');
  expect(forgetPlayerStatistics).toHaveBeenCalledWith('server-a', 'steam-uid', 'aaaaaaaaaaaaaaaaaaaaaaaa');
  expect(deleteOne).not.toHaveBeenCalled();
});
