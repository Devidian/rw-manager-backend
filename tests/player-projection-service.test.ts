import { jest } from '@jest/globals';

const servers = [
  { id: 'own', info: { contact: '76561198000000999' }, knownPlayers: [
    { id: 4, uid: '76561198000000001', name: 'Alice' },
  ] },
  { id: 'foreign', knownPlayers: [
    { id: 8, uid: '76561198000000001', name: 'Alice' },
    { id: 9, uid: '76561198000000002', name: 'Bob' },
  ] },
];
jest.unstable_mockModule('../src/service/player-identity-service.js', () => ({
  stableUid: (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : undefined,
}));
jest.unstable_mockModule('../src/db/manager-store.js', () => ({
  findServerById: jest.fn(async (id: string) => servers.find((server) => server.id === id)),
  listServers: jest.fn(async () => servers),
}));
jest.unstable_mockModule('../src/service/plugin-data-cache-service.js', () => ({
  getCachedPluginData: jest.fn(() => undefined),
}));
jest.unstable_mockModule('../src/service/native-admin-utils-info.js', () => ({
  parseNativeAdminUtilsInfo: jest.fn(() => undefined),
}));
jest.unstable_mockModule('../src/service/public-steam-id-service.js', () => ({
  maskPublicSteamIds: (value: unknown) => value,
}));

const { projectPlayerData } = await import('../src/service/player-projection-service.js');

test('guests receive server DBIDs without UIDs or database players', async () => {
  const output = await projectPlayerData({
    onlinePlayers: [{ dbId: 8, uid: '76561198000000001', name: 'Alice' }],
    knownPlayers: servers[1].knownPlayers,
  }, { serverId: 'foreign', guest: true }) as Record<string, unknown>;
  expect(output.onlinePlayers).toEqual([{ id: 'foreign:8', dbId: 8, name: 'Alice' }]);
  expect(output.knownPlayers).toEqual([]);
});

test('server members see database players by DBID without Steam UIDs', async () => {
  const output = await projectPlayerData({ knownPlayers: servers[1].knownPlayers },
    { serverId: 'foreign', guest: false, userSteamId: '76561198000000001' }) as {
    knownPlayers: Array<Record<string, unknown>>
  };
  expect(output.knownPlayers[0]).toMatchObject({ id: 'foreign:8', name: 'Alice' });
  expect(output.knownPlayers[0]).not.toHaveProperty('uid');
  expect(output.knownPlayers[1]).toMatchObject({ id: 'foreign:9', name: 'Bob' });
  expect(output.knownPlayers[1]).not.toHaveProperty('uid');
});

test('owner sees Steam UID of an own-server player on another server', async () => {
  const output = await projectPlayerData({ knownPlayers: servers[1].knownPlayers },
    { serverId: 'foreign', guest: false, userSteamId: '76561198000000999' }) as {
    knownPlayers: Array<Record<string, unknown>>
  };
  expect(output.knownPlayers).toEqual([]);
  const live = await projectPlayerData({ onlinePlayers: servers[1].knownPlayers },
    { serverId: 'foreign', guest: false, userSteamId: '76561198000000999' }) as {
    onlinePlayers: Array<Record<string, unknown>>
  };
  expect(live.onlinePlayers[0].uid).toBe('76561198000000001');
  expect(live.onlinePlayers[1]).not.toHaveProperty('uid');
});

test('statistics expose no raw UID list to guests', async () => {
  const output = await projectPlayerData({ buckets: [{ onlinePlayerUids: ['76561198000000001'] }] },
    { serverId: 'foreign', guest: true }) as { buckets: Array<Record<string, unknown>> };
  expect(output.buckets[0]).toEqual({ onlinePlayerIds: [] });
});

test.each([
  [undefined, false],
  ['76561198000000002', false],
  ['76561198000000001', true],
  ['76561198000000999', true],
] as const)('limits live details for viewer %s to own-server members and admins', async (userSteamId, allowed) => {
  const output = await projectPlayerData({
    servers: ['own', 'foreign'].map(id => ({
      id, onlinePlayers: [{ name: 'Alice', ping: 42, platform: 'Steam' }],
    })),
  }, { guest: !userSteamId, userSteamId }) as {
    servers: Array<{ onlinePlayers: Array<Record<string, unknown>> }>
  };
  expect(output.servers[0].onlinePlayers[0]).toEqual(allowed
    ? { name: 'Alice', ping: 42, platform: 'Steam' }
    : { name: 'Alice' });
  expect(output.servers[1].onlinePlayers[0]).toEqual(userSteamId?.endsWith('001') || userSteamId?.endsWith('002')
    ? { name: 'Alice', ping: 42, platform: 'Steam' }
    : { name: 'Alice' });
});
